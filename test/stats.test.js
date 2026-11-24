import test from 'node:test';
import assert from 'node:assert/strict';
import { season, apply } from '../src/league.ts';
import { formatStat, leaderStats, matchGroups, qualifyingGames, rankBy, seasonGroups, seasonStats, stats, statValue } from '../src/stats.ts';

const op = { id: 1, name: 'Operator', operator: true };
const stat = (key) => stats.get(key);

test('a statistic sums its counters before dividing, and a counter that was never reported is not a zero', () => {
  const line = { kills: 9, deaths: 4, playingTime: 1500, gunHits: 30, firesBullet: 240, damageDealtGuns: 9000, damageDealtBombs: 1000, damageTakenGuns: 6000, damageTakenBombs: 4000 };
  assert.equal(statValue(stat('kills'), line), 9);
  assert.equal(statValue(stat('kd'), line), 2.25);
  // Per ten minutes in a ship: 9 kills in 25 minutes
  assert.equal(statValue(stat('kills10'), line), 3.6);
  assert.equal(statValue(stat('gunAccuracy'), line), 0.125);
  assert.equal(statValue(stat('damage'), line), 10000);
  assert.equal(statValue(stat('exchange'), line), 0.5);
  // With no deaths the ratio reads as the kills, not as a division by nothing
  assert.equal(statValue(stat('kd'), { kills: 4, deaths: 0 }), 4);
  // Imported with only kills and deaths: there is no accuracy or damage to show, and no rate without the time
  const thin = { kills: 3, deaths: 3 };
  for (const key of ['gunAccuracy', 'damage', 'damage10', 'kills10', 'forcedReps', 'time']) assert.equal(statValue(stat(key), thin), null, key);
  assert.equal(statValue(stat('kills10'), { kills: 3, playingTime: 0 }), null);
  // One of two counters is enough for a total: bombs may simply not have been fired
  assert.equal(statValue(stat('damage'), { damageDealtGuns: 700 }), 700);

  assert.equal(formatStat(stat('kd'), 2.25), '2.25');
  assert.equal(formatStat(stat('kills10'), 3.6), '3.6');
  assert.equal(formatStat(stat('gunAccuracy'), 0.1318), '13.2%');
  assert.equal(formatStat(stat('time'), 32081), '8:54:41');
  assert.equal(formatStat(stat('time'), 1463), '24:23');
  assert.deepEqual([999, 1500, 21400, 1_100_000].map((n) => formatStat(stat('damage'), n)), ['999', '1.5k', '21k', '1.1M']);
  assert.equal(formatStat(stat('kills'), 1234), '1,234');
  assert.equal(formatStat(stat('kills'), null), '–');
  // Every statistic a table or leaderboard names is defined
  for (const s of [...seasonGroups, ...matchGroups].flatMap((g) => g.stats).concat(leaderStats)) assert.ok(s?.key, 'defined');
});

function played() {
  const s = season({ name: 'Stats', minPerTeam: 1 });
  const pilots = [10, 11, 20, 21].map((id) => ({ id, name: 'Pilot ' + id }));
  for (const p of pilots) apply(s, p, 'enlist');
  apply(s, op, 'addSquad', { name: 'North', player: 10 });
  apply(s, op, 'addSquad', { name: 'South', player: 20 });
  const [north, south] = s.squads.map((t) => t.id);
  apply(s, op, 'assign', { player: 11, squad: north });
  apply(s, op, 'assign', { player: 21, squad: south });
  const line = (id, squad, kills, deaths, playingTime) => ({ id, squad, metrics: { kills, deaths, playingTime } });
  let made = 0;
  const game = (series, winner, players) => ({ id: 'm' + made++, home: north, away: south, round: 1, series, attempts: [], proposal: null, rulings: [], result: { winner, source: 'import', players, recordedAt: '2026-01-01T00:00:00.000Z' } });
  s.matches.push(
    game(null, north, [line(10, north, 8, 2, 1200), line(11, north, 4, 4, 1200), line(20, south, 6, 12, 1200)]),
    game(null, south, [line(10, north, 2, 6, 600), line(20, south, 9, 3, 600), line(21, south, 3, 0, 60)]),
    // A forfeit counts as a game for the squads and for no pilot
    game(null, north, []),
    game('Upper-1-1', north, [line(10, north, 5, 1, 600), line(20, south, 1, 5, 600)]),
  );
  return { s, north, south };
}

