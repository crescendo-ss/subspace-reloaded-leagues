import test from 'node:test';
import assert from 'node:assert/strict';
import { season, apply } from '../src/league.ts';
import { roundRobin, standings, performance } from '../src/competition.ts';
import { formations } from '../src/formation.ts';
const op = { id: 1, name: 'Operator', operator: true };

function setup(n, extra = {}) {
  const s = season({ name: 'Spring', minPerTeam: 1, ...extra });
  const captains = Array.from({ length: n }, (_, i) => ({ id: 10 + i, name: 'Pilot ' + i }));
  for (const [i, actor] of captains.entries()) {
    apply(s, actor, 'enlist');
    apply(s, op, 'addSquad', { player: actor.id, name: 'Squad ' + i });
  }
  return { s, captains };
}
test('circle schedule visits each pairing once, with at most one game per squad per round', () => {
  for (let size = 2; size <= 17; size++) {
    const games = roundRobin(Array.from({ length: size }, (_, i) => 's' + i));
    const pairs = new Set(games.map((g) => [g.home, g.away].sort().join('/')));
    assert.equal(games.length, (size * (size - 1)) / 2);
    assert.equal(pairs.size, games.length);
    for (const r of new Set(games.map((g) => g.round))) {
      const sides = games.filter((g) => g.round === r).flatMap((g) => [g.home, g.away]);
      assert.equal(sides.length, new Set(sides).size);
    }
  }
});
for (const format of ['single', 'double'])
  for (const n of [2, 3, 4, 5, 8, 13])
    for (const bestOf of [1, 3, 5]) {
      test(format + ' elimination, ' + n + ' squads, best of ' + bestOf, () => {
        const { s } = setup(n, { format, bestOf, playoffSpots: n });
        apply(s, op, 'schedule');
        for (const m of s.matches) apply(s, op, 'rule', { match: m.id, winner: m.home, reason: 'Recorded' });
        const seeds = standings(s);
        apply(s, op, 'playoffs');
        let draws = 0;
        for (let guard = 0; !s.champion && guard < 500; guard++) {
          const m = s.matches.find((g) => g.series && !g.result);
          assert.ok(m, 'unresolved bracket has a playable game');
          // Force a final reset and include a drawn game that needs a replay.
          const winner = !draws++ ? 'draw' : m.series.startsWith('Final') ? m.away : m.home;
          apply(s, op, 'rule', { match: m.id, winner, reason: 'Recorded' });
        }
        assert.ok(s.champion);
        const played = s.bracket.filter((b) => b.sides.every(Boolean) && b.winner);
        assert.equal(played.length, format === 'single' ? n - 1 : 2 * n - 1);
        assert.ok(played.every((b) => Math.max(...b.score) === (bestOf + 1) / 2));
        assert.deepEqual(standings(s), seeds);
        assert.ok(performance(s).squads.every((r) => r.played > 0));
      });
    }
