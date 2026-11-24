import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openStore } from '../src/store.ts';
import { databaseUrl, freshSchema, testStore } from './support/db.js';
import { season, apply, current } from '../src/league.ts';
import { standings, performance } from '../src/competition.ts';
import { zoneClient, deliver, verifyEvent, synchronize, backoff } from '../src/reloaded.ts';

async function league(t) {
  const store = await testStore(t);
  const op = { id: 1, name: 'Op', operator: true };
  const s = season({ name: 'Spring', minPerTeam: 1 });
  const pilots = [
    { id: 221, name: 'Green' },
    { id: 352, name: 'Blue' },
    { id: 512, name: 'Spare' },
  ];
  for (const p of pilots) apply(s, p, 'enlist');
  for (const [i, p] of pilots.slice(0, 2).entries())
    apply(s, op, 'addSquad', { name: 'Squad ' + i, player: p.id });
  apply(s, op, 'schedule');
  await store.insert(s);
  const read = () => store.read(s.id);
  const match = s.matches[0].id;
  function command(actor, cmd, params = {}) {
    return store.edit(s.id, (live) => apply(live, actor, cmd, { match, ...params }));
  }
  async function agree() {
    await command(pilots[0], 'propose', { opensAt: new Date(Date.now() + 3600000).toISOString(), minutes: 30 });
    const proposal = (await read()).matches[0].proposal.id;
    await assert.rejects(command(pilots[0], 'decide', { proposal, decision: 'accept' }));
    await command(pilots[1], 'decide', { proposal, decision: 'accept' });
  }
  const attempt = async () => current((await read()).matches[0]);
  const wire = async (a) => {
    a ??= await attempt();
    return {
      externalId: a.externalId,
      fixtureId: 'zone-' + a.externalId,
      matchId: 'match-' + a.externalId,
      state: 'booked',
      matchUrl: 'https://subspacereloaded.com/matches/example',
      replayUrl: null,
      opensAt: a.booking.opensAt,
      startsBy: a.booking.startsBy,
      resolution: null,
      teams: a.booking.teams.map((t) => ({
        name: t.name,
        players: t.roster.map((p) => ({ ...p, name: s.players[p.profileId] })),
      })),
    };
  };
  const cfg = { callback: 'league' };
  const sync = (fn) => synchronize(store, cfg, fn);
  const event = (id, f, at = Date.now()) =>
    deliver(store, { deliveryId: id, occurredAt: new Date(at).toISOString(), fixture: f });
  return { read, store, s, op, pilots, command, agree, attempt, wire, sync, event };
}
test('timeouts retry the same booking; a mutually approved no-show retry gets a new ID', async (t) => {
  const { read, store, s, op, agree, attempt, wire, sync, event, command } = await league(t);
  await agree();
  const original = (await attempt()).externalId;
  await sync(() => {
    throw Error('Timed out');
  });
  assert.equal((await attempt()).externalId, original);
  await command(op, 'sync');
  await sync((method, path, body) => {
    assert.equal(method, 'POST');
    assert.equal(path, '');
    assert.equal(body.externalId, original);
    assert.equal(body.callback, 'league');
    assert.equal(body.teams[0].roster[0].profileId, 221);
    return wire();
  });
  await agree();
  assert.ok((await attempt()).windowJob);
  await event('noshow', { ...(await wire()), state: 'no_show', resolution: 'startsBy' });
  assert.equal((await attempt()).windowJob, null);
  await agree();
  assert.notEqual((await attempt()).externalId, original);
  const old = (await read()).matches[0].attempts[0];
  await event('late', { ...(await wire(old)), state: 'open' });
  assert.equal((await attempt()).state, 'queued');
  assert.equal((await read()).matches[0].attempts[0].state, 'no_show');
  assert.equal((await store.read(s.id)).matches[0].attempts.length, 2);
});
test('signed results are idempotent, survive renamed pilots, and operator rulings take precedence', async (t) => {
  const { s, op, store, read, agree, wire, sync, event, command } = await league(t);
  await agree();
  await sync(() => wire());
  const f = await wire(),
    now = Date.now();
  const result = {
    schemaVersion: 1,
    draw: false,
    outcome: 'elimination',
    rankedTeams: [['Green'], ['Blue']],
    perPlayer: { Green: { kills: 8 }, Blue: { kills: 2 } },
  };
  const envelope = {
    schemaVersion: 1,
    deliveryId: 'end',
    event: 'fixture.ended',
    occurredAt: new Date(now).toISOString(),
    fixture: { ...f, state: 'complete', resolution: 'completed' },
    result,
  };
  const raw = Buffer.from(JSON.stringify(envelope)),
    ts = String(now);
  const headers = {
    'x-subspace-timestamp': ts,
    'x-subspace-delivery': 'end',
    'x-subspace-signature': createHmac('sha256', 'secret')
      .update(ts + '.')
      .update(raw)
      .digest('hex'),
  };
  assert.throws(() => verifyEvent(headers, raw, 'secret', now + 300001));
  assert.throws(() => verifyEvent(headers, Buffer.concat([raw, Buffer.from(' ')]), 'secret', now));
  const verified = verifyEvent(headers, raw, 'secret', now);
  await deliver(store, verified);
  await deliver(store, verified);
  // The result is also on record as one row per pilot, which is what totals across seasons are read from
  const totals = async () => (await store.pilotTotals()).map((row) => [row.player, row.played, row.wins, row.kills]);
  assert.deepEqual(await totals(), [[221, 1, 1, 8], [352, 1, 0, 2]]);
  const startedAt = new Date(now - 16 * 60000).toISOString();
  await deliver(store, { event: 'fixture.started', deliveryId: 'late-start', occurredAt: startedAt, fixture: { ...f, state: 'live' } });
  const played = current((await read()).matches[0]);
  assert.equal(played.startedAt, startedAt);
  assert.equal(played.endedAt, envelope.occurredAt);
  assert.equal(played.state, 'complete');
  await event('late-open', { ...f, state: 'open' }, now - 1000);
  await store.edit(s.id, (live) => {
    live.players[221] = 'Renamed';
  });
  assert.equal(performance((await read())).players.find((x) => x.id === 221).metrics.kills, 8);
  assert.equal(standings((await read()))[0].id, s.squads[0].id);
  await command(op, 'rule', { winner: s.squads[1].id, reason: 'Appeal upheld' });
  await deliver(store, { ...envelope, deliveryId: 'end-again' });
  const updated = (await read());
  assert.equal(standings(updated)[0].id, s.squads[1].id);
  // A ruling that changes the winner changes those rows with it
  assert.deepEqual(await totals(), [[221, 1, 0, 8], [352, 1, 1, 2]]);
  assert.equal(updated.matches[0].result.source, 'operator');
  assert.equal(updated.matches[0].attempts[0].rawResult.outcome, 'elimination');
  assert.equal(performance(updated).squads[0].metrics.kills, 8);
});
test('roster changes use full PUT snapshots; rescheduling uses the existing fixture', async (t) => {
  const { read, s, op, pilots, agree, attempt, wire, sync, command } = await league(t);
  await agree();
  await sync(() => wire());
  const id = (await attempt()).fixtureId;
  await command(op, 'assign', { squad: s.squads[0].id, player: pilots[2].id });
  await sync((method, path, body) => {
    assert.equal(method, 'PUT');
    assert.equal(path, '/' + id + '/roster');
    assert.equal(body.teams.length, 2);
    assert.equal(body.teams[0].roster.length, 2);
    return wire();
  });
  await agree();
  await sync((method, path, body) => {
    assert.equal(method, 'PATCH');
    assert.equal(path, '/' + id);
    assert.deepEqual(Object.keys(body).sort(), ['opensAt', 'startsBy']);
  });
  assert.equal((await read()).matches[0].attempts.length, 1);
});
test('ambiguous zone names preserve the result for a ruling', async (t) => {
  const { s, op, read, agree, sync, wire, event, command } = await league(t);
  await agree();
  await sync(() => wire());
  await event('end', {
    ...(await wire()),
    state: 'complete',
    resolution: 'completed',
    result: { draw: false, rankedTeams: [['Unknown']], perPlayer: { Unknown: { kills: 1 } } },
  });
  assert.equal((await read()).matches[0].result, null);
  assert.ok(current((await read()).matches[0]).needsReview);
  await command(op, 'rule', { winner: s.squads[0].id, reason: 'Verified scoreboard' });
  assert.equal((await read()).matches[0].result.winner, s.squads[0].id);
});
test('zone HTTP client uses documented origin, API key, and temporary refusal handling', async (t) => {
  const call = zoneClient({ apiKey: 'key' }, async (url, req) => {
    assert.equal(url, 'https://matchmaking.subspacereloaded.com/api/fixtures/f/roster');
    assert.equal(req.headers['x-api-key'], 'key');
    assert.equal(req.method, 'PUT');
    return Response.json({ ok: false, result: 'fixture_opening' }, { status: 409 });
  });
  await assert.rejects(call('PUT', '/f/roster', { teams: [] }), (err) => err.refused === false);
});
test('a failing booking backs off, a refusal ends it, and an operator can abandon one that is stuck', async (t) => {
  const { op, agree, attempt, wire, sync, command } = await league(t);
  // What the zone says no to is not asked again; a wrong key or "slow down" is
  const answer = (status) => zoneClient({ apiKey: 'key' }, async () => Response.json({ ok: false, error: 'no' }, { status }))('POST', '', {});
  for (const [status, refused] of [[400, true], [404, true], [409, true], [422, true], [401, false], [403, false], [408, false], [429, false], [500, false], [503, false]])
    await assert.rejects(answer(status), (err) => err.refused === refused, 'status ' + status);
  assert.deepEqual([1, 2, 3, 7, 20].map(backoff), [30000, 60000, 120000, 1800000, 1800000]);

  await agree();
  // Each failure in a row waits longer before the next try
  const fail = () => sync(() => { throw Error('Bad gateway'); });
  await fail();
  const first = await attempt();
  assert.deepEqual([first.state, first.failures, first.error], ['queued', 1, 'Bad gateway']);
  assert.ok(first.after - Date.now() > 25000 && first.after - Date.now() <= 30000);
  await command(op, 'sync');
  await fail();
  const second = await attempt();
  assert.equal(second.failures, 2);
  assert.ok(second.after - Date.now() > 55000);
  // While it is stuck, an operator frees the match: the captains can then agree a time again
  await assert.rejects(command({ id: 221, name: 'Green' }, 'abandon'), /operator/);
  await command(op, 'abandon');
  const gone = await attempt();
  assert.deepEqual([gone.state, gone.resolution], ['cancelled', 'abandoned']);
  await assert.rejects(command(op, 'abandon'), /no booking in progress/);
  await agree();
  assert.notEqual((await attempt()).externalId, gone.externalId);
  // A booking that is in order is not one to abandon
  await sync(() => wire());
  assert.equal((await attempt()).failures, 0);
  await assert.rejects(command(op, 'abandon'), /in order/);
});

