import { randomBytes, createHash } from 'node:crypto';
import { configuration, database } from './runtime.ts';
import { need } from './league.ts';
import type { Actor, League } from './types.ts';

export const sessionCookie = 'league_session';
export const stateCookie = 'league_state';
// What a visitor asked for before they were signed in: see finishSignUp
export const intentCookie = 'league_intent';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export function cookieOptions(maxAge: number) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: !configuration().demo, maxAge };
}
export async function lookupActor(key?: string): Promise<Actor | null> {
  if (!key) return null;
  const row = (
    await (await database()).query(
      'SELECT i.* FROM identities i JOIN sessions s ON s.profile=i.id WHERE s.token=$1 AND s.expires>$2',
      [hash(key), Date.now()],
    )
  ).rows[0];
  if (!row) return null;
  // Outside any league only a site admin is an operator. Within one, see `inLeague`.
  const admin = configuration().admins.includes(Number(row.id));
  return { id: Number(row.id), name: String(row.name), operator: admin, admin };
}
export async function createSession(id: number) {
  const key = token();
  await (await database()).pruneSessions();
  await (await database()).query('INSERT INTO sessions VALUES($1,$2,$3)', [hash(key), id, Date.now() + 7 * 86400000]);
  return key;
}

export async function demoSession(id: number) {
  need(configuration().demo, 'Unavailable.', 404);
  need((await (await database()).query('SELECT id FROM identities WHERE id=$1', [id])).rowCount, 'Unknown demo identity.');
  return createSession(id);
}
export async function endSession(key?: string) {
  if (key) await (await database()).query('DELETE FROM sessions WHERE token=$1', [hash(key)]);
}

// The same person as they stand in one league: its own operators manage it, and so does any site admin.
export function inLeague<T extends Actor | null>(actor: T, league: Pick<League, 'operators'>): T {
  return actor && { ...actor, operator: !!actor.admin || league.operators.includes(actor.id) };
}