test('snake draft, roster ownership, consent and operator review', () => {
  const {
    s,
    captains: [a, b],
  } = setup(2);
  const players = [21, 22, 23, 24];
  for (const id of players) apply(s, { id, name: 'Pilot ' + id }, 'enlist');
  for (const id of players) apply(s, op, 'salary', { player: id, salary: 8 });
  apply(s, op, 'draft');
  assert.throws(() => apply(s, b, 'pick', { player: 21 }), /Wait/);
  for (const [i, actor] of [a, b, b, a].entries()) apply(s, actor, 'pick', { player: players[i] });
  assert.equal(s.draft, null);
  assert.throws(() => apply(s, a, 'kick', { player: 22 }));
  apply(s, a, 'offer', { give: 21, take: 22 });
  const trade = s.trades[0].id;
  assert.throws(() => apply(s, a, 'trade', { trade, decision: 'accept' }));
  apply(s, b, 'trade', { trade, decision: 'accept' });
  assert.ok(s.squads[0].roster.includes(21));
  apply(s, op, 'trade', { trade, decision: 'accept' });
  assert.ok(s.squads[0].roster.includes(22));
  apply(s, a, 'kick', { player: 22 });
  assert.ok(!s.squads[0].roster.includes(22));
  assert.throws(() => apply(s, a, 'schedule'), /operator/);
});
test('automatic and external strategies assign each free player once', () => {
  formations.set('example', {
    label: 'Example',
    assign: (s, p) => p.map((player) => ({ player, squad: s.squads[0].id })),
  });
  try {
    for (const method of ['balanced', 'random', 'even', 'example']) {
      const { s } = setup(2);
      for (const id of [21, 22, 23]) apply(s, { id, name: 'Pilot ' + id }, 'enlist');
      apply(s, op, 'form', { method });
      assert.equal(new Set(s.squads.flatMap((t) => t.roster)).size, 5);
    }
  } finally {
    formations.delete('example');
  }
});
test('an undefeated champion skips the reset and a score correction revises only unplayed downstream games', () => {
  const { s } = setup(4, { format: 'double', bestOf: 1 });
  apply(s, op, 'schedule');
  for (const m of s.matches) apply(s, op, 'rule', { match: m.id, winner: m.home, reason: 'Recorded' });
  apply(s, op, 'playoffs');
  const upper = s.matches.filter((m) => m.series);
  for (const m of upper) apply(s, op, 'rule', { match: m.id, winner: m.home, reason: 'Recorded' });
  const before = s.matches.find((m) => m.series === 'Upper-2-1');
  apply(s, op, 'rule', { match: upper[0].id, winner: upper[0].away, reason: 'Appeal' });
  const changed = s.matches.find((m) => m.series === 'Upper-2-1');
  assert.notEqual(before.id, changed.id);
  assert.ok([changed.home, changed.away].includes(upper[0].away));
  while (!s.champion) {
    const m = s.matches.find((m) => m.series && !m.result);
    apply(s, op, 'rule', { match: m.id, winner: m.home, reason: 'Recorded' });
  }
  assert.ok(s.bracket.at(-1).skipped);
  assert.ok(!s.matches.some((m) => m.series?.startsWith('Reset')));
});

test('bracket layout places series, byes and connectors for single and double elimination', async () => {
  const { bracket } = await import('../src/competition.ts');
  const { layoutBracket, seedOrder } = await import('../src/bracket-layout.ts');
  const ids = (n) => Array.from({ length: n }, (_, i) => 's' + (i + 1));
  assert.deepEqual(seedOrder(6), [1, 8, 4, 5, 2, 7, 3, 6]);

  const four = layoutBracket(bracket(ids(4), 'double'));
  assert.deepEqual(
    four.map((lane) => [lane.key, lane.columns.map((c) => c.title)]),
    [
      ['main', ['Semifinals', 'Winners’ final', 'Grand final', 'Deciding final']],
      ['lower', ['Round 1', 'Losers’ final']],
    ],
  );
  const card = (lane, id) => lane.cards.find((c) => c.node.id === id);
  // The winners' final sits level with the two semifinals that feed it, joined by an elbow from each
  assert.deepEqual(card(four[0], 'Upper-2-1').rows, [1, 2]);
  assert.deepEqual(four[0].links.slice(0, 3), [
    { column: 0, rows: [1, 1], turn: 'down' },
    { column: 0, rows: [2, 2], turn: 'up' },
    { column: 0, rows: [1, 2], turn: 'in' },
  ]);
  assert.deepEqual(card(four[0], 'Final-1-1').slots, [
    { kind: 'pending', take: 'winner', series: 4 },
    { kind: 'pending', take: 'winner', series: 5 },
  ]);

  // With six seeds the top two pass the first round, and a losers' round made only of byes is not drawn
  const six = layoutBracket(bracket(ids(6), 'single'))[0];
  assert.deepEqual(six.cards.map((c) => c.kind), ['bye', 'series', 'bye', 'series', 'series', 'series', 'series']);
  assert.deepEqual(card(six, 'Upper-2-1').slots, [
    { kind: 'squad', id: 's1' },
    { kind: 'pending', take: 'winner', series: 1 },
  ]);
  const lower = layoutBracket(bracket(ids(6), 'double'))[1];
  assert.deepEqual(lower.columns.map((c) => c.title), ['Round 1', 'Round 2', 'Losers’ final']);
  assert.ok(lower.cards.filter((c) => c.kind !== 'empty').every((c) => c.column >= 0 && c.column < 3));

  // A decided series sends its winner on and a skipped decider disappears
  const played = bracket(ids(4), 'double');
  played[0].winner = 's1';
  played.at(-1).skipped = true;
  const main = layoutBracket(played)[0];
  assert.equal(card(main, 'Upper-1-1').winner, 's1');
  assert.deepEqual(card(main, 'Upper-2-1').slots[0], { kind: 'squad', id: 's1' });
  assert.equal(card(main, 'Reset-1-1').kind, 'empty');
  assert.deepEqual(main.columns.map((c) => c.title), ['Semifinals', 'Winners’ final', 'Grand final']);
  // Outside the bracket a series goes by the same names
  const { seriesTitle } = await import('../src/bracket-layout.ts');
  const single = (count) => bracket(Array.from({ length: count }, (_, i) => 's' + i), 'single');
  assert.deepEqual(single(6).map((n) => seriesTitle(single(6), n.id)), ['Quarterfinals', 'Quarterfinals', 'Quarterfinals', 'Quarterfinals', 'Semifinals', 'Semifinals', 'Final']);
  assert.equal(seriesTitle(single(16), 'Upper-1-3'), 'Playoffs, round 1');
  const double = bracket(['a', 'b', 'c', 'd'], 'double');
  assert.deepEqual(['Upper-1-1', 'Upper-2-1', 'Lower-1-1', 'Lower-2-1', 'Final-1-1', 'Reset-1-1'].map((id) => seriesTitle(double, id)),
    ['Semifinals', 'Winners’ final', 'Losers’ bracket, round 1', 'Losers’ final', 'Grand final', 'Deciding final']);
  assert.equal(seriesTitle(double, 'Upper-9-9'), null);
});