test('one season that cannot be saved does not stop the others being brought up to date', async (t) => {
  const store = await testStore(t);
  const op = { id: 1, name: 'Op', operator: true };
  const seasons = [];
  for (const name of ['Autumn', 'Winter']) {
    const s = season({ name, minPerTeam: 1 });
    for (const p of [{ id: 221, name: 'Green' }, { id: 352, name: 'Blue' }]) apply(s, p, 'enlist');
    apply(s, op, 'addSquad', { name: 'A', player: 221 });
    apply(s, op, 'addSquad', { name: 'B', player: 352 });
    apply(s, op, 'schedule');
    const m = s.matches[0];
    apply(s, { id: 221, name: 'Green' }, 'propose', { match: m.id, opensAt: new Date(Date.now() + 3600000).toISOString(), minutes: 30 });
    apply(s, { id: 352, name: 'Blue' }, 'decide', { match: m.id, proposal: m.proposal.id, decision: 'accept' });
    await store.insert(s);
    seasons.push(s);
  }
  const errors = [];
  const log = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  t.after(() => (console.error = log));
  const asked = [];
  // The newer season is reached first, and nothing about it can be saved, not even the failure. The older
  // one is still brought up to date, and the trouble is logged.
  const flaky = { ...store, edit: (id, fn) => (id === seasons[1].id ? Promise.reject(new Error('disk full')) : store.edit(id, fn)) };
  await synchronize(flaky, { callback: 'league' }, (method, path, body, a, s) => {
    asked.push(s.name);
    return {
      externalId: a.externalId, fixtureId: 'zone-' + a.externalId, matchId: 'match-' + a.externalId, state: 'booked', matchUrl: null, replayUrl: null,
      opensAt: a.booking.opensAt, startsBy: a.booking.startsBy, resolution: null,
      teams: a.booking.teams.map((team) => ({ name: team.name, players: team.roster.map((p) => ({ ...p, name: s.players[p.profileId] })) })),
    };
  });
  assert.deepEqual(asked, ['Winter', 'Autumn']);
  assert.equal((await store.read(seasons[0].id)).matches[0].attempts[0].state, 'booked');
  assert.equal((await store.read(seasons[1].id)).matches[0].attempts[0].state, 'queued');
  assert.match(errors.join('\n'), /season .*disk full/);
});

