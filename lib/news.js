// Recent ESPN fantasy news for your own players (public, no login needed).
import { getJSON, MIN } from './http.js';

const DAYS = 5;

async function newsFor(espnId) {
  const data = await getJSON(`https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=3&playerId=${espnId}`, { ttl: 30 * MIN, timeout: 5000 });
  const cutoff = Date.now() - DAYS * 864e5;
  return (data.feed || [])
    .map((n) => ({ headline: n.headline, blurb: (n.description || '').slice(0, 280), when: Date.parse(n.published || n.lastModified), url: n.links?.web?.href || null }))
    .filter((n) => n.headline && n.when > cutoff);
}

// espnIds -> Map(espnId -> [news]). Failures just mean no news for that player.
export async function loadNews(espnIds) {
  const ids = [...new Set(espnIds.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 12) {
    await Promise.all(ids.slice(i, i + 12).map((id) => newsFor(id).then((n) => out.set(id, n), () => out.set(id, []))));
  }
  return out;
}

// The newest stories about players on your roster, one per player.
// ESPN's per-player feed also returns general articles that only link to him, so
// keep a story only when its headline or summary actually names the player.
function mentions(n, name) {
  const last = name.replace(/\b(Jr|Sr|II|III|IV|V)\.?$/i, '').trim().split(' ').pop().toLowerCase();
  return last.length > 1 && `${n.headline} ${n.blurb}`.toLowerCase().includes(last);
}

export function rosterNews(roster, news, limit = 6) {
  return roster
    .filter((p) => p.pos !== 'DEF')
    .flatMap((p) => (news.get(p.espnId) || []).filter((n) => mentions(n, p.name)).slice(0, 1).map((n) => ({ player: p.name, pos: p.pos, ...n })))
    .sort((a, b) => b.when - a.when)
    .slice(0, limit);
}
