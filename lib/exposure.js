// Every player you own across all leagues: how many leagues you start him in,
// and where you're facing him this week.
const OUT = ['Out', 'IR', 'Sus', 'PUP', 'NA', 'Doubtful'];

export function buildExposure(loaded, games) {
  const rows = new Map();
  const keyOf = (p) => p.sid || `${p.name}|${p.pos}`;
  const get = (p) => {
    const k = keyOf(p);
    if (!rows.has(k)) {
      const g = games?.get(p.nfl);
      rows.set(k, {
        name: p.name, pos: p.pos, nfl: p.nfl, injury: p.injury || null, proj: p.proj ?? null, value: p.value ?? null,
        game: g ? { label: g.label, opp: g.opp, state: g.state } : null,
        own: [], start: [], face: [],
      });
    }
    const r = rows.get(k);
    if (p.injury && !r.injury) r.injury = p.injury;
    if (r.proj == null && p.proj != null) r.proj = p.proj;
    return r;
  };

  for (const { league } of loaded) {
    if (!league) continue;
    const me = league.teams.find((t) => t.id === league.myTeamId);
    const starting = new Set(me.starters);
    for (const p of me.roster) {
      const r = get(p);
      r.own.push(league.name);
      if (starting.has(p.id)) r.start.push(league.name);
    }
    const opp = league.matchup?.oppId != null ? league.teams.find((t) => t.id === league.matchup.oppId) : null;
    if (opp) {
      const oppStart = new Set(opp.starters);
      for (const p of opp.roster) if (oppStart.has(p.id)) get(p).face.push(league.name);
    }
  }

  const players = [...rows.values()]
    .filter((r) => r.own.length || r.face.length)
    // An injury tag picked up after kickoff doesn't count; he's already played.
    .map((r) => ({ ...r, risk: r.start.length > 0 && OUT.includes(r.injury) && (!r.game || r.game.state === 'pre') }))
    .sort((a, b) => b.start.length - a.start.length || b.own.length - a.own.length || (b.value || 0) - (a.value || 0));

  // Which NFL games your starters are riding on.
  const byTeam = new Map();
  for (const r of players) if (r.start.length && r.pos !== 'DEF') byTeam.set(r.nfl, (byTeam.get(r.nfl) || 0) + r.start.length);
  const teams = [...byTeam].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([nfl, starts]) => ({ nfl, starts, game: games?.get(nfl) ? { label: games.get(nfl).label, opp: games.get(nfl).opp } : null }));

  return { players, teams, leagues: loaded.filter((x) => x.league).length };
}
