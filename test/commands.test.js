import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { seasonCommands, siteCommands, lockedDuringDraft } from '../src/commands.ts';
import { apply, season } from '../src/league.ts';
import { checkRevision } from '../src/revisions.ts';
import { reservedLeagueSlugs, reservedSeasonSlugs } from '../src/store.ts';
import { seasonSections } from '../src/sections.ts';

const op = { id: 99, name: 'Operator', operator: true };

test('every season command is named once, is handled, and says what it depends on', () => {
  assert.equal(new Set(seasonCommands).size, seasonCommands.length);
  // The names in the list are the cases of `apply`, no more and no fewer
  const source = readFileSync(new URL('../src/league.ts', import.meta.url), 'utf8');
  const cases = [...source.slice(source.indexOf('export function apply')).matchAll(/^    case '([A-Za-z]+)':/gm)].map((m) => m[1]);
  assert.deepEqual([...cases].sort(), [...seasonCommands].sort());
  for (const name of seasonCommands) {
    const s = { ...season({ name: 'Commands' }), revision: 1 };
    // Whatever each refuses for, it is not for being unknown
    assert.doesNotThrow(() => checkRevision(s, op, 1, name, {}), name + ' has no entry in dependencies');
    try {
      apply(s, op, name, {});
    } catch (error) {
      assert.notEqual(error.status, 404, name + ' is not handled by apply: ' + error.message);
    }
  }
  assert.throws(() => apply(season({ name: 'Commands' }), op, 'noSuchCommand', {}), (e) => e.status === 404);
  for (const name of lockedDuringDraft) assert.ok(seasonCommands.includes(name), name);
  for (const name of siteCommands) assert.ok(!seasonCommands.includes(name), name + ' is in both lists');
});

test('every form on the site sends a command that exists', () => {
  const known = new Set([...seasonCommands, ...siteCommands]);
  const files = (dir) => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => entry.parentPath + '/' + entry.name);
  for (const file of [...files('../app/'), ...files('../components/')]) {
    for (const [, name] of readFileSync(file, 'utf8').matchAll(/\bcommand="([A-Za-z]+)"/g)) assert.ok(known.has(name), file + ' sends ' + name);
  }
});

test('the site’s own folders cannot be taken as a league’s or a season’s address', () => {
  const folders = (dir) => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('['))
    .map((entry) => entry.name);
  // A league lives at /<league>, beside the site's own pages
  for (const name of folders('../app/')) assert.ok(reservedLeagueSlugs.includes(name), 'app/' + name + ' is not a reserved league address');
  // A season lives at /<league>/<season>, beside the league's own pages
  for (const name of folders('../app/[league]/')) assert.ok(reservedSeasonSlugs.includes(name), 'app/[league]/' + name + ' is not a reserved season address');
  // Each section of a season has its page, and each page is a section
  assert.deepEqual(folders('../app/[league]/[seasonId]/').sort(), seasonSections.map((section) => section.route).sort());
});
