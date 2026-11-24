import test from 'node:test';
import assert from 'node:assert/strict';
import { season, apply } from '../src/league.ts';
import { standings, performance } from '../src/competition.ts';
import { forfeitedBy, matchScore } from '../src/match-score.ts';
import { testStore } from './support/db.js';

const op = { id: 1, name: 'Operator', operator: true };
const names = ['North', 'South', 'East', 'West'];
// Two pilots a squad: the captain is 10, 20, 30, 40 and the drafted pilot one more
const players = names.flatMap((_, i) => [
  { id: 10 * (i + 1), name: 'Captain ' + (i + 1), salary: 9 },
  // A draft held elsewhere may have priced pilots in fractions
  { id: 10 * (i + 1) + 1, name: 'Pilot ' + (i + 1), salary: 4.25 },
]);
const squads = names.map((name, i) => ({ name, captain: 10 * (i + 1), roster: [10 * (i + 1), 10 * (i + 1) + 1] }));
const id = (name) => 10 * (names.indexOf(name) + 1);
// A played game with a scoreboard: the winner's pilots share the kills
function played(home, away, winner, score, extra = {}) {
  const loser = winner === home ? away : home;
  const [won, lost] = [Math.max(...score), Math.min(...score)];
  return {
    home,
    away,
    winner,
    score,
    players: [
      { id: id(winner), squad: winner, metrics: { kills: won - 1, deaths: lost } },
      { id: id(winner) + 1, squad: winner, metrics: { kills: 1, deaths: 0 } },
      { id: id(loser), squad: loser, metrics: { kills: lost, deaths: won } },
    ],
    ...extra,
  };
}
function file() {
  return {
    players,
    squads,
    picks: [{ player: 41 }, { player: 31 }, { player: 21 }, { player: 11 }],
    matches: [
      { round: 2, ...played('East', 'West', 'East', [12, 4]) },
      {
        round: 1,
        ...played('North', 'South', 'North', [12, 7], {
          startedAt: '2026-09-13T20:09:00Z',
          endedAt: '2026-09-13T20:41:30Z',
          matchId: 'svs-league-4v4-8',
          matchUrl: 'https://subspacereloaded.com/matches/svs-league-4v4-8',
          replayUrl: 'https://replays.subspacereloaded.com/replay/match/svs-league-4v4-8',
        }),
      },
      // A forfeit has no scoreboard: the result is a ruling with the score it was awarded
      { round: 1, home: 'East', away: 'West', winner: 'East', score: [12, 0], reason: 'West forfeited' },
      { round: 2, ...played('North', 'East', 'East', [9, 12]) },
      { round: 3, ...played('South', 'West', 'South', [12, 11]) },
      // Not played: it stays on the schedule
      { round: 3, home: 'North', away: 'West' },
    ],
    playoffs: {
      bestOf: 3,
      // East has a bye to the final; North and South play for the other place
      firstRound: [['East', null], ['North', 'South']],
      games: [
        played('North', 'South', 'North', [12, 3]),
        // Named the other way round: the score still belongs to the squads as this entry names them
        played('South', 'North', 'South', [12, 10]),
        played('North', 'South', 'North', [12, 8]),
        played('East', 'North', 'East', [12, 6]),
        played('North', 'East', 'East', [5, 12]),
        // "If necessary", and it was not
        { home: 'East', away: 'North' },
      ],
    },
  };
}

