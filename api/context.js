import { buildBrief } from '../lib/ask.js';

// Returns one league (or ?league=all) as a plain-text brief to paste into Claude.
export default async function handler(req, res) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (pw && req.headers['x-dashboard-key'] !== pw) return res.status(401).json({ error: 'password' });
  try {
    const league = new URL(req.url, 'http://x').searchParams.get('league') || 'all';
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.status(200).send(await buildBrief(league));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}