test('clinching and elimination are reported only once no remaining result can change them', async () => {
  const { finishRange, playoffStatus } = await import('../src/clinch.ts');
  const row = (id, wins, losses) => ({ id, name: id, wins, losses });
  const game = (home, away, played = false) => ({ home, away, series: null, result: played ? {} : null });

  // A and B are out of reach of the two squads that have yet to win, whatever happens between those two
  const table = [row('A', 3, 0), row('B', 2, 1), row('C', 0, 3), row('D', 0, 3)];
  const matches = [game('A', 'B', true), game('C', 'D')];
  assert.deepEqual(Object.fromEntries(playoffStatus(table, matches, 2)), {
    A: { kind: 'seed', seed: 1 },
    B: { kind: 'seed', seed: 2 },
    C: { kind: 'out' },
    D: { kind: 'out' },
  });

  // Squads with the same win–loss record are separated by the result between them, not by name. Zed has beaten
  // both squads that can still catch it, so first place is already certain; by name it would finish below them.
  const won = (home, away) => ({ home, away, series: null, result: { winner: home } });
  const open = [row('Zed', 2, 0), row('B', 1, 1), row('C', 1, 1), row('D', 0, 2)];
  const results = [won('Zed', 'B'), won('Zed', 'C'), won('B', 'D'), won('C', 'D')];
  const left = [game('Zed', 'D'), game('B', 'C')];
  const status = playoffStatus(open, [...results, ...left], 2);
  assert.deepEqual(status.get('Zed'), { kind: 'seed', seed: 1 });
  assert.equal(status.get('B'), undefined);
  assert.equal(status.get('C'), undefined);
  assert.deepEqual(status.get('D'), { kind: 'out' });
  const played = results.map((m) => ({ home: m.home, away: m.away, winner: m.result.winner }));
  assert.deepEqual(Object.fromEntries(finishRange(open, left, played)), {
    Zed: { best: 1, worst: 1 },
    B: { best: 2, worst: 3 },
    C: { best: 2, worst: 3 },
    D: { best: 4, worst: 4 },
  });
  // Without those results nothing separates Zed from a squad that draws level, so first is no longer certain
  assert.deepEqual(finishRange(open, left).get('Zed'), { best: 1, worst: 2 });

  // With too many matches left to try every outcome, the bounds must contain the exact answer
  const exact = finishRange(open, left, played);
  const bounds = finishRange(open, left, played, 0);
  for (const [id, range] of exact) {
    assert.ok(bounds.get(id).best <= range.best && bounds.get(id).worst >= range.worst, id);
  }
  // Nothing is settled before a schedule exists, and every place is final once it is complete
  assert.equal(playoffStatus(open, [], 3).size, 0);
  assert.deepEqual(playoffStatus(open, [game('A', 'B', true)], 3).get('D'), { kind: 'out' });
});


