import type { Store } from './store.ts';
import type { ZoneBody, Attempt, Season, Fixture, Match } from './types.ts';
import { apply, season, wireTeams } from './league.ts';
import { advance, roundRobin } from './competition.ts';

const crews = [
  ['Night Shift', 'Vesper', 'Drift', 'Mercury', 'Echo'],
  ['Solar Flare', 'Sol', 'Helix', 'Ember', 'Sundog'],
  ['Void Runners', 'Nyx', 'Ghost', 'Ion', 'Rook'],
  ['Red Orbit', 'Mars', 'Vector', 'Kestrel', 'Flicker'],
  ['Deep Signal', 'Pulse', 'Static', 'Relay', 'Quasar'],
  ['Starfall', 'Nova', 'Lumen', 'Astra', 'Zenith'],
];

export function demoStats(won: boolean, losingScore: number, index: number, pilots: number) {
  const share = (total: number) => Math.floor(total / pilots) + Number(index < total % pilots);
  return { kills: share(won ? 12 : losingScore), deaths: share(won ? losingScore : 12) };
}

function demoTiming(end: string, index: number) {
  return { endedAt: end, startedAt: new Date(Date.parse(end) - (12 + index) * 60000).toISOString() };
}

function hasLegacyStats(m: Match, i: number) {
  return i < 6 && m.result?.source === 'demo' && !m.statRulings?.length
    && m.attempts[0]?.matchId === 'demo-' + i && m.result.players.length === 8
    && m.result.players.every((p, n) => p.metrics.deaths === 1 + ((n % 4 + i) % 4)
      && p.metrics.kills === 2 + ((i + n % 4 + Math.floor(n / 4)) % 7));
}

// The seeded season's draft: a snake in squad order, each squad taking its pilots in roster order.
function demoPicks(s: Season) {
  const count = s.squads.length,
    picks: Season['picks'] = [];
  const drafted = s.squads.map((t) => t.roster.filter((id) => id !== t.captain));
  const rounds = Math.max(0, ...drafted.map((list) => list.length));
  for (let turn = 0; turn < rounds * count; turn++) {
    const round = Math.floor(turn / count),
      index = round % 2 ? count - 1 - (turn % count) : turn % count;
    const player = drafted[index][round];
    if (player !== undefined) picks.push({ squad: s.squads[index].id, player, salary: s.salaries[player] ?? 0, turn });
  }
  return picks;
}

