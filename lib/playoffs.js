// Playoff odds by simulating the rest of the regular season many times.
// Each team scores around its best lineup's weekly value, with a realistic
// spread; standings are wins, then points for.

const SIMS = 4000;
const TEAM_SD = 26;

// Seeded so the numbers don't jitter on every refresh.
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function normal(r) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

// teams: [{ id, wins, losses, ties, pf, mean }], schedule: [{ week, a, b }]
// override: optional { week, id, winPct } for your current game, using the live odds.
export function playoffOdds(teams, schedule, playoffTeams, myId, override = null) {
  if (!playoffTeams || !teams.length) return null;
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const games = schedule.filter((g) => idx.has(g.a) && idx.has(g.b));
  const myGames = games.filter((g) => g.a === myId || g.b === myId);
  const made = new Array(teams.length).fill(0);
  const winsSum = new Array(teams.length).fill(0);
  // For each of your remaining games: playoff count when you win vs lose.
  const swing = myGames.map(() => ({ w: 0, wIn: 0, l: 0, lIn: 0 }));
  const r = rng(teams.length * 7919 + games.length * 104729 + Math.round(teams.reduce((s, t) => s + t.mean, 0)));
  const me = idx.get(myId);

  for (let s = 0; s < SIMS; s++) {
    const wins = teams.map((t) => t.wins + 0.5 * (t.ties || 0));
    const pf = teams.map((t) => t.pf);
    const myResults = [];
    for (const g of games) {
      const i = idx.get(g.a);
      const j = idx.get(g.b);
      const si = teams[i].mean + TEAM_SD * normal(r);
      const sj = teams[j].mean + TEAM_SD * normal(r);
      let iWins = si > sj;
      if (override && g.week === override.week && (g.a === override.id || g.b === override.id)) {
        const meWins = r() * 100 < override.winPct;
        iWins = g.a === override.id ? meWins : !meWins;
      }
      wins[iWins ? i : j] += 1;
      pf[i] += si;
      pf[j] += sj;
      if (i === me || j === me) myResults.push(i === me ? iWins : !iWins);
    }
    const order = teams.map((_, k) => k).sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x]);
    const inSet = new Set(order.slice(0, playoffTeams));
    order.forEach((k) => (winsSum[k] += wins[k]));
    inSet.forEach((k) => (made[k] += 1));
    const meIn = inSet.has(me);
    myResults.forEach((won, n) => {
      const x = swing[n];
      if (won) { x.w += 1; if (meIn) x.wIn += 1; } else { x.l += 1; if (meIn) x.lIn += 1; }
    });
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  return {
    playoffTeams,
    weeksLeft: new Set(games.map((g) => g.week)).size,
    teams: teams
      .map((t, k) => ({ id: t.id, name: t.name, wins: t.wins, losses: t.losses, ties: t.ties || 0, pct: pct(made[k], SIMS), projWins: Math.round((winsSum[k] / SIMS) * 10) / 10, mine: t.id === myId }))
      .sort((a, b) => b.pct - a.pct || b.projWins - a.projWins),
    myGames: myGames.map((g, n) => ({
      week: g.week,
      oppId: g.a === myId ? g.b : g.a,
      ifWin: pct(swing[n].wIn, swing[n].w),
      ifLose: pct(swing[n].lIn, swing[n].l),
    })),
  };
}
