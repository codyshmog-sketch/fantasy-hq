import { runAlerts } from '../lib/alerts.js';

// Called daily by Vercel Cron (see vercel.json), or from the site's "Send test alert" button.
export default async function handler(req, res) {
  const test = req.query?.test === '1';
  const secret = process.env.CRON_SECRET;
  const pw = process.env.DASHBOARD_PASSWORD;
  const fromCron = secret ? req.headers.authorization === `Bearer ${secret}` : /vercel-cron/i.test(req.headers['user-agent'] || '');
  const fromSite = test && (!pw || req.headers['x-dashboard-key'] === pw);
  if (!fromCron && !fromSite) return res.status(401).json({ error: 'not allowed' });
  try {
    const out = await runAlerts({ test, siteUrl: `https://${req.headers['x-forwarded-host'] || req.headers.host}` });
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