test('a finished season is imported whole: draft, results, scoreboards, rulings and the playoffs as played', async (t) => {
  const s = season({ name: 'Season One' });
  const run = (data, actor = op) => apply(s, actor, 'importSeason', { data: JSON.stringify(data) });
  // A file with a mistake anywhere in it changes nothing
  const stray = file();
  stray.playoffs.games.push(played('South', 'West', 'South', [12, 1]));
  assert.throws(() => run(stray), /Playoff game 7: this game does not fit the bracket/);
  const unknown = file();
  unknown.matches[0].home = 'Nowhere';
  assert.throws(() => run(unknown), /Match 1 home: “Nowhere” is not one of the squads/);
  const wrongScore = file();
  wrongScore.matches[1].score = [7, 12];
  assert.throws(() => run(wrongScore), /Match 2: The winning squad needs the higher score/);
  const stranger = file();
  stranger.matches[1].players[0].id = 999;
  assert.throws(() => run(stranger), /Match 2: every pilot in a scoreboard must be in the players list/);
  const fine = file();
  fine.players = fine.players.map((p) => (p.id === 41 ? { ...p, salary: 4.255 } : p));
  assert.throws(() => run(fine), /at most two decimal places/);
  assert.throws(() => run(file(), { id: 10, name: 'Captain 1', operator: false }), /operator/);
  assert.deepEqual([s.squads.length, s.matches.length, s.bracket.length, Object.keys(s.players).length], [0, 0, 0, 0]);

  run(file());
  const squad = (name) => s.squads.find((x) => x.name === name);
  assert.deepEqual(s.squads.map((x) => x.name), names);
  assert.equal(s.salaries[41], 4.25);
  assert.deepEqual(s.picks.map((p) => p.player), [41, 31, 21, 11]);
  assert.equal(s.draftFinished, true);
  assert.equal(s.enlistedOpen, false);

  // The regular season is in round order, and standings follow from the results
  const regular = s.matches.filter((m) => !m.series);
  assert.deepEqual(regular.map((m) => m.round), [1, 1, 2, 2, 3, 3]);
  assert.equal(regular.filter((m) => m.result).length, 5);
  // North and South are level at one win each; North beat South, so head-to-head puts North ahead
  assert.deepEqual(
    standings(s).map((row) => [row.name, row.wins, row.losses, row.killDiff]),
    [['East', 3, 0, 23], ['North', 1, 1, 2], ['South', 1, 1, -4], ['West', 0, 3, -21]],
  );

  // A played match keeps its scoreboard, its times and its links
  const opener = regular.find((m) => m.home === squad('North').id && m.away === squad('South').id);
  assert.deepEqual(matchScore(opener, s.gameType), [12, 7]);
  assert.equal(opener.result.source, 'import');
  assert.equal(opener.result.recordedAt, '2026-09-13T20:41:30.000Z');
  const attempt = opener.attempts[0];
  assert.equal(attempt.state, 'complete');
  assert.equal(attempt.matchId, 'svs-league-4v4-8');
  assert.match(attempt.replayUrl, /replay\/match\/svs-league-4v4-8$/);
  assert.equal(attempt.startedAt, '2026-09-13T20:09:00.000Z');
  assert.deepEqual(attempt.booking.teams.map((team) => team.roster.map((p) => p.profileId)), [[10, 11], [20]]);
  // A forfeit is a ruling: it counts in the table and shows its awarded score, with no statistics
  const forfeit = regular.find((m) => m.rulings.length);
  assert.equal(forfeit.result.source, 'operator');
  assert.deepEqual(forfeit.rulings[0], { by: 1, at: forfeit.result.recordedAt, winner: squad('East').id, reason: 'West forfeited', score: [12, 0], forfeit: true });
  assert.deepEqual(matchScore(forfeit, s.gameType), [12, 0]);
  assert.equal(forfeit.attempts.length, 0);
  // The squad that lost a match awarded without a game is the one that forfeited. A match that was played
  // is no forfeit, and neither is a result that only lacks a scoreboard, a draw, or a zone result until the
  // zone says it was one.
  assert.equal(forfeitedBy(forfeit), squad('West').id);
  assert.equal(forfeitedBy(opener), null);
  const awarded = { home: 'a', away: 'b', attempts: [], result: { winner: 'a', source: 'operator', players: [], recordedAt: '', forfeit: true } };
  assert.equal(forfeitedBy(awarded), 'b');
  // A win awarded for another reason says so, and is not a forfeit
  assert.equal(forfeitedBy({ ...awarded, result: { ...awarded.result, forfeit: false } }), null);
  assert.equal(forfeitedBy({ ...awarded, result: { ...awarded.result, source: 'import', forfeit: undefined } }), null);
  assert.equal(forfeitedBy({ ...awarded, result: { ...awarded.result, winner: null } }), null);
  assert.equal(forfeitedBy({ ...awarded, result: null }), null);
  const zone = (outcome) => ({ ...awarded, attempts: [{ rawResult: { outcome } }], result: { ...awarded.result, winner: 'b', source: 'reloaded', forfeit: undefined } });
  assert.equal(forfeitedBy(zone('walkover')), 'a');
  assert.equal(forfeitedBy(zone('elimination')), null);

  // The bracket is the one that was played: East waits in the final, North wins a three-game series
  assert.deepEqual([s.format, s.bestOf, s.playoffSpots], ['single', 3, 3]);
  assert.deepEqual(s.bracket.map((node) => [node.id, node.winner, node.score]), [
    ['Upper-1-1', squad('East').id, [0, 0]],
    ['Upper-1-2', squad('North').id, [2, 1]],
    ['Upper-2-1', squad('East').id, [2, 0]],
  ]);
  assert.equal(s.champion, squad('East').id);
  const series = s.matches.filter((m) => m.series === 'Upper-1-2');
  assert.deepEqual(series.map((m) => m.round), [1, 2, 3]);
  // The second game was named South–North in the file; here it is North–South with the score turned to match
  assert.deepEqual(series.map((m) => [m.home === squad('North').id, matchScore(m, s.gameType)]), [[true, [12, 3]], [true, [10, 12]], [true, [12, 8]]]);
  assert.equal(s.matches.filter((m) => m.series).length, 5);
  assert.ok(s.matches.every((m) => !m.series || m.result));

  // Statistics cover the regular season and the playoffs
  const north = performance(s).players.find((p) => p.id === 10);
  assert.deepEqual([north.played, north.wins], [7, 3]);
  assert.equal(north.metrics.kills, 11 + 9 + 11 + 10 + 11 + 6 + 5);

  // A season that already has squads is left alone
  assert.throws(() => run(file()), /no squads, draft or schedule yet/);

  // Saved, it is indexed like a season played here: fixtures by ID, and each pilot's match statistics as rows
  const store = await testStore(t);
  const empty = season({ name: 'Season One' });
  await store.insert(empty);
  await store.edit(empty.id, (live) => apply(live, op, 'importSeason', { data: JSON.stringify(file()) }));
  const saved = await store.read(empty.id);
  assert.deepEqual(saved.matches.map((m) => m.number), Array.from({ length: 11 }, (_, i) => i + 1));
  const kept = saved.matches.find((m) => m.attempts[0]?.matchId === 'svs-league-4v4-8');
  assert.deepEqual(await store.locateAttempt(kept.attempts[0].externalId), { seasonId: empty.id, matchId: kept.id });
  const totals = (await store.pilotTotals()).find((row) => row.player === 10);
  assert.deepEqual([totals.played, totals.wins, totals.kills], [7, 3, north.metrics.kills]);
});
