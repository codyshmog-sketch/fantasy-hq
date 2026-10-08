import { LEAGUES, SLEEPER_USERNAMES } from '../leagues.config.js';
import { loadUniverse } from './universe.js';
import { loadSleeperLeague } from './sleeper.js';
import { loadEspnLeague } from './espn.js';
import { analyzeLeague } from './analysis.js';
import { loadNews, rosterNews } from './news.js';

export async function loadLeague(cfg, U, env = process.env) {
  const espn = { swid: env.ESPN_SWID, s2: env.ESPN_S2 };
  return cfg.platform === 'espn' ? loadEspnLeague(cfg, U, espn) : loadSleeperLeague(cfg, U, SLEEPER_USERNAMES);
}

export async function buildDashboard(env = process.env) {
  const U = await loadUniverse();

  const loaded = await Promise.all(
    LEAGUES.map((cfg) => loadLeague(cfg, U, env).then((league) => ({ cfg, league }), (e) => ({ cfg, error: e.message }))),
  );
  const myPlayers = loaded.flatMap(({ league }) => (league ? league.teams.find((t) => t.id === league.myTeamId).roster : []));
  const news = await loadNews(myPlayers.map((p) => p.espnId)).catch(() => new Map());

  const leagues = loaded.map(({ cfg, league, error }) => {
    if (error) return { platform: cfg.platform, id: cfg.id, name: cfg.name || `Sleeper league ${cfg.id}`, error };
    try {
      const out = analyzeLeague(league, U);
      out.news = rosterNews(league.teams.find((t) => t.id === league.myTeamId).roster, news);
      return out;
    } catch (e) {
      return { platform: cfg.platform, id: cfg.id, name: league.name, error: e.message };
    }
  });

  return { generatedAt: new Date().toISOString(), season: U.season, week: U.week, askEnabled: !!env.ANTHROPIC_API_KEY, leagues };
}
