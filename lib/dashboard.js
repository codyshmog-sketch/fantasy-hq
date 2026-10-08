import { LEAGUES, SLEEPER_USERNAMES } from '../leagues.config.js';
import { loadUniverse } from './universe.js';
import { loadSleeperLeague } from './sleeper.js';
import { loadEspnLeague } from './espn.js';
import { analyzeLeague } from './analysis.js';

export async function loadLeague(cfg, U, env = process.env) {
  const espn = { swid: env.ESPN_SWID, s2: env.ESPN_S2 };
  return cfg.platform === 'espn' ? loadEspnLeague(cfg, U, espn) : loadSleeperLeague(cfg, U, SLEEPER_USERNAMES);
}

export async function buildDashboard(env = process.env) {
  const U = await loadUniverse();

  const leagues = await Promise.all(
    LEAGUES.map(async (cfg) => {
      try {
        const league = await loadLeague(cfg, U, env);
        return analyzeLeague(league, U);
      } catch (e) {
        return { platform: cfg.platform, id: cfg.id, name: cfg.name || `Sleeper league ${cfg.id}`, error: e.message };
      }
    }),
  );

  return { generatedAt: new Date().toISOString(), season: U.season, week: U.week, leagues };
}
