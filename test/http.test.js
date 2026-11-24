import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { openStore } from '../src/store.ts';
import { databaseUrl, freshSchema } from './support/db.js';

test('live HTTP workflow from OAuth consent to signed result, standings and operator ruling', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'reloaded-league-http-'));
  // The server under test gets a schema of its own, removed when the test ends
  const schema = freshSchema();
  const origin = 'https://league.example.org';
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const fixtureFile = join(temp, 'zone.json');
  const env = {
    ...process.env,
    NODE_OPTIONS: '--import=' + new URL('./support/mock-reloaded.mjs', import.meta.url).href,
    TEST_FIXTURE_FILE: fixtureFile,
    PUBLIC_ORIGIN: origin,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL: databaseUrl,
    DATABASE_SCHEMA: schema,
    RELOADED_CLIENT_ID: 'test-client',
    RELOADED_CLIENT_SECRET: 'test-secret',
    RELOADED_API_KEY: 'test-key',
    RELOADED_WEBHOOK_SECRET: 'test-signing',
    RELOADED_CALLBACK: 'test-callback',
    OPERATOR_PROFILE_IDS: '1',
  };
  const realFetch = globalThis.fetch;
  const child = spawn(process.execPath, ['scripts/start.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (b) => {
    logs += b;
  });
  child.stderr.on('data', (b) => {
    logs += b;
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill('SIGTERM');
    await exited;
    rmSync(temp, { recursive: true, force: true });
    await (await openStore(databaseUrl, { schema })).close({ drop: true });
  });
  const url = 'http://127.0.0.1:' + port;
  await waitFor(
    async () => {
      if (child.exitCode !== null) throw Error(logs);
      try {
        return (await realFetch(url + '/api/league')).ok;
      } catch {
        return false;
      }
    },
    () => logs,
  );
  const get = (path, headers = {}) => realFetch(url + path, { headers, redirect: 'manual' });
  const post = (path, body, cookie) =>
    realFetch(url + path, {
      method: 'POST',
      headers: { origin, cookie: cookie ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  // `back` is where sign-in was asked for, as league/season
  async function login(id, back) {
    const [league, season, ...page] = back?.split('/') ?? [];
    // A page within a season is named whole, as the sign-in buttons do; a league or season by its parts
    const start = await get(
      !back
        ? '/auth/login'
        : page.length
          ? '/auth/login?next=' + encodeURIComponent('/' + back)
          : '/auth/login?league=' + league + '&season=' + season,
    );
    assert.equal(start.status, 302);
    const authorize = new URL(start.headers.get('location'));
    assert.equal(authorize.origin, 'https://auth.subspacereloaded.com');
    assert.equal(authorize.searchParams.get('scope'), 'identity fixtures');
    const cookie = start.headers.getSetCookie()[0].split(';')[0];
    const callback = '/auth/callback?state=' + authorize.searchParams.get('state') + '&code=' + id;
    const finish = await get(callback, { cookie });
    assert.equal(finish.status, 302);
    assert.equal(finish.headers.get('location'), origin + (back ? '/' + back : '/'));
    assert.equal((await get(callback, { cookie })).status, 403);
    const session = finish.headers.getSetCookie().find((s) => s.startsWith('league_session='));
    assert.match(session, /HttpOnly/);
    assert.match(session, /Secure/);
    return session.split(';')[0];
  }
  const op = await login(1),
    a = await login(10),
    b = await login(20);
  assert.equal((await post('/api/demo-login', { id: 1 }, op)).status, 404);
  assert.equal((await post('/api/seasons', { name: 'Winter' }, a)).status, 403);
  // A new site has no leagues, and a season cannot be created before the first one exists
  assert.match(await (await get('/')).text(), /No leagues yet\./);
  assert.deepEqual((await (await get('/api/league')).json()).leagues, []);
  assert.notEqual((await post('/api/seasons', { name: 'Winter' }, op)).status, 200);
  // Only a site admin creates leagues. Each league then runs one season at a time.
  assert.equal((await post('/api/leagues', { name: 'Winter League' }, a)).status, 403);
  const league = async (name) => (await post('/api/leagues', { name }, op)).json();
  const winterLeague = await league('Winter League');
  assert.equal(winterLeague.slug, 'winter-league');
  const created = await post('/api/seasons', { name: 'Winter', minPerTeam: 1, league: winterLeague.id }, op);
  assert.equal(created.status, 201);
  const { id, slug, path: canonical } = await created.json();
  assert.equal(slug, 'winter');
  assert.equal(canonical, '/winter-league/winter');
  // Signing in returns to the page it was asked from, and never to an address outside the site
  await login(20, 'winter-league/winter/draft');
  const outside = new URL((await get('/auth/login?next=' + encodeURIComponent('//evil.example/x'))).headers.get('location'));
  assert.ok(!outside.searchParams.get('state').includes('.'));
  const overlapping = await post('/api/seasons', { name: 'Winter Two', league: winterLeague.id }, op);
  assert.equal(overlapping.status, 409);
  assert.match((await overlapping.json()).error, /Winter is still in progress/);
  const read = async () => (await (await get('/api/league?season=' + id)).json()).season;
  async function action(cookie, command, params = {}) {
    const response = await post(
      '/api/action',
      { id, revision: (await read()).revision, command, params },
      cookie,
    );
    assert.equal(response.status, 200, await response.text());
  }
  // Sign-up is one press wherever it is offered, signed in or not: the front page, the league, the season
  for (const path of ['/', '/winter-league', '/winter-league/winter']) {
    const page = await (await get(path)).text();
    assert.match(page, /data-command="join"[^]*>Sign up<\/button>/, path);
    assert.match(await (await get(path, { cookie: a })).text(), /data-command="join"[^]*>Sign up<\/button>/, path);
    // One button: whether they would captain is asked once they are signed up
    assert.doesNotMatch(page, /willing to captain<\/button>/, path);
  }
  assert.match(await (await get('/winter-league')).text(), /You will sign in with your Subspace Reloaded account first\./);
  await action(op, 'toggleEnlist');
  assert.match(await (await get('/winter-league')).text(), /Registration closed/);
  await action(op, 'toggleEnlist');
  for (const p of [a, b]) await action(p, 'enlist');
  assert.match(await (await get('/winter-league', { cookie: a })).text(), /You’re signed up[^]*>I am willing to captain<\/button>/);
  assert.match(await (await get('/', { cookie: a })).text(), /You’re signed up\./);
  // A visitor who pressed "Sign up" before signing in comes back from sign-in already signed up: what they
  // asked for waits in a cookie, which the callback spends
  {
    const start = await get('/auth/login?next=' + encodeURIComponent('/winter-league'));
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cookie = start.headers.getSetCookie()[0].split(';')[0] + '; league_intent=' + id + '.yes';
    const finish = await get('/auth/callback?state=' + state + '&code=30', { cookie });
    assert.equal(finish.headers.get('location'), origin + '/winter-league');
    assert.ok(finish.headers.getSetCookie().some((c) => /^league_intent=;/.test(c)));
    const newcomer = finish.headers.getSetCookie().find((c) => c.startsWith('league_session=')).split(';')[0];
    const joined = await read();
    assert.ok(Object.hasOwn(joined.players, 30));
    assert.deepEqual(joined.volunteers, [30]);
    assert.match(await (await get('/winter-league', { cookie: newcomer })).text(), /You have said you are willing to captain/);
    await action(newcomer, 'withdraw');
    // A sign-up that cannot be finished does not stand in the way of signing in
    const again = await get('/auth/login');
    const broken = await get('/auth/callback?state=' + new URL(again.headers.get('location')).searchParams.get('state') + '&code=30', {
      cookie: again.headers.getSetCookie()[0].split(';')[0] + '; league_intent=no-such-season.no',
    });
    assert.equal(broken.status, 302);
    assert.ok(broken.headers.getSetCookie().some((c) => c.startsWith('league_session=')));
    assert.ok(!Object.hasOwn((await read()).players, 30));
  }
  await action(op, 'addSquad', { name: 'North', player: 10 });
  await action(op, 'addSquad', { name: 'South', player: 20 });
  await action(op, 'schedule');
  const game = (await read()).matches[0];
  const opensAt = new Date(Date.now() + 3600000).toISOString();
  await action(a, 'propose', { match: game.id, opensAt, minutes: 20 });
  const proposal = (await read()).matches[0].proposal.id;
  await action(b, 'decide', { match: game.id, decision: 'accept', proposal });
  // The dedicated worker books the agreed fixture without a page request.
  await waitFor(
    async () => (await read()).matches[0].attempts[0].matchId === 'match-42',
    () => logs,
  );
  const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
  for (const path of [
    '',
    '/schedule',
    '/squads',
    '/standings',
    '/stats',
    '/manage',
    '/playoffs',
    '/matches/1',
    '/squads/north',
  ]) {
    const response = await get(canonical + path, { cookie: op });
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /Winter/);
  }
  await t.test('league links use readable addresses and older bookmarks redirect in one hop', async () => {
    // Before leagues, season pages lived under /seasons, first by ID and later by name
    const old = '/seasons/' + id;
    const north = (await read()).squads.find((team) => team.name === 'North');
    for (const [before, after] of [
      [old, canonical],
      [old + '/schedule?view=results&tag=a&tag=b', canonical + '/schedule?view=results&tag=a&tag=b'],
      [old + '/matches/' + game.id, canonical + '/matches/1'],
      [canonical + '/squads/' + north.id, canonical + '/squads/north'],
      [old + '/squads/north', canonical + '/squads/north'],
      ['/seasons/winter/schedule', canonical + '/schedule'],
      ['/seasons', '/'],
    ]) {
      const res = await get(before);
      assert.equal(res.status, 308, before);
      assert.equal(res.headers.get('location'), after);
    }
    const overview = await (await get(canonical)).text();
    for (const path of ['/schedule', '/squads/north', '/matches/1'])
      assert.ok(overview.includes('href="' + canonical + path + '"'));
    assert.equal((await (await get('/api/league?season=winter')).json()).season.id, id);
    for (const path of ['/matches/0', '/matches/01', '/squads/unknown'])
      assert.equal((await get(canonical + path)).status, 404, path);
  });
  assert.match(await (await get(canonical + '/schedule')).text(), /href="\/winter-league\/winter\/matches\/1"/);
  const now = Date.now();
  const event = {
    schemaVersion: 1,
    deliveryId: 'delivery-1',
    event: 'fixture.ended',
    occurredAt: new Date(now).toISOString(),
    fixture: { ...fixture, state: 'complete', resolution: 'completed' },
    result: {
      schemaVersion: 1,
      outcome: 'elimination',
      draw: false,
      rankedTeams: [['Ace'], ['Finch']],
      perPlayer: { Ace: { kills: 3 }, Finch: { kills: 1 } },
    },
  };
  const body = JSON.stringify(event);
  const headers = {
    'x-subspace-delivery': 'delivery-1',
    'x-subspace-timestamp': String(now),
    'x-subspace-signature': createHmac('sha256', 'test-signing')
      .update(now + '.' + body)
      .digest('hex'),
  };
  for (let repeat = 0; repeat < 2; repeat++)
    assert.equal(
      (await realFetch(url + '/webhooks/reloaded', { method: 'POST', headers, body })).status,
      200,
    );
  assert.equal((await read()).standings[0].wins, 1);
  assert.equal((await read()).performance.players.find((p) => p.id === 10).played, 1);
  const resultPage = canonical + '/matches/1';
  // With nothing left to play the schedule opens on the results; "To be played" is still there to ask for
  const defaultSchedule = await (await get(canonical + '/schedule')).text();
  assert.match(defaultSchedule, /aria-current="true" href="\?view=results"/);
  // The activity ticker links recent results on every page, so only the page content is checked.
  assert.ok(defaultSchedule.slice(defaultSchedule.indexOf('<main')).includes('href="' + resultPage + '"'));
  const upcomingSchedule = await (await get(canonical + '/schedule?view=upcoming')).text();
  assert.match(upcomingSchedule, /No upcoming matches/);
  assert.ok(!upcomingSchedule.slice(upcomingSchedule.indexOf('<main')).includes('href="' + resultPage + '"'));
  // One result is not enough for the activity ticker, which waits until it has three things to say
  assert.doesNotMatch(defaultSchedule, /class="ticker"/);
  assert.ok((await (await get(canonical + '/schedule?view=all')).text()).includes('href="' + resultPage + '"'));
  const outcomes = (html) => [...html.matchAll(/class="outcome [^"]+">([^<]+)<\/span><span class="result-name">([^<]+)</g)]
    .map(([, outcome, squad]) => [squad, outcome]);
  assert.deepEqual(outcomes(await (await get(resultPage)).text()), [['North', 'win'], ['South', 'loss']]);
  await action(op, 'rule', { match: game.id, winner: 'draw', reason: 'Score review' });
  assert.deepEqual(outcomes(await (await get(resultPage)).text()), [['North', 'draw'], ['South', 'draw']]);
  await action(op, 'rule', { match: game.id, winner: game.away, reason: 'Appeal' });
  // In the results list a match is one row, with the winner marked. It was played, so overturning it on
  // appeal does not make it a forfeit.
  const resultsList = await (await get(canonical + '/schedule?view=results')).text();
  assert.match(resultsList, /class="result-side lost"><span class="result-squad"><span>North<\/span><\/span><b class="result-letter">Lost<\/b><\/span><span class="result-side won"><span class="result-squad"><span>South<\/span><\/span><b class="result-letter">Won<\/b>/);
  assert.doesNotMatch(resultsList, /Forfeited/);
  assert.equal((await read()).matches[0].forfeit, null);
  assert.equal((await read()).standings[0].name, 'South');
  assert.equal((await read()).matches[0].rulings.length, 2);
  await action(op, 'playoffs');
  assert.ok((await read()).matches.some((m) => m.series));
  const summerLeague = await league('Summer League');
  const second = await (
    await post('/api/seasons', { name: 'Summer', minPerTeam: 1, league: summerLeague.id }, op)
  ).json();
  assert.equal((await (await get('/api/league?season=' + second.id)).json()).season.matches.length, 0);
  // A league's own rules: an operator writes them in Markdown, the sign-up page and the rules show them
  // as text and never as markup, and the league's next season starts with them
  {
    const rulesLeague = await league('Rules League');
    const one = await (await post('/api/seasons', { name: 'One', league: rulesLeague.id }, op)).json();
    const seasonOf = async (seasonId) => (await (await get('/api/league?season=' + seasonId)).json()).season;
    const run = async (seasonId, cookie, command, params = {}) =>
      post('/api/action', { id: seasonId, revision: (await seasonOf(seasonId)).revision, command, params }, cookie);
    const body = 'Players must have played **20 ranked 4v4 games** in the month before the draft.\n\n- Ask in [the server](https://example.org/x)\n- No <script>alert(1)</script>';
    assert.equal((await run(one.id, a, 'saveRule', { title: 'Eligibility', body })).status, 403);
    assert.equal((await run(one.id, op, 'saveRule', { title: 'Eligibility', body })).status, 200);
    for (const path of ['/rules-league', '/rules-league/one/playoffs']) {
      const page = await (await get(path)).text();
      assert.match(page, /<dt>Eligibility<\/dt>/, path);
      assert.match(page, /<strong>20 ranked 4v4 games<\/strong>/, path);
      assert.match(page, /<li>Ask in <a href="https:\/\/example\.org\/x" rel="nofollow noreferrer">the server<\/a><\/li>/, path);
      assert.match(page, /No &lt;script&gt;alert\(1\)&lt;\/script&gt;/, path);
    }
    assert.match(await (await get('/rules-league/one/manage', { cookie: op })).text(), /League rules[^]*Save rule[^]*Add rule/);
    assert.equal((await run(one.id, op, 'closeSeason')).status, 200);
    const two = await (await post('/api/seasons', { name: 'Two', league: rulesLeague.id }, op)).json();
    const [before] = (await seasonOf(one.id)).rules, [after] = (await seasonOf(two.id)).rules;
    assert.deepEqual([after.title, after.body], [before.title, before.body]);
    assert.notEqual(after.id, before.id);
  }
  assert.equal((await read()).standings[0].name, 'South');

  await t.test(
    'replacement captain can schedule and simultaneous overlapping approvals reserve one fixture',
    async () => {
      const summer = async () => (await (await get('/api/league?season=' + second.id)).json()).season;
      async function send(cookie, command, params = {}, revision) {
        return post(
          '/api/action',
          { id: second.id, revision: revision ?? (await summer()).revision, command, params },
          cookie,
        );
      }
      async function ok(cookie, command, params) {
        const res = await send(cookie, command, params);
        assert.equal(res.status, 200, await res.text());
      }
      const replacement = await login(30, 'summer-league/summer');
      for (const cookie of [op, a, b, replacement]) await ok(cookie, 'enlist');
      await ok(op, 'addSquad', { name: 'North', player: 10 });
      await ok(op, 'addSquad', { name: 'South', player: 20 });
      await ok(op, 'addSquad', { name: 'West', player: 1 });
      const north = (await summer()).squads.find((s) => s.captain === 10);
      await ok(op, 'assign', { squad: north.id, player: 30 });
      const squadPath = second.path + '/squads/' + north.slug;
      assert.match(await (await get(squadPath, { cookie: op })).text(), /Assign captain/);
      assert.doesNotMatch(await (await get(squadPath, { cookie: a })).text(), /Assign captain/);
      await ok(op, 'reassignCaptain', { squad: north.id, player: 30 });
      await ok(op, 'schedule');
      const fixtures = (await summer()).matches.filter((m) => [m.home, m.away].includes(north.id));
      assert.equal(fixtures.length, 2);
      const window = { opensAt, minutes: 20 };
      assert.equal((await send(a, 'propose', { match: fixtures[0].id, ...window })).status, 403);
      for (const m of fixtures) await ok(replacement, 'propose', { match: m.id, ...window });
      const personalSchedule = await (
        await get(second.path + '/schedule?view=mine', { cookie: replacement })
      ).text();
      // Page content only: the activity ticker above it links proposed matches too.
      const scheduleLinks = [...personalSchedule.slice(personalSchedule.indexOf('<main')).matchAll(/href="(\/summer-league\/summer\/matches\/\d+)"/g)].map(
        (m) => m[1],
      );
      assert.deepEqual(
        scheduleLinks.sort(),
        fixtures.map((m) => second.path + '/matches/' + m.number).sort(),
      );
      assert.match(personalSchedule, /Captain tools/);
      const visitorSchedule = await (await get(second.path + '/schedule')).text();
      assert.doesNotMatch(visitorSchedule, /Captain tools|Manage season|My matches/);
      const seen = await summer();
      await ok(op, 'toggleEnlist');
      const approvals = seen.matches
        .filter((m) => m.proposal)
        .map((m) => {
          const opponent = seen.squads.find((s) => s.id === (m.home === north.id ? m.away : m.home));
          return send(
            opponent.captain === 20 ? b : op,
            'decide',
            { match: m.id, proposal: m.proposal.id, decision: 'accept' },
            seen.revision,
          );
        });
      const responses = await Promise.all(approvals);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      assert.match(await responses.find((r) => r.status === 409).text(), /North already has a fixture/);
      const matches = (await summer()).matches;
      assert.equal(matches.flatMap((m) => m.attempts).length, 1);
      assert.equal(matches.filter((m) => m.proposal).length, 1);
    },
  );
  await t.test(
    'signed-in captains run a salary auction and spectators have a separate mock room',
    async () => {
      const auctionLeague = await league('Auction League');
      const created = await (
        await post('/api/seasons', { name: 'Auction season', league: auctionLeague.id }, op)
      ).json();
      const path = created.path;
      const readDraft = async () => (await (await get('/api/league?season=' + created.slug)).json()).season;
      const command = async (cookie, command, params = {}, revision) =>
        post(
          '/api/action',
          { id: created.id, command, params, revision: revision ?? (await readDraft()).revision },
          cookie,
        );
      async function ok(cookie, action, params) {
        const res = await command(cookie, action, params);
        assert.equal(res.status, 200, await res.text());
      }
      const player = await login(30);
      for (const cookie of [a, b, op, player]) await ok(cookie, 'enlist');
      await ok(op, 'addSquad', { name: 'North', player: 10 });
      await ok(op, 'addSquad', { name: 'South', player: 20 });
      for (const id of [1, 30]) await ok(op, 'salary', { player: id, salary: 12 });
      await ok(op, 'draft', { format: 'auction', budget: 20 });
      const seen = (await readDraft()).revision;
      assert.equal((await command(player, 'nominate', { player: 30, amount: 2 })).status, 403);
      await ok(a, 'nominate', { player: 30, amount: 2 });
      // A bid from a page one move behind is judged against the bid that stands: taken if it beats it,
      // refused if it does not
      assert.equal((await command(b, 'bid', { player: 30, amount: 3 }, seen)).status, 200);
      assert.equal((await command(a, 'bid', { player: 30, amount: 3 }, seen)).status, 400);
      await ok(a, 'bid', { player: 30, amount: 4 });
      await ok(b, 'passBid', { player: 30 });
      // A page watching the draft asks only for the season's revision
      assert.deepEqual(await (await get('/api/revision?season=' + (await readDraft()).id)).json(), { revision: (await readDraft()).revision });
      assert.equal((await get('/api/revision?season=nothing')).status, 404);
      const live = await readDraft();
      assert.equal(live.picks[0].price, 4);
      assert.match(await (await get(path + '/draft', { cookie: b })).text(), /Nominate Operator/);
      assert.match(await (await get(path + '/mock')).text(), /Start mock draft/);
      assert.equal((await readDraft()).revision, live.revision);
      // A league's home shows its own season and nothing from the other leagues
      const home = await (await get('/summer-league')).text();
      assert.match(home, /href="\/summer-league\/seasons"/);
      assert.match(home, /<h1>Summer League<\/h1>[^]*<h2>Upcoming matches<\/h2>/);
      // Search engines get a description and one permanent address for each page, and a map of all of them
      assert.match(home, /<meta name="description" content="Summer League[^"]*Subspace league coordinator/);
      assert.match(home, /<link rel="canonical" href="https:\/\/league\.example\.org\/summer-league"/);
      const sitemap = await (await get('/sitemap.xml')).text();
      for (const path of ['/', '/summer-league', '/summer-league/summer/standings', '/winter-league/winter/matches/1'])
        assert.ok(sitemap.includes('<loc>https://league.example.org' + path + '</loc>'), path);
      assert.match(await (await get('/robots.txt')).text(), /Disallow: \/api\/[^]*Sitemap: https:\/\/league\.example\.org\/sitemap\.xml/);
      assert.match(home, /href="\/summer-league\/summer\/standings"/);
      assert.match(home, /href="\/summer-league\/summer\/squads"/);
      assert.doesNotMatch(home, /href="\/auction-league\/auction-season/);
      // The site's front page lists every league
      const front = await (await get('/')).text();
      for (const name of ['Winter League', 'Summer League', 'Auction League'])
        assert.ok(front.includes('href="/' + name.toLowerCase().replace(' ', '-') + '"'), name);
      assert.equal((await get('/no-such-league')).status, 404);
      // A pilot has a page in each league they have been part of, and nowhere else
      const pilotPage = await get('/winter-league/pilots/10');
      assert.equal(pilotPage.status, 200);
      assert.match(await pilotPage.text(), /<h1>[^<]+<\/h1>[^]*href="\/winter-league\/winter\/squads\/north"/);
      for (const path of ['/winter-league/pilots/999999', '/winter-league/pilots/abc', '/winter-league/pilots/010', '/import-league/pilots/10'])
        assert.equal((await get(path)).status, 404, path);
      assert.match(await (await get('/winter-league/winter/squads/north')).text(), /href="\/winter-league\/pilots\/10"/);
      // A season with no squads yet offers its operator the import of a draft held elsewhere
      const importLeague = await league('Import League');
      await post('/api/seasons', { name: 'Spring', league: importLeague.id }, op);
      assert.match(await (await get('/import-league/seasons')).text(), /Spring/);
      assert.match(await (await get('/import-league/spring/draft', { cookie: op })).text(), /Import completed draft/);
      // A league's operators and site admins can delete it by repeating its name; everything in it goes too
      const remove = (body, cookie) =>
        realFetch(url + '/api/leagues', {
          method: 'DELETE',
          headers: { origin, cookie: cookie ?? '', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      assert.match(await (await get('/import-league/manage', { cookie: op })).text(), /Delete this league/);
      assert.doesNotMatch(await (await get('/import-league/manage', { cookie: a })).text(), /Delete this league/);
      assert.equal((await remove({ league: 'import-league', confirm: 'Import League' }, a)).status, 403);
      assert.equal((await remove({ league: 'import-league', confirm: 'Import League' })).status, 403);
      assert.equal((await remove({ league: 'import-league', confirm: 'Wrong name' }, op)).status, 400);
      assert.equal((await get('/import-league')).status, 200);
      const removed = await remove({ league: 'import-league', confirm: 'import league' }, op);
      assert.equal(removed.status, 200);
      assert.equal((await removed.json()).seasons, 1);
      assert.equal((await get('/import-league')).status, 404);
      assert.equal((await get('/import-league/spring/draft')).status, 404);
      assert.ok(!(await (await get('/')).text()).includes('href="/import-league"'));
      assert.ok(!(await (await get('/sitemap.xml')).text()).includes('import-league'));
    },
  );
});

async function waitFor(check, details) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await delay(100);
  }
  assert.fail('Timed out waiting for the league. ' + details());
}