test('ties are broken by head-to-head results, then kill differential, and a ruling can set the score', () => {
  // Three squads finish with three wins and two losses each. In the matches among the three, z won three,
  // x two and y one, so that is the order, although by name it would be y, x, z.
  const league = setup(4).s;
  const [y, x, z, w] = league.squads.map((t) => t.id);
  const meet = (winner, loser) =>
    league.matches.push({ id: 'm' + league.matches.length, home: winner, away: loser, round: 1, series: null, attempts: [], proposal: null, rulings: [], result: { winner, source: 'operator', players: [], recordedAt: '2026-01-01T00:00:00.000Z' } });
  meet(z, x); meet(z, x); meet(x, y); meet(x, y); meet(y, z); meet(z, y);
  meet(x, w); meet(y, w); meet(y, w);
  assert.deepEqual(standings(league).map((row) => [row.id, row.wins]), [[z, 3], [x, 3], [y, 3], [w, 0]]);
  // Two of them level again once the third is set aside are compared on their own two matches
  const again = setup(4).s;
  const [a, b, c, d] = again.squads.map((t) => t.id);
  const beat = (winner, loser) =>
    again.matches.push({ id: 'm' + again.matches.length, home: winner, away: loser, round: 1, series: null, attempts: [], proposal: null, rulings: [], result: { winner, source: 'operator', players: [], recordedAt: '2026-01-01T00:00:00.000Z' } });
  // Among a, b and c: c wins three, a and b one each. Those two are then compared on their own
  // match, which b won. Every one of them has three wins once their matches against d are counted.
  beat(c, a); beat(c, b); beat(c, b); beat(b, a); beat(a, c);
  beat(a, d); beat(a, d); beat(b, d); beat(b, d);
  assert.deepEqual(standings(again).map((row) => [row.id, row.wins]), [[c, 3], [b, 3], [a, 3], [d, 0]]);

  // The record is wins and losses, not points: two wins rank above one win and any number of draws, and
  // of two squads with the same wins the one with fewer losses is ahead
  const record = setup(3).s;
  const [e, f, g] = record.squads.map((t) => t.id);
  const result = (home, away, winner) =>
    record.matches.push({ id: 'm' + record.matches.length, home, away, round: 1, series: null, attempts: [], proposal: null, rulings: [], result: { winner, source: 'operator', players: [], recordedAt: '2026-01-01T00:00:00.000Z' } });
  result(g, f, g); result(g, f, g); result(e, g, e);
  for (let i = 0; i < 4; i++) result(e, f, null);
  assert.deepEqual(standings(record).map((row) => [row.id, row.wins, row.losses, row.draws]), [[g, 2, 1, 0], [e, 1, 0, 4], [f, 0, 2, 4]]);
  result(e, f, e);
  assert.deepEqual(standings(record).map((row) => [row.id, row.wins, row.losses]), [[e, 2, 0], [g, 2, 1], [f, 0, 3]]);

  // Level on everything the results can say: kill differential decides, and a ruled score counts toward it
  const pair = setup(3).s;
  const [p, q, r] = pair.squads.map((t) => t.id);
  apply(pair, op, 'schedule');
  const find = (one, two) => pair.matches.find((m) => [m.home, m.away].includes(one) && [m.home, m.away].includes(two));
  const rule = (m, winner, scores) => apply(pair, op, 'rule', { match: m.id, winner, reason: 'Forfeit', ...scores });
  const pq = find(p, q), pr = find(p, r), qr = find(q, r);
  // A circle: p beats q, q beats r, r beats p. Head-to-head cannot separate them.
  rule(pq, p, pq.home === p ? { homeScore: 12, awayScore: 10 } : { homeScore: 10, awayScore: 12 });
  rule(qr, q, qr.home === q ? { homeScore: 12, awayScore: 0 } : { homeScore: 0, awayScore: 12 });
  rule(pr, r, pr.home === r ? { homeScore: 12, awayScore: 11 } : { homeScore: 11, awayScore: 12 });
  assert.deepEqual(standings(pair).map((row) => [row.id, row.killDiff]), [[q, 10], [p, 1], [r, -11]]);
  assert.deepEqual(qr.result.score, qr.home === q ? [12, 0] : [0, 12]);
  assert.deepEqual(qr.rulings.at(-1).score, qr.result.score);
  // The score has to agree with the outcome, and is given whole or not at all
  assert.throws(() => rule(pq, p, pq.home === p ? { homeScore: 3, awayScore: 9 } : { homeScore: 9, awayScore: 3 }), /higher score/);
  assert.throws(() => rule(pq, 'draw', { homeScore: 3, awayScore: 2 }), /level scores/);
  assert.throws(() => rule(pq, p, { homeScore: 12 }), /both scores/);
  // A ruling without a score clears the one set before
  rule(qr, q, {});
  assert.equal(qr.result.score, undefined);
  assert.equal(standings(pair).find((row) => row.id === q).killDiff, -2);
});
