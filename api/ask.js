import { ask } from '../lib/ask.js';

export default async function handler(req, res) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (pw && req.headers['x-dashboard-key'] !== pw) return res.status(401).json({ error: 'password' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    if (!messages.length) return res.status(400).json({ error: 'Ask a question first' });
    res.status(200).json(await ask({ leagueId: body.leagueId, messages }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}
