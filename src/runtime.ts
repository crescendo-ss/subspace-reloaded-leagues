import { openStore, storeVersion, type Store } from './store.ts';
import { seedDemo } from './demo.ts';

export function configuration() {
  const e = process.env;
  const demo = e.LEAGUE_DEMO === '1';
  const port = Number(e.PORT || 3000);
  const origin = demo ? 'http://127.0.0.1:' + port : e.PUBLIC_ORIGIN;
  if (!demo) {
    for (const key of [
      'PUBLIC_ORIGIN',
      'DATABASE_URL',
      'RELOADED_CLIENT_ID',
      'RELOADED_CLIENT_SECRET',
      'RELOADED_API_KEY',
      'RELOADED_WEBHOOK_SECRET',
      'OPERATOR_PROFILE_IDS',
    ]) {
      if (!e[key]?.trim()) throw new Error('Set ' + key + ' in .env, or run npm run demo.');
    }
    if (!origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)
      throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash.');
  }
  return {
    demo,
    port,
    origin: origin!,
    // The site that hosts the leagues. LEAGUE_NAME is the older spelling of the same setting.
    name: e.SITE_NAME || e.LEAGUE_NAME || 'ssrl.gg',
    // What the site is, in a few words and in a sentence, for the brand and for search results
    tagline: e.SITE_TAGLINE || 'Subspace Reloaded Leagues',
    description:
      e.SITE_DESCRIPTION ||
      (e.SITE_NAME || e.LEAGUE_NAME || 'ssrl.gg') +
        ' is a Subspace league coordinator: sign-ups, drafts, schedules, standings and playoffs for every league, with match results from Subspace Reloaded.',
    // A Postgres address. The local demo uses the container from docker-compose.yml, in a schema of its own.
    database: demo ? e.DEMO_DATABASE_URL || 'postgres://deepspace:deepspace@127.0.0.1:5435/deepspace' : e.DATABASE_URL!,
    schema: e.DATABASE_SCHEMA || (demo ? 'demo' : undefined),
    // Site admins: they create leagues, name each league's operators, and may manage any league
    admins: demo ? [1] : e.OPERATOR_PROFILE_IDS!.split(',').map(Number),
    callback: e.RELOADED_CALLBACK || 'default',
    apiKey: e.RELOADED_API_KEY || '',
    clientId: e.RELOADED_CLIENT_ID || '',
    clientSecret: e.RELOADED_CLIENT_SECRET || '',
    webhookSecret: e.RELOADED_WEBHOOK_SECRET || '',
  };
}

// One connection pool per process. A development server keeps it across code reloads, so a pool opened by
// an older version of this module, which lacks newer tables and functions, is closed and replaced.
const runtime = globalThis as typeof globalThis & { leagueStore?: Promise<Store>; leagueStoreVersion?: number };
export function database(): Promise<Store> {
  if (runtime.leagueStore && runtime.leagueStoreVersion !== storeVersion) {
    const old: Promise<{ close?: () => unknown; db?: { close?: () => unknown } }> = Promise.resolve(runtime.leagueStore);
    old.then((store) => (store.close ? store.close() : store.db?.close?.())).catch(() => {});
    runtime.leagueStore = undefined;
  }
  runtime.leagueStoreVersion = storeVersion;
  // A failed connection is not remembered, so the next request tries again
  return (runtime.leagueStore ??= open().catch((error) => {
    runtime.leagueStore = undefined;
    throw error;
  }));
}
async function open() {
  const config = configuration();
  const store = await openStore(config.database, { schema: config.schema });
  // A live site starts empty, and a site admin creates its leagues. The demo fills itself with examples;
  // the web server and the worker start together, and only one of them does the filling.
  if (config.demo) await store.exclusive(() => seedDemo(store));
  return store;
}
