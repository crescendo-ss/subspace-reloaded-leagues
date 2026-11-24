import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrations, openStore } from '../src/store.ts';
import { seasonPhase, canSignUp } from '../src/phase.ts';
import { season, apply } from '../src/league.ts';
import { forfeitedBy } from '../src/match-score.ts';
import { upgrade } from '../src/upgrade.ts';
import { databaseUrl, freshSchema } from './support/db.js';

// The tables as they were before the store kept a version: what a database made by an earlier release holds
const before = `
  CREATE TABLE leagues(position BIGINT GENERATED ALWAYS AS IDENTITY, id TEXT PRIMARY KEY, data JSON NOT NULL,
    slug TEXT GENERATED ALWAYS AS (data ->> 'slug') STORED UNIQUE);
  CREATE TABLE seasons(position BIGINT GENERATED ALWAYS AS IDENTITY, id TEXT PRIMARY KEY, data JSON NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, league TEXT GENERATED ALWAYS AS (data ->> 'league') STORED,
    slug TEXT GENERATED ALWAYS AS (data ->> 'slug') STORED, UNIQUE (league, slug));
`;

test('a database from an earlier release is brought up to date, and its seasons to today’s shape', async (t) => {
  const schema = freshSchema();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query('CREATE SCHEMA ' + schema);
  await client.query('SET search_path=' + schema);
  await client.query(before);
  await client.query('INSERT INTO leagues(id, data) VALUES($1, $2)', ['l1', JSON.stringify({ id: 'l1', slug: 'old-league', name: 'Old League', operators: [] })]);
  // A season written before picks, trades, salaries, a draft or a formation method were kept
  const old = { id: 's1', league: 'l1', slug: 'first', name: 'First', gameType: 'svs-league-4v4', format: 'single', bestOf: 1, minPerTeam: 4, reviewTrades: true, enlistedOpen: true, players: { 7: 'Seven' }, squads: [], matches: [], bracket: [], champion: null, playoffSpots: 4 };
  await client.query('INSERT INTO seasons(id, data) VALUES($1, $2)', ['s1', JSON.stringify(old)]);
  await client.query('INSERT INTO seasons(id, data) VALUES($1, $2)', ['s2', JSON.stringify({ ...old, id: 's2', slug: 'second', name: 'Second', closed: true })]);
  await client.end();

  const store = await openStore(databaseUrl, { schema });
  assert.equal((await store.query('SELECT version FROM schema_version')).rows[0].version, migrations.length);
  assert.deepEqual((await store.listSeasonNames('l1')).map((entry) => [entry.name, entry.over, entry.started]), [['Second', true, false], ['First', false, false]]);
  const s = await store.read('s1');
  assert.deepEqual([s.picks, s.trades, s.salaries, s.draft], [[], [], {}, null]);
  assert.ok(s.formation?.method, 'an old season is given a formation method');
  // Opening it again changes nothing, and an edit still saves
  await store.close();
  const again = await openStore(databaseUrl, { schema });
  t.after(() => again.close({ drop: true }));
  await again.edit('s1', (live) => void (live.name = 'First, renamed'));
  assert.deepEqual((await again.listSeasonNames('l1')).map((entry) => entry.name), ['Second', 'First, renamed']);
  assert.equal((await again.query('SELECT version FROM schema_version')).rowCount, 1);
});

test('a season has one phase, and one answer to whether a pilot may sign up', () => {
  const base = { champion: null, closed: false, draft: null, enlistedOpen: true, bracket: [], squads: [], matches: [] };
  const played = { series: null, result: {} }, unplayed = { series: null, result: null };
  const cases = [
    [{}, 'signups', true],
    [{ squads: [{}] }, 'forming', true],
    [{ squads: [{}], draft: {} }, 'draft', false],
    [{ matches: [played, unplayed] }, 'regular', true],
    [{ matches: [played, unplayed], enlistedOpen: false }, 'regular', false],
    [{ matches: [played, played] }, 'seeding', true],
    [{ matches: [played], bracket: [{}] }, 'playoffs', true],
    [{ matches: [played], bracket: [{}], champion: 'a' }, 'complete', false],
    [{ matches: [played, unplayed], closed: true }, 'closed', false],
  ];
  for (const [change, phase, open] of cases) {
    const s = { ...base, ...change };
    assert.deepEqual([seasonPhase(s), canSignUp(s)], [phase, open], JSON.stringify(change));
  }
});

