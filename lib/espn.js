import { getJSON } from './http.js';
import { ESPN_TEAM } from './universe.js';

const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const SLOT = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 7: 'SUPER_FLEX', 3: 'WRRB_FLEX', 5: 'REC_FLEX', 16: 'DEF', 17: 'K' };
const BENCH = 20;
const IR = 21;
const INJURY = { QUESTIONABLE: 'Questionable', DOUBTFUL: 'Doubtful', OUT: 'Out', INJURY_RESERVE: 'IR', SUSPENSION: 'Sus' };

function base(season, id) {
  return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${id}`;
}

export async function loadEspnLeague(cfg, U, { swid, s2 }) {
  if (!swid || !s2) throw new Error('ESPN cookies are not set on the server (ESPN_SWID and ESPN_S2)');
  const headers = { cookie: `SWID=${swid}; espn_s2=${s2}` };
  const views = ['mTeam', 'mRoster', 'mMatchupScore', 'mSettings', 'mStatus'].map((v) => `view=${v}`).join('&');

  let data;
  try {
    data = await getJSON(`${base(U.season, cfg.id)}?${views}&scoringPeriodId=${U.week}`, { headers });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error('ESPN rejected the login cookies; espn_s2 may have expired');
    throw e;
  }

  const week = data.scoringPeriodId || U.week;
  const memberName = new Map((data.members || []).map((m) => [m.id, m.displayName || `${m.firstName || ''} ${m.lastName || ''}`.trim()]));

  const toPlayer = (entry) => {
    const p = entry.playerPoolEntry?.player || {};
    const pos = POS[p.defaultPositionId] || '?';
    const name = pos === 'DEF' ? `${ESPN_TEAM[p.proTeamId] || ''} D/ST` : p.fullName;
    const sid = U.findSid(p.fullName, pos, p.proTeamId);
    const espnProj = (p.stats || []).find((s) => s.scoringPeriodId === week && s.statSourceId === 1)?.appliedTotal;
    const universe = sid ? U.players.get(sid) : null;
    return {
      id: `e${entry.playerId}`,
      espnId: String(entry.playerId),
      sid,
      name,
      pos,
      nfl: ESPN_TEAM[p.proTeamId] || 'FA',
      injury: INJURY[p.injuryStatus] || universe?.injury || null,
      proj: typeof espnProj === 'number' ? Math.round(espnProj * 10) / 10 : U.projThisWeek(sid),
      value: U.value(sid),
      ppg: U.ppg(sid),
      slot: entry.lineupSlotId,
    };
  };

  const teams = (data.teams || []).map((t) => {
    const roster = (t.roster?.entries || []).map(toPlayer);
    const rec = t.record?.overall || {};
    return {
      id: t.id,
      name: t.name || `${t.location || ''} ${t.nickname || ''}`.trim() || t.abbrev,
      owner: (t.owners || []).map((o) => memberName.get(o)).filter(Boolean).join(', '),
      ownerIds: t.owners || [],
      wins: rec.wins || 0,
      losses: rec.losses || 0,
      ties: rec.ties || 0,
      pf: rec.pointsFor || 0,
      roster,
      starters: roster.filter((p) => p.slot !== BENCH && p.slot !== IR).map((p) => p.id),
      reserve: roster.filter((p) => p.slot === IR).map((p) => p.id),
    };
  });

  const want = swid.toUpperCase();
  let mine = teams.find((t) => t.ownerIds.some((o) => String(o).toUpperCase() === want));
  if (cfg.team) mine = teams.find((t) => t.name.toLowerCase() === cfg.team.toLowerCase()) || mine;
  if (!mine) throw new Error(`Couldn't find your team "${cfg.team}"`);

  const counts = data.settings?.rosterSettings?.lineupSlotCounts || {};
  const slots = [];
  for (const [id, n] of Object.entries(counts)) if (SLOT[id]) for (let i = 0; i < n; i++) slots.push(SLOT[id]);

  let matchup = null;
  const period = data.status?.currentMatchupPeriod;
  const game = (data.schedule || []).find(
    (g) => g.matchupPeriodId === period && (g.home?.teamId === mine.id || g.away?.teamId === mine.id),
  );
  if (game) {
    const [me, opp] = game.home?.teamId === mine.id ? [game.home, game.away] : [game.away, game.home];
    const pts = (s) => s?.totalPointsLive ?? s?.totalPoints ?? 0;
    matchup = { myPts: pts(me), oppPts: pts(opp), oppId: opp?.teamId ?? null };
  }

  return {
    platform: 'espn',
    id: cfg.id,
    name: data.settings?.name || cfg.name,
    url: `https://fantasy.espn.com/football/team?leagueId=${cfg.id}&teamId=${mine.id}`,
    size: teams.length,
    slots,
    ppr: (data.settings?.scoringSettings?.scoringItems || []).find((s) => s.statId === 53)?.points ?? null,
    myTeamId: mine.id,
    teams,
    matchup,
    transactions: await loadEspnTransactions(cfg, U, headers, teams, week, mine.id),
  };
}

// Recent adds, drops and trades. Best effort: if ESPN changes this view we
// just show nothing rather than failing the league.
async function loadEspnTransactions(cfg, U, headers, teams, week, myId) {
  try {
    const data = await getJSON(`${base(U.season, cfg.id)}?view=mTransactions2&scoringPeriodId=${week}`, { headers });
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const playerName = new Map();
    for (const t of teams) for (const p of t.roster) playerName.set(p.id, p.name);
    const label = { TRADE_ACCEPT: 'Trade', WAIVER: 'Waiver', FREEAGENT: 'Free agent' };
    return (data.transactions || [])
      .filter((t) => t.status === 'EXECUTED' && label[t.type])
      .sort((a, b) => (b.processDate || b.proposedDate) - (a.processDate || a.proposedDate))
      .slice(0, 8)
      .map((t) => ({
        when: t.processDate || t.proposedDate,
        type: label[t.type],
        text: (t.items || [])
          .map((i) => {
            const who = teamName.get(i.type === 'DROP' ? i.fromTeamId : i.toTeamId) || 'A team';
            const verb = i.type === 'DROP' ? 'drops' : i.type === 'TRADE' ? 'gets' : 'adds';
            return `${who} ${verb} ${playerName.get(`e${i.playerId}`) || 'a player'}`;
          })
          .join('; '),
        mine: t.teamId === myId,
      }));
  } catch {
    return [];
  }
}
