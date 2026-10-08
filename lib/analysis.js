// Lineup, waiver, trade and keeper logic. Works on the normalized league shape
// that sleeper.js and espn.js both produce.

const ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};
const SLOT_LABEL = { FLEX: 'FLEX', WRRB_FLEX: 'RB/WR', REC_FLEX: 'WR/TE', SUPER_FLEX: 'SFLEX' };
// Fill the most restrictive slots first so a flex never steals a player a fixed slot needs.
const SLOT_ORDER = ['QB', 'K', 'DEF', 'TE', 'RB', 'WR', 'REC_FLEX', 'WRRB_FLEX', 'FLEX', 'SUPER_FLEX'];
const SKILL = ['QB', 'RB', 'WR', 'TE'];
const UNAVAILABLE = ['Out', 'IR', 'Sus', 'PUP', 'NA'];

const r1 = (n) => Math.round(n * 10) / 10;
export const slotLabel = (s) => SLOT_LABEL[s] || s;

function weekScore(p) {
  if (UNAVAILABLE.includes(p.injury)) return 0;
  // No projection this week means bye, injured or inactive.
  const base = p.proj ?? 0;
  return p.injury === 'Doubtful' ? base * 0.25 : base;
}

// Greedy best lineup by `score`. Returns [{slot, player|null}] in the league's slot order.
export function bestLineup(slots, players, score) {
  const pool = [...players].sort((a, b) => score(b) - score(a));
  const used = new Set();
  const filled = new Array(slots.length).fill(null);
  const order = slots.map((s, i) => [s, i]).sort((a, b) => SLOT_ORDER.indexOf(a[0]) - SLOT_ORDER.indexOf(b[0]));
  for (const [slot, i] of order) {
    const pick = pool.find((p) => !used.has(p.id) && (ELIGIBLE[slot] || []).includes(p.pos));
    if (pick) {
      used.add(pick.id);
      filled[i] = pick;
    }
  }
  return slots.map((slot, i) => ({ slot, player: filled[i] }));
}

const lineupTotal = (lineup, score) => lineup.reduce((s, x) => s + (x.player ? score(x.player) : 0), 0);

// Season-long team strength: best lineup by value, plus a little credit for bench depth.
function strength(slots, roster) {
  const lu = bestLineup(slots, roster, (p) => p.value);
  const used = new Set(lu.map((x) => x.player?.id));
  const bench = roster.filter((p) => !used.has(p.id) && SKILL.includes(p.pos)).map((p) => p.value).sort((a, b) => b - a);
  return lineupTotal(lu, (p) => p.value) + 0.15 * ((bench[0] || 0) + (bench[1] || 0));
}

// Replacement level per position: roughly the best player who wouldn't start in this league.
function replacementLevels(league, universeValues) {
  const n = league.size;
  const starters = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  for (const s of league.slots) {
    if (starters[s] != null) starters[s] += 1;
    else if (s === 'FLEX') { starters.RB += 0.45; starters.WR += 0.45; starters.TE += 0.1; }
    else if (s === 'WRRB_FLEX') { starters.RB += 0.5; starters.WR += 0.5; }
    else if (s === 'REC_FLEX') { starters.WR += 0.7; starters.TE += 0.3; }
    else if (s === 'SUPER_FLEX') { starters.QB += 0.8; starters.RB += 0.1; starters.WR += 0.1; }
  }
  const repl = {};
  for (const pos of Object.keys(starters)) {
    const vals = universeValues[pos] || [];
    repl[pos] = vals[Math.min(vals.length - 1, Math.round(starters[pos] * n))] || 0;
  }
  return repl;
}

