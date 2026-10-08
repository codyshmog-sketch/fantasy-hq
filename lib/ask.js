// "Ask Claude": grades trade offers and answers questions about one league,
// with every roster in that league and our player values as context.
import Anthropic from '@anthropic-ai/sdk';
import { LEAGUES } from '../leagues.config.js';
import { loadUniverse } from './universe.js';
import { loadLeague } from './dashboard.js';

const SYSTEM = `You are a sharp, friendly fantasy football advisor for one manager who plays in six leagues. All leagues are full PPR.

You get one league's full context: scoring, starting lineup slots, every team's roster, and for each player our numbers: "val" (projected PPR points per game going forward, blending the next three weeks of projections with season-to-date scoring), "ppg" (actual PPR points per game this season), "wk" (this week's projection) and injury status. The manager's team is marked [YOU]. Use these numbers as your baseline and add your own football knowledge (roles, injuries, schedules, trends). Your knowledge may be out of date, so when the numbers and your memory disagree, trust the numbers and say so.

When asked about a trade:
- Start with a letter grade from the manager's side (A+ to F) and a one-line verdict: accept, decline, or counter.
- Explain in a few short bullets: value given vs received, how the manager's starting lineup changes, positional depth, injury or bye risk.
- In a keeper league, factor in keeper value: a player's keeper cost is listed, and a cheap keeper who plays like an early-round pick has extra value beyond this season.
- If declining, suggest a specific counter using real players from the two rosters.

Keep answers short and skimmable: no long preambles, plain language, real player names.`;

function fmt(p, keeper) {
  const bits = [`${p.name} (${p.pos}, ${p.nfl})`, `val ${p.value ?? 0}`];
  if (p.ppg != null) bits.push(`ppg ${p.ppg}`);
  if (p.proj != null) bits.push(`wk ${p.proj}`);
  if (p.injury) bits.push(p.injury);
  if (keeper && p.sid) {
    const d = keeper.drafted[p.sid];
    const lastRound = keeper.rounds || 15;
    const cost = Math.max(1, (d ? d.round : lastRound) - keeper.rules.roundsEarlier);
    bits.push(`keeper cost R${cost}${d ? ` (drafted R${d.round})` : ' (undrafted)'}`);
  }
  return bits.join(', ');
}

export function leagueContext(league) {
  const lines = [
    `League: ${league.name} (${league.platform.toUpperCase()}, ${league.size} teams, ${league.ppr ?? 1} PPR)`,
    `Starting slots: ${league.slots.join(', ')}`,
  ];
  if (league.keeper) {
    lines.push(`Keeper rules: keep ${league.keeper.rules.max} player per year; he costs the pick ${league.keeper.rules.roundsEarlier} round earlier than the round he was drafted in. Undrafted pickups are assumed to cost the last round.`);
  }
  for (const t of league.teams) {
    const you = t.id === league.myTeamId ? ' [YOU]' : '';
    lines.push('', `## ${t.name}${you} (${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}, ${Math.round(t.pf)} PF)`);
    const starters = new Set(t.starters);
    const roster = [...t.roster].sort((a, b) => (b.value || 0) - (a.value || 0));
    for (const p of roster) lines.push(`- ${starters.has(p.id) ? '[S] ' : ''}${fmt(p, league.keeper)}`);
  }
  return lines.join('\n');
}

export async function ask({ leagueId, messages }, env = process.env) {
  if (!env.ANTHROPIC_API_KEY) {
    const err = new Error('Ask Claude needs an ANTHROPIC_API_KEY set on the server.');
    err.status = 503;
    throw err;
  }
  const cfg = LEAGUES.find((l) => l.id === leagueId);
  if (!cfg) throw Object.assign(new Error('Unknown league'), { status: 400 });

  const U = await loadUniverse();
  const league = await loadLeague(cfg, U, env);
  const context = `Week ${U.week} of the ${U.season} season.\n\n${leagueContext(league)}`;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [
      { type: 'text', text: SYSTEM },
      { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
    ],
    messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 8000) })),
  });

  if (response.stop_reason === 'refusal') return { answer: "Sorry, I couldn't answer that one." };
  const answer = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { answer: answer || "Sorry, I didn't get an answer back. Try asking again." };
}
