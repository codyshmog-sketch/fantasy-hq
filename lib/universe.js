// The shared player universe: Sleeper's player list, weekly PPR projections and
// season-to-date stats. Every league (ESPN too) is valued against this so trade
// and waiver ideas use one consistent yardstick.
import { getJSON, MIN, HOUR } from './http.js';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const posQuery = POSITIONS.map((p) => `position[]=${p}`).join('&');

export const ESPN_TEAM = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

export function nameKey(name, pos) {
  const n = String(name || '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z]/g, '');
  return `${n}|${pos}`;
}

async function projectionsForWeek(season, week) {
  const rows = await getJSON(
    `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&${posQuery}`,
    { ttl: 30 * MIN },
  ).catch(() => []);
  const out = new Map();
  for (const r of rows) {
    const pts = r?.stats?.pts_ppr;
    if (r?.player_id && typeof pts === 'number') out.set(String(r.player_id), pts);
  }
  return out;
}

export async function loadUniverse() {
  const state = await getJSON('https://api.sleeper.app/v1/state/nfl', { ttl: 30 * MIN });
  const season = Number(state.season);
  const week = Math.max(1, Number(state.display_week || state.week || 1));
  const regular = state.season_type === 'regular';

  const [rawPlayers, stats, ...projWeeks] = await Promise.all([
    getJSON('https://api.sleeper.app/v1/players/nfl', { ttl: 12 * HOUR }),
    getJSON(`https://api.sleeper.com/stats/nfl/${season}?season_type=regular&${posQuery}`, { ttl: 30 * MIN }).catch(() => []),
    projectionsForWeek(season, week),
    projectionsForWeek(season, week + 1),
    projectionsForWeek(season, week + 2),
  ]);

  const players = new Map();
  const byName = new Map();
  const defByTeam = new Map();
  for (const [id, p] of Object.entries(rawPlayers)) {
    const pos = p.position === 'DEF' ? 'DEF' : (p.fantasy_positions || [p.position])[0];
    if (!POSITIONS.includes(pos)) continue;
    const name = pos === 'DEF' ? `${p.team} D/ST` : p.full_name || `${p.first_name} ${p.last_name}`;
    const rec = {
      sid: id,
      name,
      pos,
      nfl: p.team || 'FA',
      injury: p.injury_status || null,
      active: p.active !== false,
    };
    players.set(id, rec);
    if (pos === 'DEF') defByTeam.set(p.team, id);
    else {
      const k = nameKey(name, pos);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(rec);
    }
  }

  const actual = new Map();
  for (const r of stats) {
    const gp = r?.stats?.gp || 0;
    if (r?.player_id && gp > 0) actual.set(String(r.player_id), { pts: r.stats.pts_ppr || 0, gp });
  }

  const [thisWeek] = projWeeks;
  // Value = points per game going forward: mostly the next three weekly
  // projections (ignoring bye weeks), blended with what he's actually scored.
  const valueCache = new Map();
  function value(sid) {
    if (!sid) return 0;
    if (valueCache.has(sid)) return valueCache.get(sid);
    const upcoming = projWeeks.map((m) => m.get(sid)).filter((v) => typeof v === 'number' && v > 0);
    const ros = upcoming.length ? upcoming.reduce((a, b) => a + b, 0) / upcoming.length : 0;
    const a = actual.get(sid);
    const actualPPG = a && a.gp >= 2 ? a.pts / a.gp : null;
    let v = actualPPG == null ? ros : ros ? 0.7 * ros + 0.3 * actualPPG : 0.3 * actualPPG;
    const p = players.get(sid);
    if (p && ['IR', 'PUP', 'Sus', 'NA'].includes(p.injury)) v *= 0.5;
    v = Math.round(v * 10) / 10;
    valueCache.set(sid, v);
    return v;
  }

  return {
    season,
    week,
    regular,
    players,
    actual,
    ppg(sid) {
      const a = sid && actual.get(sid);
      return a && a.gp ? Math.round((a.pts / a.gp) * 10) / 10 : null;
    },
    projThisWeek: (sid) => (sid ? thisWeek.get(sid) ?? null : null),
    value,
    findSid(name, pos, espnTeamId) {
      if (pos === 'DEF') return defByTeam.get(ESPN_TEAM[espnTeamId]) || null;
      // Same name can belong to two players; prefer the one on the same NFL team, then active ones.
      const options = byName.get(nameKey(name, pos)) || [];
      const best = options.find((p) => p.nfl === ESPN_TEAM[espnTeamId]) || options.find((p) => p.active) || options[0];
      return best?.sid || null;
    },
  };
}
