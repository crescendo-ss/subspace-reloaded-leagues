import { NextResponse } from 'next/server';
import { configuration, database } from '@/src/runtime';
import { route } from '@/src/http';
import { need } from '@/src/league';
import { cookieOptions, hash, token, stateCookie } from '@/src/auth';
// Only a plain path on this site is ever returned to
const localPath = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;
export const GET = route(async (req) => {
  const config = configuration();
  need(!config.demo, 'Choose a demo identity.');
  const store = await database();
  // The state carries where to return to: the page sign-in was asked from, or a league or season home
  const query = req.nextUrl.searchParams;
  const next = query.get('next'),
    season = query.get('season'),
    league = query.get('league');
  const home = league ? await store.league(league) : undefined;
  const named = !next && season ? await store.read(season, home?.id) : undefined;
  const back = next && localPath.test(next)
    ? next.slice(1)
    : named
      ? (await store.league(named.league!)).slug + '/' + named.slug
      : home?.slug;
  const state = token() + (back ? '.' + back : '');
  await store.query('DELETE FROM oauth WHERE expires<=$1', [Date.now()]);
  await store.query('INSERT INTO oauth VALUES($1,$2)', [hash(state), Date.now() + 600000]);
  const url = new URL('https://auth.subspacereloaded.com/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.origin + '/auth/callback',
    response_type: 'code',
    scope: 'identity fixtures',
    state,
  }).toString();
  const response = NextResponse.redirect(url, 302);
  response.cookies.set(stateCookie, state, cookieOptions(600));
  return response;
});