const commissioner = { id: 1, name: 'Commissioner', operator: true };
// A finished season for the first league's history: four of the crews, a round robin and a played-out bracket.
async function demoPastSeason(store: Store, leagueId: string) {
  const s = season({ name: 'Premiere Pro Preseason', format: 'single', bestOf: 1, minPerTeam: 4, playoffSpots: 4 });
  s.league = leagueId;
  for (const [i, [name, ...players]] of crews.slice(0, 4).entries()) {
    const roster = players.map((n, j) => {
      const id = 100 + i * 10 + j;
      s.players[id] = n;
      s.salaries[id] = 6 + ((i + j) % 6);
      return id;
    });
    s.squads.push({ id: 'squad-' + i, name, captain: roster[0], roster });
  }
  s.draftFinished = true;
  s.enlistedOpen = false;
  s.matches = roundRobin(s.squads.map((t) => t.id));
  const started = Date.now() - 90 * 86400000;
  const play = (m: Match, winner: string, n: number) => {
    const teams = wireTeams(s, m);
    m.result = {
      winner,
      source: 'demo',
      recordedAt: new Date(started + n * 2 * 86400000).toISOString(),
      players: [m.home, m.away].flatMap((id, k) =>
        teams[k].roster.map(({ profileId }, j) => ({
          id: profileId,
          squad: id,
          metrics: demoStats(id === winner, 5 + (n % 6), j, teams[k].roster.length),
        })),
      ),
    };
  };
  s.matches.forEach((m, i) => play(m, i % 3 ? m.home : m.away, i));
  apply(s, commissioner, 'playoffs');
  for (let n = s.matches.length; !s.champion && n < 40; n++) {
    const m = s.matches.find((x) => x.series && !x.result);
    if (!m) break;
    play(m, m.home, n);
    advance(s);
  }
  await store.insert(s);
}
// The demo shows the site hosting more than one league: the first with history, the second still signing up.
async function demoLeagues(store: Store, firstLeague: string) {
  await demoPastSeason(store, firstLeague);
  const second = await store.insertLeague('Outer Rim Open', 'Open 4v4, no draft');
  const s = season({ name: 'Outer Rim Open Season One', minPerTeam: 4 });
  s.league = second.id;
  for (const id of [2, 113, 123, 133, 143, 153]) {
    const name = (await store.query('SELECT name FROM identities WHERE id=$1', [id])).rows[0]?.name;
    if (name) s.players[id] = String(name);
  }
  demoSignups(s);
  await store.insert(s);
}
// Sign-ups spread over the last day or so, the higher profile IDs most recently
function demoSignups(s: Season) {
  s.signups = Object.fromEntries(
    Object.keys(s.players).map((id, i, all) => [id, new Date(Date.now() - (all.length - i) * 4 * 3600000).toISOString()]),
  );
}
export async function seedDemo(store: Store) {
  if ((await store.listSeasonNames()).length) return;
  const identity = (id: number, name: string) =>
    store.query('INSERT INTO identities VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=excluded.name', [id, name]);
  const firstLeague = (await store.insertLeague('Premiere Pro', '4v4 draft league')).id;
  const s = season({ name: 'Premiere Pro Season One', format: 'double', bestOf: 3, minPerTeam: 4 });
  for (const [i, [name, ...players]] of crews.entries()) {
    const roster = players.map((n, j) => {
      const id = 100 + i * 10 + j;
      s.players[id] = n;
      s.salaries[id] = 6 + ((i + j) % 6);
      return id;
    });
    for (const id of roster) await identity(id, s.players[id]);
    s.squads.push({ id: 'squad-' + i, name, captain: roster[0], roster });
  }
  await identity(1, 'Commissioner');
  await identity(2, 'Rookie');
  s.draftFinished = true;
  s.picks = demoPicks(s);
  s.matches = roundRobin(s.squads.map((t) => t.id));
  for (const [i, m] of s.matches.entries()) {
    if (i >= 9) break;
    const teams = wireTeams(s, m);
    const complete = i < 6;
    const opensAt = new Date(Date.now() + (i - 5.5) * 86400000).toISOString();
    const startsBy = new Date(Date.parse(opensAt) + 1800000).toISOString();
    const externalId = m.id + '-1';
    m.attempts.push({
      externalId,
      fixtureId: 'demo-' + externalId,
      matchId: 'demo-' + i,
      ...(complete ? demoTiming(startsBy, i) : {}),
      state: complete ? 'complete' : 'booked',
      opensAt,
      startsBy,
      resolution: complete ? 'completed' : null,
      desiredTeams: teams,
      sentTeams: teams,
      booking: { externalId, opensAt, startsBy, teams },
    });
    if (complete) {
      const winner = i % 3 ? m.home : m.away;
      m.result = {
        winner,
        source: 'demo',
        recordedAt: startsBy,
        players: [m.home, m.away].flatMap((id, k) =>
          teams[k].roster.map(({ profileId }, j) => ({
            id: profileId,
            squad: id,
            metrics: demoStats(id === winner, 6 + i % 6, j, teams[k].roster.length),
          })),
        ),
      };
    }
  }
  // The finished season comes first so the season in progress is the league's newest
  await demoLeagues(store, firstLeague);
  s.league = firstLeague;
  await store.insert(s);
}

export function demoClient(
  method: string,
  route: string,
  body: ZoneBody | undefined,
  a: Attempt,
  s: Season,
): Fixture {
  const booking = a.booking;
  const teams = (body?.teams ?? a.sentTeams ?? booking.teams).map((t) => ({
    name: t.name,
    captainProfileId: t.captainProfileId,
    players: t.roster.map((p) => ({ ...p, name: s.players[p.profileId] })),
  }));
  return {
    externalId: a.externalId,
    fixtureId: a.fixtureId ?? 'demo-' + a.externalId,
    matchId: a.matchId ?? 'demo-' + a.externalId,
    state: a.state === 'queued' ? 'booked' : a.state,
    resolution: a.resolution,
    teams,
    opensAt: body?.opensAt ?? a.opensAt ?? booking.opensAt,
    startsBy: body?.startsBy ?? a.startsBy ?? booking.startsBy,
  };
}
