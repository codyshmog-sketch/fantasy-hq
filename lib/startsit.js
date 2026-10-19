// Start/Sit: side-by-side facts for your players, plus the close lineup calls
// worth a second look this week.
import { ELIGIBLE, slotLabel } from './analysis.js';
import { rosterNews } from './news.js';

const SKILL = ['QB', 'RB', 'WR', 'TE'];
const OUT = ['Out', 'IR', 'Sus', 'PUP', 'NA'];
const r1 = (n) => Math.round(n * 10) / 10;

// This week's expected points, discounted for injury risk.
export function adjusted(p) {
  if (OUT.includes(p.injury)) return 0;
  const base = p.proj || 0;
  return p.injury === 'Doubtful' ? base * 0.25 : p.injury === 'Questionable' ? base * 0.9 : base;
}

export function buildStartSit(league, U, { weekly, games, news }) {
  const me = league.teams.find((t) => t.id === league.myTeamId);
  const newsBy = new Map(rosterNews(me.roster, news || new Map(), 99).map((n) => [n.player, n]));

  const info = (p) => {
    const g = games?.get(p.nfl) || null;
    const last = weekly && p.sid ? weekly.recent(p.sid, 3) : [];
    const avg = (k) => (last.length ? r1(last.reduce((s, x) => s + (x[k] || 0), 0) / last.length) : null);
    const snaps = last.filter((x) => x.snap != null);
    const n = newsBy.get(p.name);
    return {
      id: p.id,
      name: p.name,
      pos: p.pos,
      nfl: p.nfl,
      injury: p.injury || null,
      proj: p.proj ?? null,
      adj: r1(adjusted(p)),
      value: p.value ?? null,
      ppg: p.ppg ?? null,
      game: g ? { label: g.label, opp: g.opp, state: g.state } : null,
      matchup: g?.opp && weekly && SKILL.includes(p.pos) ? weekly.defense(g.opp, p.pos) : null,
      last: last.map((x) => ({ week: x.week, pts: x.pts })),
      tgt: ['WR', 'TE', 'RB'].includes(p.pos) ? avg('tgt') : null,
      att: ['RB', 'QB'].includes(p.pos) ? avg('att') : null,
      snap: snaps.length ? Math.round(snaps.reduce((s, x) => s + x.snap, 0) / snaps.length) : null,
      news: n ? { headline: n.headline, when: n.when } : null,
    };
  };

  const pool = me.roster.filter((p) => SKILL.includes(p.pos));
  const players = pool.map(info);
  const started = (p) => { const g = games?.get(p.nfl); return !!g && g.state !== 'pre'; };

  // Close calls: a starter whose game hasn't kicked off, and bench players who
  // could take his spot and project within 3 points of him.
  const lineup = (me.lineup || []).map((x) => ({ slot: x.slot, p: x.id ? me.roster.find((q) => q.id === x.id) : null }));
  const startingIds = new Set(lineup.map((x) => x.p?.id).filter(Boolean));
  const bench = pool.filter((p) => !startingIds.has(p.id) && !started(p) && !OUT.includes(p.injury) && (p.proj || 0) > 0);
  const calls = [];
  const seen = new Set();
  for (const { slot, p } of lineup) {
    if (!p || !SKILL.includes(p.pos) || started(p)) continue;
    const el = ELIGIBLE[slot] || [p.pos];
    const rivals = bench
      .filter((b) => el.includes(b.pos) && adjusted(b) >= adjusted(p) - 3)
      .sort((a, b) => adjusted(b) - adjusted(a))
      .slice(0, 2);
    if (!rivals.length) continue;
    const ids = [p.id, ...rivals.map((b) => b.id)];
    const key = [...ids].sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ slot: slotLabel(slot), ids, gap: r1(Math.abs(adjusted(rivals[0]) - adjusted(p))) });
  }
  calls.sort((a, b) => a.gap - b.gap);

  return { players, calls: calls.slice(0, 4), startingIds: [...startingIds] };
}
