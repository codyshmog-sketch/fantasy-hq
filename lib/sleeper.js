import { getJSON, MIN } from './http.js';

const API = 'https://api.sleeper.app/v1';

function teamName(user, roster) {
  return user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`;
}

export async function loadSleeperLeague(cfg, U, usernames) {
  const [league, rosters, users, matchups, tx, txPrev, ...me] = await Promise.all([
    getJSON(`${API}/league/${cfg.id}`, { ttl: 5 * MIN }),
    getJSON(`${API}/league/${cfg.id}/rosters`),
    getJSON(`${API}/league/${cfg.id}/users`, { ttl: 5 * MIN }),
    getJSON(`${API}/league/${cfg.id}/matchups/${U.week}`).catch(() => []),
    getJSON(`${API}/league/${cfg.id}/transactions/${U.week}`).catch(() => []),
    U.week > 1 ? getJSON(`${API}/league/${cfg.id}/transactions/${U.week - 1}`).catch(() => []) : [],
    ...usernames.map((u) => getJSON(`${API}/user/${u}`, { ttl: 60 * MIN }).catch(() => null)),
  ]);

  const myIds = new Set(me.filter(Boolean).map((u) => u.user_id));
  const userById = new Map(users.map((u) => [u.user_id, u]));

  const player = (sid) => {
    const p = U.players.get(sid) || { sid, name: `Player ${sid}`, pos: '?', nfl: '', injury: null };
    return { ...p, id: sid, proj: U.projThisWeek(sid), value: U.value(sid), ppg: U.ppg(sid) };
  };

  const slots = (league.roster_positions || []).filter((s) => !['BN', 'IR', 'TAXI'].includes(s));
  const teams = rosters.map((r) => {
    const owner = userById.get(r.owner_id);
    const s = r.settings || {};
    return {
      id: r.roster_id,
      name: teamName(owner, r),
      owner: owner?.display_name || '',
      ownerIds: [r.owner_id, ...(r.co_owners || [])].filter(Boolean),
      wins: s.wins || 0,
      losses: s.losses || 0,
      ties: s.ties || 0,
      pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
      roster: (r.players || []).map(player),
      starters: (r.starters || []).filter((x) => x && x !== '0'),
      lineup: slots.map((slot, i) => ({ slot, id: r.starters?.[i] && r.starters[i] !== '0' ? r.starters[i] : null })),
      reserve: r.reserve || [],
    };
  });

  let mine = teams.find((t) => t.ownerIds.some((id) => myIds.has(id)));
  if (!mine && cfg.team) mine = teams.find((t) => t.name.toLowerCase() === cfg.team.toLowerCase());
  if (!mine) throw new Error(`Couldn't find your team (looked for ${usernames.join(', ')}${cfg.team ? ` or "${cfg.team}"` : ''})`);

  let matchup = null;
  const myM = matchups.find((m) => m.roster_id === mine.id);
  if (myM && myM.matchup_id != null) {
    const opp = matchups.find((m) => m.matchup_id === myM.matchup_id && m.roster_id !== mine.id);
    matchup = { myPts: myM.points || 0, oppPts: opp?.points || 0, oppId: opp?.roster_id ?? null };
  }

  const teamOf = new Map(teams.map((t) => [t.id, t]));
  const transactions = [...tx, ...txPrev]
    .filter((t) => t.status === 'complete')
    .sort((a, b) => (b.status_updated || b.created) - (a.status_updated || a.created))
    .slice(0, 8)
    .map((t) => {
      const by = (t.roster_ids || []).map((id) => teamOf.get(id)?.name).filter(Boolean);
      const adds = Object.entries(t.adds || {}).map(([sid, rid]) => `${teamOf.get(rid)?.name || '?'} adds ${player(sid).name}`);
      const drops = Object.entries(t.drops || {}).map(([sid, rid]) => `${teamOf.get(rid)?.name || '?'} drops ${player(sid).name}`);
      return {
        when: t.status_updated || t.created,
        type: t.type === 'trade' ? 'Trade' : t.type === 'waiver' ? 'Waiver' : 'Free agent',
        text: t.type === 'trade' ? `${by.join(' ↔ ')}: ${adds.join('; ')}` : [...adds, ...drops].join('; '),
        mine: (t.roster_ids || []).includes(mine.id),
      };
    });

  const out = {
    platform: 'sleeper',
    id: cfg.id,
    name: league.name,
    url: `https://sleeper.com/leagues/${cfg.id}`,
    size: league.total_rosters || teams.length,
    slots,
    ppr: league.scoring_settings?.rec ?? null,
    myTeamId: mine.id,
    teams,
    matchup,
    transactions,
  };

  if (cfg.keeper) out.keeper = await loadKeeperInfo(league, cfg.keeper);
  return out;
}

// Next year's keeper cost for each player: the round he was drafted this year,
// minus `roundsEarlier`. Players picked up off waivers have no draft round; we
// treat them as costing the last round and say so.
async function loadKeeperInfo(league, rules) {
  const draftId = league.draft_id;
  if (!draftId) return { rules, rounds: null, drafted: {} };
  const [draft, picks] = await Promise.all([
    getJSON(`${API}/draft/${draftId}`, { ttl: 60 * MIN }),
    getJSON(`${API}/draft/${draftId}/picks`, { ttl: 60 * MIN }),
  ]);
  const drafted = {};
  for (const p of picks) {
    if (p.player_id) drafted[p.player_id] = { round: p.round, keptThisYear: !!p.is_keeper };
  }
  return { rules, rounds: draft?.settings?.rounds || null, drafted };
}
