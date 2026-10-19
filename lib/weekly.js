// Week-by-week stats so far this season (Sleeper), for two things the Start/Sit
// view needs: each player's recent usage, and how many PPR points each defense
// gives up to each position.
import { getJSON, MIN } from './http.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const posQuery = POS.map((p) => `position[]=${p}`).join('&');

export async function loadWeekly(season, week) {
  const weeks = [];
  for (let w = 1; w < week; w++) weeks.push(w);
  const all = await Promise.all(
    weeks.map((w) =>
      getJSON(`https://api.sleeper.com/stats/nfl/${season}/${w}?season_type=regular&${posQuery}`, { ttl: 6 * 60 * MIN, timeout: 8000 })
        .then((rows) => rows.map((r) => ({ ...r, week: w })))
        .catch(() => []),
    ),
  );

  const games = new Map(); // sid -> [{ week, pts, tgt, att, snap }]
  const allowed = new Map(); // `${defense}|${pos}` -> Map(week -> pts)
  for (const rows of all) {
    for (const r of rows) {
      const s = r.stats || {};
      if (!r.player_id || !(s.gp > 0 || s.off_snp > 0)) continue;
      const pos = r.player?.position;
      const pts = s.pts_ppr || 0;
      const g = { week: r.week, pts: Math.round(pts * 10) / 10, tgt: s.rec_tgt || 0, att: s.rush_att || 0, snap: s.off_snp && s.tm_off_snp ? Math.round((100 * s.off_snp) / s.tm_off_snp) : null };
      (games.get(String(r.player_id)) || games.set(String(r.player_id), []).get(String(r.player_id))).push(g);
      if (r.opponent && POS.includes(pos)) {
        const k = `${r.opponent}|${pos}`;
        const m = allowed.get(k) || allowed.set(k, new Map()).get(k);
        m.set(r.week, (m.get(r.week) || 0) + pts);
      }
    }
  }

  // Average allowed per game, ranked within each position: 1 = gives up the most (easiest matchup).
  const avg = new Map();
  for (const [k, m] of allowed) avg.set(k, [...m.values()].reduce((a, b) => a + b, 0) / m.size);
  const rank = new Map();
  for (const pos of POS) {
    const list = [...avg].filter(([k]) => k.endsWith(`|${pos}`)).sort((a, b) => b[1] - a[1]);
    list.forEach(([k, v], i) => rank.set(k, { rank: i + 1, of: list.length, avg: Math.round(v * 10) / 10 }));
  }

  return {
    recent(sid, n = 3) {
      const g = (games.get(String(sid)) || []).sort((a, b) => a.week - b.week);
      return g.slice(-n);
    },
    defense(team, pos) {
      return rank.get(`${team}|${pos}`) || null;
    },
  };
}
