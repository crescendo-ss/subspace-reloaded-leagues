// Tests run against a real Postgres: the container from docker-compose.yml, or TEST_DATABASE_URL.
// Each store gets a schema of its own, dropped when the test ends.
import { randomBytes } from 'node:crypto';
import { openStore } from '../../src/store.ts';

export const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://deepspace:deepspace@127.0.0.1:5435/deepspace';
export const freshSchema = () => 'test_' + randomBytes(6).toString('hex');
export async function testStore(t, schema = freshSchema()) {
  const store = await openStore(databaseUrl, { schema });
  // A season saved without naming a league joins the oldest one, so the tests give every store a league
  await store.insertLeague('Premiere Pro');
  t.after(() => store.close({ drop: true }));
  return store;
}
