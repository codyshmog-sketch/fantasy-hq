// Local preview: `node dev-server.js` (reads ESPN_SWID / ESPN_S2 from .env if present).
// `MOCK=1 node dev-server.js` serves made-up data so the page can be checked offline.
import http from 'node:http';
import fs from 'node:fs';

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
if (process.env.MOCK) await import('./test/mock-fetch.js');
const { buildDashboard } = await import('./lib/dashboard.js');
const { ask } = await import('./lib/ask.js');

const port = process.env.PORT || 3000;
http
  .createServer(async (req, res) => {
    if (req.url.startsWith('/api/dashboard')) {
      try {
        const t = Date.now();
        const data = await buildDashboard();
        console.log(`dashboard built in ${Date.now() - t}ms`);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
      } catch (e) {
        console.error(e);
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.url.startsWith('/api/ask')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const out = await ask(JSON.parse(body));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(e.status || 500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync('index.html'));
  })
  .listen(port, () => console.log(`http://localhost:${port}`));