export function analyzeLeague(league, U) {
  const me = league.teams.find((t) => t.id === league.myTeamId);
  const rosteredSids = new Set(league.teams.flatMap((t) => t.roster.map((p) => p.sid).filter(Boolean)));

  // Universe values by position, for replacement levels and free agents.
  const byPos = {};
  const freeAgents = [];
  for (const p of U.players.values()) {
    if (!p.active || p.nfl === 'FA') continue;
    const v = U.value(p.sid);
    if (v <= 0) continue;
    (byPos[p.pos] ||= []).push(v);
    if (!rosteredSids.has(p.sid)) freeAgents.push({ ...p, id: p.sid, value: v, proj: U.projThisWeek(p.sid) });
  }
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => b - a);
  const repl = replacementLevels(league, byPos);
  const vor = (p) => (p.value || 0) - (repl[p.pos] || 0);

  // ---- Lineup for this week ----
  const current = me.starters.map((id) => me.roster.find((p) => p.id === id)).filter(Boolean);
  const best = bestLineup(league.slots, me.roster, weekScore);
  const bestIds = new Set(best.map((x) => x.player?.id).filter(Boolean));
  const currentIds = new Set(current.map((p) => p.id));
  const benchIn = best.filter((x) => x.player && !currentIds.has(x.player.id)).map((x) => x.player);
  const benchOut = current.filter((p) => !bestIds.has(p.id));
  const gain = r1(lineupTotal(best, weekScore) - current.reduce((s, p) => s + weekScore(p), 0));
  const lineup = {
    projected: r1(lineupTotal(best, weekScore)),
    gain: gain > 0 ? gain : 0,
    current: (me.lineup || []).map((x) => {
      const p = x.id ? me.roster.find((q) => q.id === x.id) : null;
      return { slot: slotLabel(x.slot), player: p && slim(p), benched: !!p && !bestIds.has(p.id) };
    }),
    best: best.map((x) => ({ slot: slotLabel(x.slot), player: x.player && slim(x.player), changed: x.player && !currentIds.has(x.player.id) })),
    moves: pairMoves(benchIn, benchOut),
    emptySlots: Math.max(0, league.slots.length - current.length),
  };

  // ---- Alerts ----
  const alerts = [];
  for (const p of current) {
    if (UNAVAILABLE.includes(p.injury) || p.injury === 'Doubtful') alerts.push({ level: 'bad', text: `${p.name} is ${p.injury} and in your lineup` });
    else if (p.injury === 'Questionable') alerts.push({ level: 'warn', text: `${p.name} is Questionable; check before kickoff` });
    else if (!p.proj) alerts.push({ level: 'bad', text: `${p.name} has no projection this week (bye, injured or inactive)` });
  }
  if (lineup.emptySlots) alerts.push({ level: 'bad', text: `${lineup.emptySlots} empty starting spot${lineup.emptySlots > 1 ? 's' : ''}` });

  // ---- Waiver targets: free agents better than your weakest starter or bench at that spot ----
  const myBestByValue = bestLineup(league.slots, me.roster, (p) => p.value);
  const worstStarter = {};
  for (const x of myBestByValue) {
    if (!x.player) continue;
    const pos = x.player.pos;
    worstStarter[pos] = Math.min(worstStarter[pos] ?? Infinity, x.player.value);
  }
  // Who to drop: for a kicker or defense, your worst one at that spot; otherwise your
  // least valuable bench player, judged by the better of his outlook and his season so far.
  const keepScore = (p) => Math.max(p.value || 0, p.ppg || 0);
  const myBench = me.roster.filter((p) => !myBestByValue.some((x) => x.player?.id === p.id)).sort((a, b) => keepScore(a) - keepScore(b));
  const dropFor = (fa) => {
    if (['K', 'DEF'].includes(fa.pos)) return me.roster.filter((p) => p.pos === fa.pos).sort((a, b) => keepScore(a) - keepScore(b))[0] || myBench[0];
    return myBench.find((p) => !['K', 'DEF'].includes(p.pos) || me.roster.filter((q) => q.pos === p.pos).length > 1) || null;
  };
  const waivers = freeAgents
    .filter((p) => (p.value > (worstStarter[p.pos] ?? 0)) || (vor(p) > 0 && SKILL.includes(p.pos)))
    .sort((a, b) => b.value - (worstStarter[b.pos] ?? 0) - (a.value - (worstStarter[a.pos] ?? 0)))
    .filter((p, _, all) => all.filter((q) => q.pos === p.pos).indexOf(p) < (['K', 'DEF'].includes(p.pos) ? 1 : 2))
    .slice(0, 4)
    .map((p) => ({ ...slim(p), upgradeOver: worstStarter[p.pos] != null ? r1(p.value - worstStarter[p.pos]) : null, drop: dropFor(p) ? slim(dropFor(p)) : null }));

  // ---- Keeper ----
  const keeper = league.keeper ? keeperInfo(league, U, vor) : null;
  const keeperEdge = (roster) => (keeper ? Math.max(0, ...roster.map((p) => keeper.surplusFor(p))) : 0);

  // ---- Trades ----
  const trades = tradeIdeas(league, me, vor, keeper, keeperEdge);

  // ---- Standings ----
  const standings = [...league.teams]
    .sort((a, b) => b.wins - a.wins || b.pf - a.pf)
    .map((t, i) => ({ rank: i + 1, id: t.id, name: t.name, wins: t.wins, losses: t.losses, ties: t.ties, pf: r1(t.pf) }));
  const opp = league.matchup?.oppId != null ? league.teams.find((t) => t.id === league.matchup.oppId) : null;

  return {
    platform: league.platform,
    id: league.id,
    name: league.name,
    url: league.url,
    ppr: league.ppr,
    myTeam: { name: me.name, wins: me.wins, losses: me.losses, ties: me.ties, rank: standings.find((s) => s.id === me.id).rank, size: league.size },
    matchup: league.matchup && { ...league.matchup, oppName: opp?.name || 'Opponent', oppProj: opp ? r1(lineupTotal(bestLineup(league.slots, opp.roster, weekScore), weekScore)) : null },
    alerts,
    lineup,
    waivers,
    trades,
    keeper: keeper && keeper.summary(me),
    transactions: league.transactions,
    standings,
  };
}

