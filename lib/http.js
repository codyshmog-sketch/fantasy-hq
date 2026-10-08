// Small fetch helpers with an in-memory cache that lives as long as the server
// instance does (minutes on a serverless host, which is what we want).
const cache = new Map();

export async function getJSON(url, { headers = {}, ttl = 0 } = {}) {
  const key = url + JSON.stringify(headers);
  const hit = cache.get(key);
  if (ttl && hit && hit.expires > Date.now()) return hit.data;

  const res = await fetch(url, { headers: { 'user-agent': 'ff-dashboard', ...headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${res.status} from ${new URL(url).host}${body ? `: ${body.slice(0, 160)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (ttl) cache.set(key, { data, expires: Date.now() + ttl * 1000 });
  return data;
}

export const MIN = 60;
export const HOUR = 3600;
