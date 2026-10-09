// This week's NFL games from ESPN's public scoreboard, so we know how much of
// each player's game is left (for live projections and win odds).
import { getJSON, MIN } from './http.js';

const FIX = { WSH: 'WAS', JAC: 'JAX' };

export async function loadGames(season, week) {
  const data = await getJSON(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`,
    { ttl: 2 * MIN, timeout: 6000 },
  );
  const games = new Map();
  for (const ev of data.events || []) {
    const comp = ev.competitions?.[0];
    const st = comp?.status || ev.status || {};
    const state = st.type?.state || 'pre';
    let left = state === 'pre' ? 1 : 0;
    if (state === 'in') {
      const q = st.period || 1;
      left = q > 4 ? 0.03 : Math.max(0.02, ((4 - q) * 900 + (st.clock || 0)) / 3600);
    }
    const teams = (comp?.competitors || []).map((c) => FIX[c.team?.abbreviation] || c.team?.abbreviation);
    const label = state === 'pre' ? new Date(ev.date).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : st.type?.shortDetail || (state === 'post' ? 'Final' : 'Live');
    for (const t of teams) games.set(t, { state, left, label, opp: teams.find((x) => x !== t) });
  }
  return games;
}
