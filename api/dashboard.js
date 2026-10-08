import { buildDashboard } from '../lib/dashboard.js';

export default async function handler(req, res) {
  // Optional: set DASHBOARD_PASSWORD so only you can load your leagues.
  const pw = process.env.DASHBOARD_PASSWORD;
  if (pw && req.headers['x-dashboard-key'] !== pw) return res.status(401).json({ error: 'password' });
  try {
    const data = await buildDashboard();
    res.setHeader('cache-control', 'private, max-age=60');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
