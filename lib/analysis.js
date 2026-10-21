import { playoffOdds } from './playoffs.js';

// Lineup, waiver, trade and keeper logic. Works on the normalized league shape
// that sleeper.js and espn.js both produce.

export const ELIGIBLE = {
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
// `locked` maps slot index -> player for starters whose game has already kicked off;
// they stay put, and players in `exclude` (benched players whose game started) can't move in.
export function bestLineup(slots, players, score, locked = new Map(), exclude = new Set()) {
  const pool = [...players].filter((p) => !exclude.has(p.id)).sort((a, b) => score(b) - score(a));
  const used = new Set([...locked.values()].map((p) => p.id));
  const filled = slots.map((_, i) => locked.get(i) || null);
  const order = slots.map((s, i) => [s, i]).filter(([, i]) => !locked.has(i)).sort((a, b) => SLOT_ORDER.indexOf(a[0]) - SLOT_ORDER.indexOf(b[0]));
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

export function analyzeLeague(league, U, games = null) {
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
  // Players whose game has kicked off can't be moved, and an injury tag picked up
  // mid-game (ruled out during the game) says nothing about this week's lineup.
  const started = (p) => { const g = games?.get(p.nfl); return !!g && g.state !== 'pre'; };
  const locked = new Map();
  (me.lineup || []).forEach((x, i) => {
    const p = x.id ? me.roster.find((q) => q.id === x.id) : null;
    if (p && started(p)) locked.set(i, p);
  });
  const lockedBench = new Set(me.roster.filter((p) => started(p) && !current.includes(p)).map((p) => p.id));
  const best = bestLineup(league.slots, me.roster, weekScore, locked, lockedBench);
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
    if (started(p)) continue;
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
  // Which week waiver claims are for: this week until games start, then next week.
  const waiverWeek = games && [...games.values()].some((g) => g.state !== 'pre') ? U.week + 1 : U.week;
  const wkProj = (p) => (p.sid ? (waiverWeek === U.week ? U.projThisWeek(p.sid) : U.projNextWeek(p.sid)) : waiverWeek === U.week ? p.proj : null);
  // Holes in that week's lineup: starters on bye or out.
  const holes = [];
  for (const x of myBestByValue) {
    const p = x.player;
    if (!p || !p.sid) continue;
    const wp = wkProj(p);
    const why = UNAVAILABLE.includes(p.injury) ? p.injury : !wp ? 'on bye' : null;
    if (!why) continue;
    // Best bench player who could cover the spot that week.
    const cover = me.roster
      .filter((q) => q.pos === p.pos && q.id !== p.id && !myBestByValue.some((y) => y.player?.id === q.id) && !UNAVAILABLE.includes(q.injury))
      .map((q) => ({ q, wp: wkProj(q) || 0 }))
      .sort((a, b) => b.wp - a.wp)[0];
    holes.push({ player: slim(p), why, pos: p.pos, coverName: cover?.q.name || null, coverProj: cover ? r1(cover.wp) : 0 });
  }
  const holeAt = (pos) => holes.find((h) => h.pos === pos);

  const wi = league.waiverInfo || {};
  const candidates = freeAgents
    .map((p) => {
      const ros = r1(p.value - (worstStarter[p.pos] ?? 0));
      const hole = holeAt(p.pos);
      const wp = wkProj(p) || 0;
      const fill = hole ? r1(wp - hole.coverProj) : 0;
      return { p, ros, fill, wp, hole };
    })
    .filter((c) => c.ros > 0 || (c.fill > 2 && c.wp > 0) || (vor(c.p) > 0 && SKILL.includes(c.p.pos)))
    .sort((a, b) => Math.max(b.ros, b.fill * 0.5) - Math.max(a.ros, a.fill * 0.5))
    .filter((c, _, all) => all.filter((d) => d.p.pos === c.p.pos).indexOf(c) < (['K', 'DEF'].includes(c.p.pos) ? 1 : 3))
    .slice(0, 6);
  // Rough FAAB bid: a share of what you have left, scaled by how much he helps the rest of the season.
  const bidFor = (c) => {
    if (!wi.faab || !wi.left) return null;
    if (['K', 'DEF'].includes(c.p.pos)) return Math.min(wi.left, c.ros > 3 ? 2 : 1);
    const share = Math.min(0.4, Math.max(0.01, c.ros * 0.025 + (c.fill > 0 ? 0.03 : 0)));
    return Math.max(1, Math.min(wi.left, Math.round(wi.left * share)));
  };
  const waivers = candidates.map((c) => ({
    ...slim(c.p),
    upgradeOver: worstStarter[c.p.pos] != null ? c.ros : null,
    weekProj: c.wp ? r1(c.wp) : null,
    fills: c.hole && c.fill > 0 ? `${c.hole.player.name} (${c.hole.why})` : null,
    bid: bidFor(c),
    drop: dropFor(c.p) ? slim(dropFor(c.p)) : null,
  }));
  const waiverPlan = { week: waiverWeek, faab: !!wi.faab, left: wi.left ?? null, budget: wi.budget ?? null, priority: wi.priority ?? null, teams: wi.teams ?? league.size, holes };

  // ---- Playoff odds ----
  const oppTeam = league.matchup?.oppId != null ? league.teams.find((t) => t.id === league.matchup.oppId) : null;
  const md = league.matchup ? matchupDetail(league, me, oppTeam, games, best) : null;
  let playoffs = null;
  if (league.schedule?.length && league.playoffTeams) {
    const teamsForSim = league.teams.map((t) => ({
      id: t.id, name: t.name, wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf,
      mean: lineupTotal(bestLineup(league.slots, t.roster, (p) => p.value), (p) => p.value),
    }));
    const override = md && games && [...games.values()].some((g) => g.state !== 'pre') ? { week: U.week, id: me.id, winPct: md.winPct } : null;
    playoffs = playoffOdds(teamsForSim, league.schedule, league.playoffTeams, me.id, override);
    if (playoffs) {
      const nameOf = new Map(league.teams.map((t) => [t.id, t.name]));
      playoffs.myGames = playoffs.myGames.map((g) => ({ ...g, oppName: nameOf.get(g.oppId) || 'TBD' }));
    }
  }

  // ---- Keeper ----
  const keeper = league.keeper ? keeperInfo(league, U, vor) : null;
  const keeperEdge = (roster) => (keeper ? Math.max(0, ...roster.map((p) => keeper.surplusFor(p))) : 0);

  // ---- Trades ----
  const trades = tradeIdeas(league, me, vor, keeper, keeperEdge);

  // ---- Standings ----
  const standings = [...league.teams]
    .sort((a, b) => b.wins - a.wins || b.pf - a.pf)
    .map((t, i) => ({ rank: i + 1, id: t.id, name: t.name, wins: t.wins, losses: t.losses, ties: t.ties, pf: r1(t.pf) }));

  return {
    platform: league.platform,
    id: league.id,
    name: league.name,
    url: league.url,
    ppr: league.ppr,
    myTeam: { name: me.name, wins: me.wins, losses: me.losses, ties: me.ties, rank: standings.find((s) => s.id === me.id).rank, size: league.size },
    matchup: md,
    alerts,
    lineup,
    waivers,
    waiverPlan,
    playoffs,
    trades,
    keeper: keeper && keeper.summary(me),
    transactions: league.transactions,
    claims: league.claims || [],
    standings,
    myTeamId: me.id,
    teams: teamBreakdown(league, me),
  };
}

// ---- Matchup: live points, what's left to play, and win odds ----

const ncdf = (z) => {
  // Abramowitz-Stegun approximation of the normal CDF.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
};

function liveRows(team, games) {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  return (team.lineup || []).map((x) => {
    const p = x.id ? byId.get(x.id) : null;
    if (!p) return { slot: slotLabel(x.slot), player: null, pts: 0, left: 0, remaining: 0 };
    const g = games?.get(p.nfl);
    // No game found (bye week) means nothing left to score; without schedule data, assume unplayed.
    const left = games ? (g ? g.left : 0) : (p.pts ? 0 : 1);
    const proj = UNAVAILABLE.includes(p.injury) && left === 1 ? 0 : p.proj || 0;
    return {
      slot: slotLabel(x.slot),
      player: slim(p),
      pts: r1(p.pts || 0),
      proj: p.proj ?? null,
      game: g ? g.label + (g.opp ? ` ${p.nfl === g.opp ? '' : 'vs ' + g.opp}` : '') : 'Bye',
      state: g?.state || 'bye',
      start: g?.start || null,
      left,
      remaining: proj * left,
    };
  });
}

function winOdds(mine, theirs) {
  const tot = (rows) => rows.reduce((s, r) => s + r.pts + r.remaining, 0);
  // A player's weekly PPR score swings by about two thirds of his projection
  // (a 15-point WR lands anywhere from ~5 to ~25), shrinking as his game plays out.
  // That works out to roughly a 30-point spread on a full lineup, in line with how
  // much real fantasy scores miss their projections.
  const variance = (rows) => rows.reduce((s, r) => s + (0.65 * r.remaining + 2 * r.left) ** 2, 0);
  const diff = tot(mine) - tot(theirs);
  const sd = Math.sqrt(variance(mine) + variance(theirs));
  const p = sd < 0.01 ? (diff > 0 ? 1 : diff < 0 ? 0 : 0.5) : ncdf(diff / sd);
  return { proj: r1(tot(mine)), oppProj: r1(tot(theirs)), winPct: Math.round(p * 100) };
}

function matchupDetail(league, me, opp, games, best) {
  const myRows = liveRows(me, games);
  const oppRows = opp ? liveRows(opp, games) : [];
  const odds = winOdds(myRows, oppRows);
  // Same odds if you switch to the recommended lineup (before games start, mostly).
  const bestTeam = { ...me, lineup: best.map((x) => ({ slot: x.slot, id: x.player?.id || null })) };
  const bestOdds = winOdds(liveRows(bestTeam, games), oppRows);
  return {
    ...league.matchup,
    oppName: opp?.name || 'Opponent',
    myProj: odds.proj,
    oppProj: odds.oppProj,
    winPct: odds.winPct,
    bestWinPct: bestOdds.winPct > odds.winPct ? bestOdds.winPct : null,
    myRows,
    oppRows,
  };
}

// ---- Every team's roster by position, with weak spots and surplus ----

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function startersPerPos(slots) {
  const n = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const s of slots) {
    if (n[s] != null) n[s] += 1;
    else if (s === 'FLEX') { n.RB += 0.45; n.WR += 0.45; n.TE += 0.1; }
    else if (s === 'WRRB_FLEX') { n.RB += 0.5; n.WR += 0.5; }
    else if (s === 'REC_FLEX') { n.WR += 0.7; n.TE += 0.3; }
    else if (s === 'SUPER_FLEX') { n.QB += 0.8; n.RB += 0.1; n.WR += 0.1; }
  }
  for (const k of Object.keys(n)) n[k] = Math.max(1, Math.round(n[k]));
  return n;
}

function teamBreakdown(league, me) {
  const need = startersPerPos(league.slots);
  const size = league.teams.length;
  const teams = league.teams.map((t) => {
    const byPos = {};
    for (const pos of POS_ORDER) byPos[pos] = t.roster.filter((p) => p.pos === pos).sort((a, b) => (b.value || 0) - (a.value || 0));
    const strength = {};
    const nextUp = {};
    for (const pos of Object.keys(need)) {
      strength[pos] = byPos[pos].slice(0, need[pos]).reduce((s, p) => s + (p.value || 0), 0);
      nextUp[pos] = byPos[pos][need[pos]]?.value || 0;
    }
    return { t, byPos, strength, nextUp };
  });

  // Rank each position across the league, and find the value of a typical last starter.
  const rank = {};
  const typicalStarter = {};
  for (const pos of Object.keys(need)) {
    const sorted = [...teams].sort((a, b) => b.strength[pos] - a.strength[pos]);
    sorted.forEach((x, i) => ((rank[x.t.id] ||= {})[pos] = i + 1));
    const lastStarters = teams.map((x) => x.byPos[pos][need[pos] - 1]?.value || 0).sort((a, b) => a - b);
    typicalStarter[pos] = lastStarters[Math.floor(lastStarters.length / 2)];
  }

  const out = teams.map(({ t, byPos, nextUp }) => {
    const needs = Object.keys(need).filter((pos) => rank[t.id][pos] > Math.ceil(size * 0.7));
    const surplus = Object.keys(need).filter((pos) => nextUp[pos] > 0 && nextUp[pos] >= typicalStarter[pos] && !needs.includes(pos));
    const starters = new Set(t.starters);
    return {
      id: t.id,
      name: t.name,
      owner: t.owner,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pf: r1(t.pf),
      mine: t.id === me.id,
      ranks: rank[t.id],
      needs,
      surplus,
      lineup: (t.lineup || []).map((x) => ({ slot: slotLabel(x.slot), id: x.id })),
      reserve: t.reserve || [],
      byPos: Object.fromEntries(POS_ORDER.map((pos) => [pos, byPos[pos].map((p) => ({ ...slim(p), pts: p.pts ?? null, starter: starters.has(p.id) }))])),
    };
  });

  // Good partners: they're weak where you're deep, and deep where you're weak.
  const mine = out.find((x) => x.mine);
  for (const x of out) {
    if (x.mine) continue;
    const give = mine.surplus.filter((p) => x.needs.includes(p));
    const get = x.surplus.filter((p) => mine.needs.includes(p));
    if (give.length && get.length) x.partner = { give, get };
  }
  return out;
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
  return { id: p.id, name: p.name, pos: p.pos, nfl: p.nfl, injury: p.injury || null, proj: p.proj ?? null, value: p.value ?? null };
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
