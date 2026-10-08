import { LEAGUES, SLEEPER_USERNAMES } from '../leagues.config.js';
import { loadUniverse } from './universe.js';
import { loadSleeperLeague } from './sleeper.js';
import { loadEspnLeague } from './espn.js';
import { analyzeLeague } from './analysis.js';

export async function buildDashboard(env = process.env) {
  const U = await loadUniverse();
  const espn = { swid: env.ESPN_SWID, s2: env.ESPN_S2 };

  const leagues = await Promise.all(
    LEAGUES.map(async (cfg) => {
      try {
        const league = cfg.platform === 'espn' ? await loadEspnLeague(cfg, U, espn) : await loadSleeperLeague(cfg, U, SLEEPER_USERNAMES);
        return analyzeLeague(league, U);
      } catch (e) {
        return { platform: cfg.platform, id: cfg.id, name: cfg.name || `Sleeper league ${cfg.id}`, error: e.message };
      }
    }),
  );

  return { generatedAt: new Date().toISOString(), season: U.season, week: U.week, leagues };
}