test('season statistics add up by pilot and by squad, for the whole season or one stage of it', () => {
  const { s, north, south } = played();
  const all = seasonStats(s);
  const pilot = (rows, id) => rows.pilots.find((row) => row.id === String(id)).counters;
  assert.deepEqual(pilot(all, 10), { games: 3, wins: 2, kills: 15, deaths: 9, playingTime: 2400 });
  assert.deepEqual(pilot(all, 21), { games: 1, wins: 1, kills: 3, deaths: 0, playingTime: 60 });
  assert.equal(all.pilots.find((row) => row.id === '10').squad, north);
  const side = (rows, id) => rows.squads.find((row) => row.id === id).counters;
  assert.deepEqual(side(all, north), { games: 4, wins: 3, kills: 19, deaths: 13, playingTime: 3600 });
  assert.deepEqual([side(all, south).games, side(all, south).wins], [4, 1]);
  assert.deepEqual(pilot(seasonStats(s, 'regular'), 10), { games: 2, wins: 1, kills: 10, deaths: 8, playingTime: 1800 });
  assert.deepEqual(pilot(seasonStats(s, 'playoffs'), 10), { games: 1, wins: 1, kills: 5, deaths: 1, playingTime: 600 });
  assert.equal(seasonStats(s, 'playoffs').pilots.some((row) => row.id === '11'), false);

  // Ranked on a total, everyone is in order of the figure
  assert.deepEqual(rankBy(all.pilots, stat('kills')).map((row) => row.id), ['20', '10', '11', '21']);
  // Ranked on a rate, a pilot with one short appearance does not lead those who have played the games
  const qualified = (row) => row.counters.games >= qualifyingGames;
  assert.equal(rankBy(all.pilots, stat('kills10'))[0].id, '21');
  assert.deepEqual(rankBy(all.pilots, stat('kills10'), qualified).map((row) => row.id), ['20', '10', '21', '11']);
  // Fewer is better for deaths
  assert.equal(rankBy(all.pilots, stat('deaths')).at(0).id, '21');
});

test('fuller statistics replace a played match’s numbers and leave its result, line-up and corrections alone', () => {
  const { s, north } = played();
  // Matches are found by the zone's match ID or by their number on the site
  s.matches[0].number = 1;
  s.matches[1].attempts.push({ externalId: 'x', state: 'complete', matchId: 'zone-7', booking: { externalId: 'x', opensAt: '', startsBy: '', teams: [] }, desiredTeams: [], mappedPlayers: structuredClone(s.matches[1].result.players) });
  apply(s, op, 'correctMetric', { match: s.matches[0].id, player: 11, metric: 'kills', value: 5, reason: 'Replay review' });
  const run = (data, actor = op) => apply(s, actor, 'importStats', { data: JSON.stringify(data) });
  const full = (kills, deaths) => ({ kills, deaths, playingTime: 1200, gunHits: 40, firesBullet: 400 });
  const file = {
    matches: [
      { number: 1, players: [{ id: 10, metrics: full(8, 2) }, { id: 11, metrics: full(4, 4) }] },
      { matchId: 'zone-7', players: [{ id: 21, metrics: full(3, 0) }] },
    ],
  };
  // A mistake anywhere changes nothing
  assert.throws(() => run({ matches: [...file.matches, { matchId: 'zone-99', players: [{ id: 10, metrics: {} }] }] }), /Entry 3: no played match has the ID zone-99/);
  assert.throws(() => run({ matches: [{ number: 1, players: [{ id: 21, metrics: full(1, 1) }] }] }), /pilot 21 is not on this match’s scoreboard/);
  assert.throws(() => run({ matches: [{ number: 1, players: [{ id: 10, metrics: { kills: 'many' } }] }] }), /needs numeric statistics/);
  assert.throws(() => run({ matches: [file.matches[0], file.matches[0]] }), /listed twice/);
  assert.throws(() => run(file, { id: 10, name: 'Pilot 10', operator: false }), /operator/);
  assert.equal(s.matches[0].result.players.find((p) => p.id === 10).metrics.gunHits, undefined);

  run(file);
  const first = s.matches[0].result;
  assert.equal(first.winner, north);
  assert.deepEqual(first.players.map((p) => p.id), [10, 11, 20]);
  assert.deepEqual(first.players.find((p) => p.id === 10).metrics, full(8, 2));
  // The operator's correction to pilot 11's kills still stands over the new figures
  assert.deepEqual(first.players.find((p) => p.id === 11).metrics, { ...full(4, 4), kills: 5 });
  // A pilot the file does not list keeps what they had
  assert.deepEqual(first.players.find((p) => p.id === 20).metrics, { kills: 6, deaths: 12, playingTime: 1200 });
  const second = s.matches[1];
  assert.deepEqual(second.result.players.find((p) => p.id === 21).metrics, full(3, 0));
  assert.deepEqual(second.attempts[0].mappedPlayers.find((p) => p.id === 21).metrics, full(3, 0));
  assert.equal(statValue(stat('gunAccuracy'), seasonStats(s).pilots.find((row) => row.id === '21').counters), 0.1);
});