// Pair each player to start with the one he replaces, same position first.
function pairMoves(ins, outs) {
  const left = [...outs];
  const take = (pred) => { const i = left.findIndex(pred); return i < 0 ? null : left.splice(i, 1)[0]; };
  const paired = ins.map((p) => ({ p, out: take((o) => o.pos === p.pos) }));
  return paired.map(({ p, out }) => {
    const o = out || take(() => true);
    return { in: slim(p), out: o ? slim(o) : null };
  });
}

function slim(p) {
  return { name: p.name, pos: p.pos, nfl: p.nfl, injury: p.injury || null, proj: p.proj ?? null, value: p.value ?? null };
}

// Keeper surplus = how many rounds earlier he'd go in a draft than what he costs to keep.
function keeperInfo(league, U, vor) {
  const { rules, rounds, drafted } = league.keeper;
  const lastRound = rounds || 15;
  // Draft-equivalent rank: everyone rostered in the league, ordered by value over replacement.
  const ranked = league.teams.flatMap((t) => t.roster).filter((p) => p.pos !== 'K' && p.pos !== 'DEF').sort((a, b) => vor(b) - vor(a));
  const rankOf = new Map(ranked.map((p, i) => [p.id, i]));

  const detail = (p) => {
    const d = drafted[p.sid];
    const cost = Math.max(1, (d ? d.round : lastRound) - rules.roundsEarlier);
    const marketRound = rankOf.has(p.id) ? Math.floor(rankOf.get(p.id) / league.size) + 1 : lastRound;
    return { draftedRound: d?.round ?? null, keptThisYear: !!d?.keptThisYear, cost, marketRound, surplus: Math.max(0, cost - marketRound) };
  };
  return {
    surplusFor: (p) => detail(p).surplus,
    detail,
    summary(me) {
      const candidates = me.roster
        .filter((p) => p.pos !== 'K' && p.pos !== 'DEF')
        .map((p) => ({ ...slim(p), ...detail(p) }))
        .sort((a, b) => b.surplus - a.surplus || a.marketRound - b.marketRound)
        .slice(0, 5);
      return { rules, candidates, undraftedAssumption: `Players you picked up off waivers are treated as costing round ${Math.max(1, lastRound - rules.roundsEarlier)}.` };
    },
  };
}

