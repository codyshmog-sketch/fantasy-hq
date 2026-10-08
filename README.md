# Fantasy HQ

One page that pulls all six of your leagues (3 ESPN, 3 Sleeper) every time you open it and shows:

- **To do before kickoff**: injured, benched-on-bye or empty starters across every league
- **Lineup**: the best lineup for this week from projections, with the swaps to make
- **Waiver wire**: free agents who beat your weakest starter
- **Trades**: 1-for-1 and 2-for-1 ideas that improve your lineup and plausibly help the other team too
- **Keeper** (Maye We Pipe Heather): what each player would cost to keep next year vs. where he'd go in a draft; keeper value also counts in that league's trade ideas

Leagues live in `leagues.config.js`. All leagues are scored as full PPR.

## How values work

Every player gets a points-per-game value: mostly his Sleeper PPR projections for the next three weeks (byes skipped), blended 70/30 with what he's actually scored this season. ESPN lineups use ESPN's own weekly projections. Trade ideas compare each team's best lineup before and after the deal.

## Deploy (Vercel)

1. Import this repo at vercel.com/new (no build settings needed).
2. In Project → Settings → Environment Variables add:
   - `ESPN_SWID` = your SWID, including the braces
   - `ESPN_S2` = your espn_s2 cookie, exactly as copied
   - `DASHBOARD_PASSWORD` (optional) = anything; the page asks for it once per browser
3. Deploy. The ESPN cookies never reach the browser; only the server function uses them.

If ESPN leagues start showing "rejected the login cookies", log into ESPN again, copy a fresh `espn_s2`, and update the variable.

## Run locally

```
echo 'ESPN_SWID={...}' > .env; echo 'ESPN_S2=...' >> .env
node dev-server.js            # http://localhost:3000
MOCK=1 node dev-server.js     # made-up data, no network needed
```
