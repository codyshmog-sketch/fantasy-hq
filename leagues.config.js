// Your leagues. No secrets here: ESPN cookies come from the ESPN_SWID and
// ESPN_S2 environment variables on the server.
export const SLEEPER_USERNAMES = ['emartinator'];

export const LEAGUES = [
  { platform: 'espn', id: '1339314204', name: "Hightstown's Finest", team: 'Team Shmog' },
  { platform: 'espn', id: '1505500433', name: 'Zeeb League', team: 'Weatherman' },
  { platform: 'espn', id: '880282876', name: 'Real Deal', team: "E Mart's Minions" },
  { platform: 'sleeper', id: '1395476767719837696' },
  { platform: 'sleeper', id: '1401344727613251584' },
  {
    platform: 'sleeper',
    id: '1389346268110651392',
    team: 'Maye We Pipe Heather',
    // Keep 1 player a year; he costs the pick one round earlier than where he was drafted.
    keeper: { max: 1, roundsEarlier: 1 },
  },
];
