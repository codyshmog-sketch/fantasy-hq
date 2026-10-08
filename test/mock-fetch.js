// Replaces global fetch with made-up Sleeper and ESPN responses shaped like the
// real APIs, so the whole pipeline can run without network access.
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const COUNT = { QB: 40, RB: 90, WR: 120, TE: 40, K: 32, DEF: 32 };
const TEAMS = ['ATL','BUF','CHI','CIN','CLE','DAL','DEN','DET','GB','TEN','IND','KC','LV','LAR','MIA','MIN','NE','NO','NYG','NYJ','PHI','ARI','PIT','LAC','SF','SEA','TB','WAS','CAR','JAX','BAL','HOU'];
const ESPN_TEAM_ID = Object.fromEntries(TEAMS.map((t, i) => [t, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,33,34][i]]));
const BASE = { QB: 22, RB: 18, WR: 18, TE: 13, K: 9, DEF: 9 };
const ESPN_POS = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 16 };
const FIRST = ['Jalen','Josh','Bijan','Ja\'Marr','CeeDee','Amon-Ra','Travis','Sam','Drake','Puka','Malik','Tee','Kyren','Breece','Garrett','Chris','Davante','DK','Mark','Nico'];
const LAST = ['Smith','Johnson','Williams','Brown','Jones','Miller','Davis','Wilson','Moore','Taylor','Thomas','Jackson','White','Harris','Martin','Thompson','Robinson','Lewis','Walker','Hall'];

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const players = {};
const ids = [];
let n = 1000;
for (const pos of POS) {
  for (let i = 0; i < COUNT[pos]; i++) {
    const team = TEAMS[i % 32];
    const id = pos === 'DEF' ? team : String(n++);
    const name = pos === 'DEF' ? null : `${FIRST[(i * 7 + n) % 20]} ${LAST[(i * 3 + n) % 20]}${i > 30 ? ' Jr.' : ''} ${pos}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;
    const inj = rnd() < 0.08 ? ['Questionable', 'Out', 'IR', 'Doubtful'][Math.floor(rnd() * 4)] : null;
    players[id] = { player_id: id, full_name: name, first_name: name?.split(' ')[0], last_name: name?.split(' ').slice(1).join(' '), position: pos, fantasy_positions: [pos], team, injury_status: inj, active: true };
    const ppg = Math.max(0.5, BASE[pos] * (1.15 - i / COUNT[pos]) + (rnd() - 0.5) * 4);
    players[id]._ppg = ppg;
    players[id]._bye = 5 + (i % 9);
    ids.push(id);
  }
}
const week = 5;
const proj = (w) => ids.map((id) => ({ player_id: id, stats: { pts_ppr: players[id]._bye === w || ['Out', 'IR'].includes(players[id].injury_status) && w === week ? 0 : +(players[id]._ppg * (0.85 + rnd() * 0.3)).toFixed(2) } }));
const stats = ids.map((id) => ({ player_id: id, stats: { gp: 4, pts_ppr: +(players[id]._ppg * 4 * (0.7 + rnd() * 0.6)).toFixed(1) } }));

// Deal rosters: snake draft by ppg with noise.
function deal(size, rounds, leagueSeed) {
  seed = leagueSeed;
  const pool = ids.filter((id) => !['K', 'DEF'].includes(players[id].position)).sort((a, b) => players[b]._ppg * (0.7 + rnd() * 0.6) - players[a]._ppg * (0.7 + rnd() * 0.6));
  const kd = ids.filter((id) => ['K', 'DEF'].includes(players[id].position));
  const rosters = Array.from({ length: size }, () => []);
  const picks = [];
  let p = 0;
  for (let r = 1; r <= rounds; r++) for (let k = 0; k < size; k++) {
    const t = r % 2 ? k : size - 1 - k;
    const id = r >= rounds - 1 ? kd.splice(Math.floor(rnd() * kd.length), 1)[0] : pool[p++];
    rosters[t].push(id);
    picks.push({ round: r, roster_id: t + 1, player_id: id, is_keeper: false });
  }
  // A couple of waiver pickups per team.
  for (const r of rosters) r.push(pool[p++ + 30]);
  return { rosters, picks };
}
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
function startersFor(roster) {
  const used = new Set(); const out = [];
  for (const s of SLOTS) {
    const el = s === 'FLEX' ? ['RB', 'WR', 'TE'] : [s];
    const c = roster.filter((id) => !used.has(id) && el.includes(players[id].position));
    const pick = c[Math.floor(rnd() * Math.min(2, c.length))];
    if (pick) { used.add(pick); out.push(pick); }
  }
  return out;
}

const sleeperLeagues = {};
const espnLeagues = {};
const LEAGUE_IDS = { sleeper: ['1395476767719837696', '1401344727613251584', '1389346268110651392'], espn: ['1339314204', '1505500433', '880282876'] };
const MY_ESPN = { 1339314204: 'Team Shmog', 1505500433: 'Weatherman', 880282876: "E Mart's Minions" };
LEAGUE_IDS.sleeper.forEach((id, li) => {
  const size = 10 + li * 2 % 4;
  const { rosters, picks } = deal(size, 15, 100 + li);
  if (li === 2) picks.find((p) => p.round === 12 && p.roster_id === 3).is_keeper = true;
  sleeperLeagues[id] = {
    league: { name: ['Dynasty Degenerates', 'Work League', 'JCC Keeper League'][li], total_rosters: size, roster_positions: [...SLOTS.slice(0, 7), 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'], scoring_settings: { rec: 1 }, draft_id: `d${id}` },
    users: rosters.map((_, i) => ({ user_id: `u${i}`, display_name: i === 2 ? (li === 2 ? 'btroke' : 'emartinator') : `user${i}`, metadata: { team_name: li === 2 && i === 2 ? 'Maye We Pipe Heather' : `Team ${LAST[i]}` } })),
    rosters: rosters.map((r, i) => ({ roster_id: i + 1, owner_id: `u${i}`, co_owners: li === 2 && i === 2 ? ['u_me'] : null, players: r, starters: startersFor(r), settings: { wins: Math.floor(rnd() * 5), losses: 2, fpts: 400 + Math.floor(rnd() * 200) } })),
    picks, draft: { settings: { rounds: 15 } },
    matchups: rosters.map((_, i) => ({ roster_id: i + 1, matchup_id: Math.floor(i / 2) + 1, points: +(rnd() * 30).toFixed(2) })),
    tx: [{ type: 'trade', status: 'complete', created: Date.now() - 864e5, status_updated: Date.now() - 864e5, roster_ids: [1, 4], adds: { [rosters[0][3]]: 4, [rosters[3][4]]: 1 } }, { type: 'free_agent', status: 'complete', created: Date.now() - 3e6, status_updated: Date.now() - 3e6, roster_ids: [3], adds: { [ids[200]]: 3 }, drops: { [rosters[2][15]]: 3 } }],
  };
  // Make "me" own roster 3 (index 2) in leagues 0/1.
  if (li < 2) sleeperLeagues[id].rosters[2].owner_id = 'u_me';
});
LEAGUE_IDS.espn.forEach((id, li) => {
  const size = 12 - li * 2;
  const { rosters } = deal(size, 15, 200 + li);
  const teams = rosters.map((r, i) => {
    const starters = new Set(startersFor(r));
    const slotFor = (pid) => { const pos = players[pid].position; return starters.has(pid) ? { QB: 0, RB: 2, WR: 4, TE: 6, K: 17, DEF: 16 }[pos] : 20; };
    return {
      id: i + 1, name: i === 1 ? MY_ESPN[id] : `${LAST[i]} Squad`, owners: [i === 1 ? '{MOCK-SWID}' : `{OWNER-${i}}`],
      record: { overall: { wins: Math.floor(rnd() * 5), losses: 2, ties: 0, pointsFor: 450 + rnd() * 150 } },
      roster: { entries: r.map((pid) => ({ playerId: Number(pid) || 90000 + TEAMS.indexOf(pid), lineupSlotId: slotFor(pid), playerPoolEntry: { player: {
        id: Number(pid), fullName: players[pid].position === 'DEF' ? `${pid} D/ST` : players[pid].full_name, defaultPositionId: ESPN_POS[players[pid].position], proTeamId: ESPN_TEAM_ID[players[pid].team],
        injuryStatus: { Questionable: 'QUESTIONABLE', Out: 'OUT', IR: 'INJURY_RESERVE', Doubtful: 'DOUBTFUL' }[players[pid].injury_status] || 'ACTIVE',
        stats: [{ scoringPeriodId: week, statSourceId: 1, appliedTotal: players[pid]._bye === week ? 0 : players[pid]._ppg * (0.9 + rnd() * 0.2) }] } } })) },
    };
  });
  espnLeagues[id] = {
    scoringPeriodId: week, status: { currentMatchupPeriod: week }, members: [],
    settings: { name: ["Hightstown's Finest", 'Zeeb League', 'Real Deal'][li], rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 7, 21: 1 } }, scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] } },
    teams, schedule: [{ matchupPeriodId: week, home: { teamId: 2, totalPoints: 12.4 }, away: { teamId: 5, totalPoints: 30.1 } }],
  };
});

const json = (d) => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const p = u.pathname;
  let m;
  if (p === '/v1/state/nfl') return json({ season: '2026', week, display_week: week, season_type: 'regular' });
  if (p === '/v1/players/nfl') return json(players);
  if (p.startsWith('/v1/user/')) return json({ user_id: 'u_me', username: p.split('/').pop() });
  if ((m = p.match(/^\/projections\/nfl\/\d+\/(\d+)$/))) return json(proj(Number(m[1])));
  if (p.match(/^\/stats\/nfl\/\d+$/)) return json(stats);
  if ((m = p.match(/^\/v1\/league\/(\d+)(\/\w+)?(\/\d+)?$/))) {
    const L = sleeperLeagues[m[1]];
    if (!m[2]) return json(L.league);
    if (m[2] === '/rosters') return json(L.rosters);
    if (m[2] === '/users') return json(L.users);
    if (m[2] === '/matchups') return json(L.matchups);
    if (m[2] === '/transactions') return json(Number(m[3].slice(1)) === week ? L.tx : []);
  }
  if ((m = p.match(/^\/v1\/draft\/d(\d+)(\/picks)?$/))) return json(m[2] ? sleeperLeagues[m[1]].picks : sleeperLeagues[m[1]].draft);
  if ((m = p.match(/leagues\/(\d+)$/))) {
    if (!String(opts.headers?.cookie).includes('espn_s2=')) return new Response('unauthorized', { status: 401 });
    if (u.search.includes('mTransactions2')) return json({ transactions: [] });
    return json(espnLeagues[m[1]]);
  }
  return new Response('not mocked: ' + url, { status: 404 });
};