test('only named fields of a season, a squad and a match are published', async () => {
  const op = { id: 1, name: 'Operator', operator: true };
  const s = season({ name: 'Spring', minPerTeam: 1 });
  for (const id of [10, 11]) {
    apply(s, { id, name: 'Pilot ' + id }, 'enlist');
    apply(s, op, 'addSquad', { player: id, name: 'Squad ' + id });
  }
  apply(s, op, 'schedule');
  apply(s, op, 'rule', { match: s.matches[0].id, winner: s.matches[0].home, reason: 'No-show', forfeit: 'on' });
  // What the site keeps for itself today, and a field of each kind that someone adds tomorrow
  const stored = { ...s, slug: 'spring', revision: 3, resourceVersions: { baseline: 1, changed: {} }, lastDraft: { format: 'regular' }, operatorNotes: 'private' };
  stored.squads[0].contact = 'private';
  stored.matches[0].memo = 'private';
  stored.squads.forEach((t, i) => (t.slug = 'squad-' + i));
  stored.matches.forEach((m, i) => (m.number = i + 1));
  // The local demo needs no deployment settings to say where signing in happens
  const demo = process.env.LEAGUE_DEMO;
  process.env.LEAGUE_DEMO = '1';
  const { publicSeason } = await import('../src/service.ts');
  const view = publicSeason(stored, { id: 'l1', slug: 'league', name: 'League', operators: [] });
  if (demo === undefined) delete process.env.LEAGUE_DEMO;
  else process.env.LEAGUE_DEMO = demo;
  const text = JSON.stringify(view);
  for (const hidden of ['private', 'resourceVersions', 'lastMatchNumber', 'lastDraft', 'rulingRoster'])
    assert.ok(!text.includes(hidden), hidden + ' is not published');
  // What the pages read is all there
  assert.deepEqual([view.id, view.slug, view.revision, view.name, view.draftReopenable], [s.id, 'spring', 3, 'Spring', true]);
  assert.deepEqual(Object.keys(view.squads[0]).sort(), ['captain', 'id', 'name', 'roster', 'slug']);
  assert.equal(view.matches[0].forfeit, s.matches[0].away);
  assert.equal(view.matches[0].result.forfeit, true);
});

test('a ruling says whether the loser forfeited, and rulings made before it was asked are read as they were shown', () => {
  const op = { id: 1, name: 'Operator', operator: true };
  const s = season({ name: 'Spring', minPerTeam: 1 });
  for (const id of [10, 11]) {
    apply(s, { id, name: 'Pilot ' + id }, 'enlist');
    apply(s, op, 'addSquad', { player: id, name: 'Squad ' + id });
  }
  apply(s, op, 'schedule');
  const m = s.matches[0];
  const rule = (extra) => apply(s, op, 'rule', { match: m.id, winner: m.home, reason: 'Ruling', ...extra });
  rule({ forfeit: 'on' });
  assert.deepEqual([m.result.forfeit, m.rulings.at(-1).forfeit, forfeitedBy(m)], [true, true, m.away]);
  // A win awarded for another reason: no game was played, and it is still not a forfeit
  rule({});
  assert.deepEqual([m.result.forfeit, m.rulings.at(-1).forfeit, forfeitedBy(m)], [false, false, null]);
  // A draw has no squad that forfeited, whatever is ticked
  rule({ winner: 'draw', forfeit: true });
  assert.deepEqual([m.result.forfeit, forfeitedBy(m)], [false, null]);
  // Stored before the question was asked: a win with no game was a forfeit, a ruling on a played match was not
  const old = (result) => upgrade({ matches: [{ home: 'a', away: 'b', attempts: [], result: { source: 'operator', recordedAt: '', ...result } }] }).matches[0];
  assert.equal(forfeitedBy(old({ winner: 'a', players: [] })), 'b');
  assert.equal(forfeitedBy(old({ winner: 'a', players: [{ id: 7, squad: 'a', metrics: {} }] })), null);
  assert.equal(forfeitedBy(old({ winner: null, players: [] })), null);
  // What an operator has since said stands
  assert.equal(forfeitedBy(old({ winner: 'a', players: [], forfeit: false })), null);
  // A result that was imported or reported by the zone is not given an answer
  assert.equal(old({ winner: 'a', players: [], source: 'import' }).result.forfeit, undefined);
});
