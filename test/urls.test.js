import test from 'node:test';
import assert from 'node:assert/strict';
import { season } from '../src/league.ts';
import { game } from '../src/competition.ts';
import { testStore } from './support/db.js';

test('seasons, squads and matches receive stable URLs, including duplicate names and replaced playoff games', async (t) => {
  const store = await testStore(t);
  const winter = season({ name: 'Winter Cup!' });
  const second = season({ name: 'Wíntér Cup' });
  winter.squads = ['Blue Moon', 'Blue-Moon', '💫'].map((name, i) => ({
    name,
    id: 'squad-' + i,
    roster: [i + 1],
    captain: i + 1,
  }));
  winter.matches = [game('squad-0', 'squad-1', 1), game('squad-1', 'squad-0', 2, 'Final-1-1')];
  assert.equal(await store.insert(winter), 'winter-cup');
  assert.equal(await store.insert(second), 'winter-cup-2');
  const created = await store.read(winter.id);
  assert.equal(created.revision, 1);
  assert.deepEqual(
    created.squads.map((t) => t.slug),
    ['blue-moon', 'blue-moon-2', 'squad'],
  );
  assert.deepEqual(
    created.matches.map((m) => m.number),
    [1, 2],
  );
  // Renaming keeps every address, and a retired match number is never given out again
  await store.edit(winter.id, (s) => {
    s.name = 'Renamed';
    s.squads[0].name = 'New Moon';
    s.matches.pop();
  });
  await store.edit(winter.id, (s) => {
    s.matches.unshift(game('squad-0', 'squad-2', 2, 'Final-1-1'));
  });
  const updated = await store.read(winter.id);
  assert.equal(updated.slug, 'winter-cup');
  assert.equal(updated.squads[0].slug, 'blue-moon');
  assert.deepEqual(
    updated.matches.map((m) => m.number),
    [3, 1],
  );
  assert.equal(await store.insert(season({ name: 'Winter Cup' })), 'winter-cup-3');
  assert.equal(await store.insert(season({ name: 'New' })), 'new-2');
  assert.equal(await store.insert(season({ name: '🏆' })), 'season');
  // An address only has to be unique within a league, and a season is found by league and address
  const other = await store.insertLeague('Other League');
  const elsewhere = season({ name: 'Winter Cup' });
  elsewhere.league = other.id;
  assert.equal(await store.insert(elsewhere), 'winter-cup');
  assert.equal((await store.read('winter-cup', other.id)).id, elsewhere.id);
  assert.equal((await store.read('winter-cup')).id, winter.id);
  // Leagues get addresses the same way, and cannot take one the site uses
  assert.equal(other.slug, 'other-league');
  assert.equal((await store.insertLeague('Other League')).slug, 'other-league-2');
  assert.equal((await store.insertLeague('Account')).slug, 'account-2');
});