test('pending bookings persist across closing and reopening the database', async (t) => {
  const { read, agree, wire } = await league(t);
  await agree();
  const pending = await read();
  // The second database has a league of its own for the season to join
  delete pending.league;
  const schema = freshSchema();
  const first = await openStore(databaseUrl, { schema });
  await first.insertLeague('Restarted League');
  await first.insert(pending);
  await first.close();
  const second = await openStore(databaseUrl, { schema });
  t.after(() => second.close({ drop: true }));
  const externalId = current(pending.matches[0]).externalId;
  await synchronize(second, { callback: 'default' }, (_method, _path, body) => {
    assert.equal(body.externalId, externalId);
    return wire();
  });
  assert.equal(current((await second.read(pending.id)).matches[0]).fixtureId, 'zone-' + externalId);
});
test('audited pilot stat corrections survive later callbacks and roster moves', async (t) => {
  const { s, op, read, agree, sync, wire, event, command } = await league(t);
  await agree();
  await sync(() => wire());
  const fixture = {
    ...(await wire()),
    state: 'complete',
    resolution: 'completed',
    result: {
      draw: false,
      rankedTeams: [['Green'], ['Blue']],
      perPlayer: { Green: { kills: 1 }, Blue: { kills: 2 } },
    },
  };
  await event('initial', fixture);
  await command(op, 'assign', { player: 512, squad: s.squads[0].id });
  await command(op, 'correctMetric', { player: 221, metric: 'kills', value: 6, reason: 'Replay review' });
  await event('redelivery', fixture);
  assert.equal(performance((await read())).players.find((p) => p.id === 221).metrics.kills, 6);
  assert.equal(performance((await read())).squads.find((t) => t.id === s.squads[0].id).metrics.kills, 6);
  assert.equal((await read()).matches[0].statRulings[0].by, op.id);
  await assert.rejects(() =>
    command(op, 'correctMetric', { player: 512, metric: 'kills', value: 1, reason: 'Not on roster' }),
  );
});
