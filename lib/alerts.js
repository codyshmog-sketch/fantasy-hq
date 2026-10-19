// Pre-kickoff check across every league: starters who are out, doubtful,
// questionable, on bye, or empty spots. Sent to your phone through ntfy.sh.
import { buildDashboard } from './dashboard.js';

const BAD = ['Out', 'IR', 'Sus', 'PUP', 'NA', 'Doubtful'];

// hours: only flag players whose game kicks off within this many hours.
export function findIssues(data, { hours = 26, includeByes = true, now = Date.now() } = {}) {
  const soon = (row) => row.state === 'pre' && row.start && new Date(row.start).getTime() - now < hours * 36e5;
  const out = [];
  for (const L of data.leagues) {
    if (L.error) { out.push({ league: L.name, level: 'bad', text: `Couldn't load: ${L.error}` }); continue; }
    const rows = L.matchup?.myRows || (L.lineup?.current || []).map((x) => ({ slot: x.slot, player: x.player, state: 'pre', start: null }));
    for (const r of rows) {
      const p = r.player;
      if (!p) { if (includeByes) out.push({ league: L.name, level: 'bad', text: `Empty ${r.slot} spot` }); continue; }
      if (r.state === 'bye') { if (includeByes) out.push({ league: L.name, level: 'bad', text: `${p.name} is on bye` }); continue; }
      if (!soon(r)) continue;
      if (BAD.includes(p.injury)) out.push({ league: L.name, level: 'bad', text: `${p.name} is ${p.injury}` });
      else if (p.injury === 'Questionable') out.push({ league: L.name, level: 'warn', text: `${p.name} is Questionable` });
      else if (!p.proj) out.push({ league: L.name, level: 'bad', text: `${p.name} has no projection` });
    }
  }
  return out;
}

export function formatIssues(issues) {
  const byLeague = new Map();
  for (const i of issues) (byLeague.get(i.league) || byLeague.set(i.league, []).get(i.league)).push(i);
  return [...byLeague].map(([league, list]) => `${league}: ${list.map((i) => i.text).join('; ')}`).join('\n');
}

export async function runAlerts({ env = process.env, test = false, siteUrl = '' } = {}) {
  const topic = env.NTFY_TOPIC?.trim();
  if (!topic) return { sent: false, reason: 'NTFY_TOPIC is not set' };
  const data = await buildDashboard(env);
  const day = new Date().getUTCDay();
  // Byes and empty spots only on Thursday and Sunday, so they don't repeat daily.
  const issues = findIssues(data, { hours: test ? 24 * 7 : 26, includeByes: test || day === 4 || day === 0 });
  const bad = issues.some((i) => i.level === 'bad');
  if (!issues.length && !test && day !== 0) return { sent: false, reason: 'nothing to report', issues };

  const title = test ? 'Fantasy HQ test alert' : issues.length ? `Lineup check: ${issues.length} thing${issues.length > 1 ? 's' : ''} to fix` : 'All lineups look good';
  const body = issues.length ? formatIssues(issues) : `All ${data.leagues.length} lineups are set for today's games.`;
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    body,
    headers: {
      Title: title,
      Tags: issues.length ? (bad ? 'rotating_light' : 'warning') : 'white_check_mark',
      Priority: bad ? '4' : '3',
      ...(siteUrl ? { Click: siteUrl } : {}),
    },
  });
  return { sent: res.ok, status: res.status, issues };
}
