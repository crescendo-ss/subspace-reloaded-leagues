import { NextResponse } from 'next/server';
import { configuration, database } from '@/src/runtime';
import { route } from '@/src/http';
import { need } from '@/src/league';
import { cookieOptions, createSession, hash, intentCookie, sessionCookie, stateCookie } from '@/src/auth';
import { finishSignUp } from '@/src/service';
export const GET = route(async (req) => {
  const config = configuration(),
    store = await database(),
    query = req.nextUrl.searchParams;
  const state = query.get('state');
  need(
    !config.demo &&
      state &&
      state === req.cookies.get(stateCookie)?.value &&
      // Deleting the state is what spends it: a second use of the same link finds nothing
      (await store.query('DELETE FROM oauth WHERE token=$1 AND expires>$2', [hash(state), Date.now()])).rowCount,
    'Sign-in expired. Start again.',
    403,
  );
  // Only recover the season from the verified, single-use state generated at login.
  const [, back] = state.split('.');
  const [league, season] = back && /^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(back) ? back.split('/') : [];
  const target = new URL(league ? '/' + back : '/', config.origin);
  if (query.has('error')) {
    target.pathname = '/account';
    target.searchParams.set('auth', 'declined');
    if (league) target.searchParams.set('league', league);
    if (season) target.searchParams.set('season', season);
  }
  const response = NextResponse.redirect(target, 302);
  response.cookies.set(stateCookie, '', cookieOptions(0));
  // A sign-up asked for before signing in is spent here, whether or not sign-in goes through
  const intent = req.cookies.get(intentCookie)?.value;
  if (intent) response.cookies.set(intentCookie, '', cookieOptions(0));
  if (query.has('error')) return response;
  const code = query.get('code');
  need(code, 'Missing authorization code.');
  const exchange = await fetch('https://auth.subspacereloaded.com/oauth/token', {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.origin + '/auth/callback',
      grant_type: 'authorization_code',
    }),
  });
  need(exchange.ok, 'Sign-in exchange failed. Start again.', 401);
  const p = await exchange.json();
  need(
    Number.isSafeInteger(p.profileId) &&
      p.profileId > 0 &&
      typeof p.displayName === 'string' &&
      p.scopes?.includes('fixtures'),
    'Fixture consent is required.',
    403,
  );
  await store.query('INSERT INTO identities VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=excluded.name', [
    p.profileId,
    p.displayName,
  ]);
  for (const s of await store.list())
    if (s.players[p.profileId] && s.players[p.profileId] !== p.displayName)
      await store.edit(s.id, (live) => {
        live.players[p.profileId] = p.displayName;
      });
  const key = await createSession(p.profileId);
  await finishSignUp(key, intent);
  response.cookies.set(sessionCookie, key, cookieOptions(7 * 86400));
  return response;
});