function tradeIdeas(league, me, vor, keeper, keeperEdge) {
  const ideas = [];
  const myBase = strength(league.slots, me.roster);
  const myEdgeBase = keeperEdge(me.roster);
  const tradeable = (p) => SKILL.includes(p.pos) && p.value > 0;
  const mine = me.roster.filter(tradeable);

  for (const other of league.teams) {
    if (other.id === me.id) continue;
    const theirBase = strength(league.slots, other.roster);
    const theirs = other.roster.filter(tradeable);

    const consider = (give, get) => {
      const giveIds = new Set(give.map((p) => p.id));
      const getIds = new Set(get.map((p) => p.id));
      const myAfter = [...me.roster.filter((p) => !giveIds.has(p.id)), ...get];
      const theirAfter = [...other.roster.filter((p) => !getIds.has(p.id)), ...give];
      const myGain = strength(league.slots, myAfter) - myBase;
      const theirGain = strength(league.slots, theirAfter) - theirBase;
      // Trade value is convex: one star is worth more than two decent players adding
      // up to the same points, which is how real leagues trade.
      const tv = (ps) => ps.reduce((s, p) => s + (Math.max(0, vor(p)) + 1) ** 1.6, 0);
      const valueGive = tv(give);
      const valueGet = tv(get);
      // Don't overpay, and only suggest what the other side could plausibly accept.
      const notOverpaying = valueGive <= valueGet * 1.15;
      const plausible = valueGive >= valueGet * 0.85 || (theirGain > 0.3 && valueGive >= valueGet * 0.7);
      const keeperDelta = keeper ? keeperEdge(myAfter) - myEdgeBase : 0;
      const score = myGain + keeperDelta * 0.35;
      if (!notOverpaying) return;
      if (!plausible || myGain < 0.6 || score <= 0.6) return;
      ideas.push({
        team: other.name,
        give: give.map((p) => ({ ...slim(p), keeper: keeper ? keeper.detail(p) : undefined })),
        get: get.map((p) => ({ ...slim(p), keeper: keeper ? keeper.detail(p) : undefined })),
        myGain: r1(myGain),
        theirGain: r1(theirGain),
        keeperDelta,
        balance: valueGive > 0 ? Math.round((valueGet / valueGive) * 100) / 100 : null,
        score,
      });
    };

    for (const a of mine) for (const b of theirs) consider([a], [b]);
    // 2-for-1 consolidation: two of yours for one better player of theirs.
    const myBench = mine.sort((a, b) => b.value - a.value).slice(0, 10);
    for (let i = 0; i < myBench.length; i++)
      for (let j = i + 1; j < myBench.length; j++)
        for (const b of theirs) if (b.value > Math.max(myBench[i].value, myBench[j].value)) consider([myBench[i], myBench[j]], [b]);
  }

  // Best idea per partner, without pitching the same player of yours more than twice.
  const bestPer = new Map();
  const offered = new Map();
  for (const t of ideas.sort((a, b) => b.score - a.score)) {
    if (bestPer.has(t.team) || t.give.some((p) => (offered.get(p.name) || 0) >= 2)) continue;
    bestPer.set(t.team, t);
    for (const p of t.give) offered.set(p.name, (offered.get(p.name) || 0) + 1);
  }
  return [...bestPer.values()].slice(0, 4).map(({ score, ...t }) => ({ ...t, why: explain(t, keeper) }));
}

function explain(t, keeper) {
  const give = t.give.map((p) => p.name).join(' + ');
  const get = t.get.map((p) => p.name).join(' + ');
  const parts = [`Your best lineup gains about ${t.myGain} pts/week.`];
  parts.push(t.theirGain > 0 ? `${t.team} also improves (+${t.theirGain}), so it's an easy sell.` : `Pitch it as value: ${give} for ${get} is close to even on paper.`);
  if (keeper && t.keeperDelta > 0) parts.push(`It also improves your best keeper option by ${t.keeperDelta} rounds of value.`);
  if (keeper && t.keeperDelta < 0) parts.push(`Note: it costs you ${-t.keeperDelta} rounds of keeper value.`);
  return parts.join(' ');
}
