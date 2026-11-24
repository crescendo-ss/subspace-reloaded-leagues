import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, current, season } from '../src/league.ts';
import { testStore } from './support/db.js';
import { checkRevision } from '../src/revisions.ts';
import { deliver, synchronize } from '../src/reloaded.ts';
import { demoClient } from '../src/demo.ts';

const operator = { id: 1, name: 'Op', operator: true };
const pilot = (id) => ({ id, name: 'Pilot ' + id, operator: false });
const origin = Date.now() + 24 * 3600000;
const iso = (minutes) => new Date(origin + minutes * 60000).toISOString();

async function setup(t, count = 4) {
  const store = await testStore(t);
  const s = season({ name: 'Audit league', minPerTeam: 1 });
  const captains = Array.from({ length: count }, (_, i) => pilot(10 + i));
  for (const captain of captains) {
    apply(s, captain, 'enlist');
    apply(s, operator, 'addSquad', { name: captain.name, player: captain.id });
  }
  apply(s, operator, 'schedule');
  await store.insert(s);
  const read = () => store.read(s.id);
  async function command(actor, cmd, fields = {}, revision) {
    revision ??= (await read()).revision;
    await store.edit(s.id, (live) => {
      checkRevision(live, actor, revision, cmd, fields);
      apply(live, actor, cmd, fields);
    });
  }
  const [north, south, east, west] = s.squads.map((team) => team.id);
  const match = async (a, b) =>
    (await read()).matches.find((m) => [m.home, m.away].includes(a) && [m.home, m.away].includes(b)).id;
  const get = async (id) => (await read()).matches.find((m) => m.id === id);
  async function propose(id, start, minutes = 30) {
    const home = (await get(id)).home;
    await command(pilot((await read()).squads.find((t) => t.id === home).captain), 'propose', {
      match: id,
      opensAt: iso(start),
      minutes,
    });
  }
  async function accept(id) {
    const m = await get(id);
    await command(pilot((await read()).squads.find((t) => t.id === m.away).captain), 'decide', {
      match: id,
      proposal: m.proposal.id,
      decision: 'accept',
    });
  }
  return { s, store, read, command, captains, north, south, east, west, match, get, propose, accept };
}

test('acceptance reserves both squads, permits adjacent windows and independent concurrent fixtures', async (t) => {
  const { north, south, east, west, match, get, propose, accept } = await setup(t);
  const ns = await match(north, south),
    se = await match(south, east),
    ew = await match(east, west);
  await propose(ns, 0);
  await propose(se, 15); // competing proposals may coexist
  await propose(ew, 0);
  await accept(ns);
  await accept(ew);
  await assert.rejects(
    () => accept(se),
    (e) => e.status === 409 && /already has a fixture/.test(e.message),
  );
  assert.equal((await get(se)).attempts.length, 0);
  assert.ok((await get(se)).proposal);
  await propose(se, 30);
  await accept(se);
  assert.equal(current((await get(se))).state, 'queued');
});

test('a pending reschedule holds old and new windows until PATCH succeeds; no-show releases its slot', async (t) => {
  const { store, north, south, east, match, get, propose, accept } = await setup(t);
  const ns = await match(north, south),
    ne = await match(north, east);
  const sync = () => synchronize(store, { callback: 'default' }, demoClient);
  await propose(ns, 0);
  await accept(ns);
  await sync();
  await propose(ns, 90);
  await accept(ns);
  for (const time of [10, 95]) {
    await propose(ne, time);
    await assert.rejects(
    () => accept(ne), /already has a fixture/);
  }
  await sync();
  await propose(ne, 0);
  await accept(ne);
  await sync();
  const a = current((await get(ns)));
  await deliver(store, {
    deliveryId: 'ended',
    fixture: {
      ...a.snapshot,
      state: 'no_show',
      resolution: 'startsBy',
      opensAt: iso(90),
      startsBy: iso(120),
    },
    occurredAt: new Date().toISOString(),
  });
  await propose(ns, 0);
  await assert.rejects(
    () => accept(ns), /already has a fixture/); // retry collides with NE
  await propose(ns, 90);
  await accept(ns);
  assert.equal((await get(ns)).attempts.length, 2);
});

test('a refused reschedule releases the replacement window and keeps the confirmed window', async (t) => {
  const { store, north, south, east, match, propose, accept } = await setup(t);
  const booked = await match(north, south);
  const other = await match(north, east);
  await propose(booked, 0);
  await accept(booked);
  await synchronize(store, { callback: 'default' }, demoClient);
  await propose(booked, 60);
  await accept(booked);
  await synchronize(store, { callback: 'default' }, () => {
    throw Object.assign(new Error('Zone declined the window change.'), { refused: true });
  });
  await propose(other, 0);
  await assert.rejects(
    () => accept(other), /already has a fixture/);
  await propose(other, 60);
  await accept(other);
});

test('operator captain handoff immediately changes authority and updates an existing fixture roster', async (t) => {
  const {
    store,
    command,
    read,
    north,
    south,
    east,
    match,
    get,
    captains: [outgoing, opponent],
    propose,
    accept,
  } = await setup(t);
  const replacement = pilot(90),
    other = pilot(91);
  for (const [p, squad] of [
    [replacement, north],
    [other, south],
  ]) {
    await command(p, 'enlist');
    await command(operator, 'assign', { player: p.id, squad });
  }
  const ns = await match(north, south),
    ne = await match(north, east);
  await propose(ns, 0);
  await accept(ns);
  await synchronize(store, { callback: 'default' }, demoClient);
  const booked = current((await get(ns)));
  await command(outgoing, 'propose', { match: ne, opensAt: iso(60), minutes: 30 });
  await command(outgoing, 'offer', { give: replacement.id, take: other.id });
  await assert.rejects(
    () => command(outgoing, 'reassignCaptain', { squad: north, player: replacement.id }),
    /operator/,
  );
  await assert.rejects(
    () => command(operator, 'reassignCaptain', { squad: north, player: other.id }),
    /on this squad/,
  );
  await command(operator, 'reassignCaptain', { squad: north, player: replacement.id });
  const team = (await read()).squads.find((t) => t.id === north);
  assert.deepEqual(team.roster, [outgoing.id, replacement.id]);
  assert.equal(team.captain, replacement.id);
  assert.equal((await get(ne)).proposal, null);
  assert.equal((await read()).trades[0].state, 'declined');
  await assert.rejects(
    () => command(outgoing, 'propose', { match: ne, opensAt: iso(90), minutes: 30 }),
    (e) => e.status === 403,
  );
  await command(replacement, 'propose', { match: ne, opensAt: iso(90), minutes: 30 });
  let put = 0;
  await synchronize(store, { callback: 'default' }, (method, path, body, a, s) => {
    assert.equal(method, 'PUT');
    assert.equal(path, '/' + booked.fixtureId + '/roster');
    assert.equal(body.teams.find((t) => t.name === team.name).captainProfileId, replacement.id);
    put++;
    return demoClient(method, path, body, a, s);
  });
  assert.equal(put, 1);
  assert.equal(current((await get(ns))).externalId, booked.externalId);
  assert.equal(booked.booking.teams.find((t) => t.name === team.name).captainProfileId, outgoing.id);
  await deliver(store, {
    deliveryId: 'handoff-no-show',
    fixture: { ...current((await get(ns))).snapshot, state: 'no_show', resolution: 'startsBy' },
    occurredAt: new Date().toISOString(),
  });
  await command(opponent, 'propose', { match: ns, opensAt: iso(120), minutes: 30 });
  const retry = { match: ns, proposal: (await get(ns)).proposal.id, decision: 'accept' };
  await assert.rejects(
    () => command(outgoing, 'decide', retry), (e) => e.status === 403);
  await command(replacement, 'decide', retry);
  assert.equal((await get(ns)).attempts.length, 2);
});

test('record revisions allow independent edits and reject stale proposals, trade votes, and captain changes', async (t) => {
  const { command, read, north, south, west, match, get, captains } = await setup(t);
  const ns = await match(north, south),
    initial = (await read()).revision;
  await command(operator, 'toggleEnlist', {}, initial);
  await command(captains[0], 'propose', { match: ns, opensAt: iso(0), minutes: 30 }, initial);
  await assert.rejects(
    () => command(captains[1], 'propose', { match: ns, opensAt: iso(30), minutes: 30 }, initial),
    (e) => e.status === 409,
  );
  const proposal = (await get(ns)).proposal.id;
  await command(operator, 'toggleEnlist');
  const [p, q, r] = [80, 81, 82].map(pilot);
  for (const player of [p, q, r]) await command(player, 'enlist');
  const seen = (await read()).revision;
  await command(operator, 'assign', { squad: north, player: p.id }, seen);
  await command(operator, 'assign', { squad: south, player: q.id }, seen);
  await command(operator, 'assign', { squad: west, player: r.id }, seen);
  await command(captains[0], 'offer', { give: p.id, take: q.id });
  const trade = (await read()).trades[0].id,
    offered = (await read()).revision;
  await command(captains[3], 'kick', { player: r.id });
  await command(captains[1], 'trade', { trade, decision: 'accept' }, offered);
  await assert.rejects(
    () => command(operator, 'trade', { trade, decision: 'accept' }, offered),
    (e) => e.status === 409,
  );
  const beforeHandoff = (await read()).revision;
  await command(operator, 'reassignCaptain', { squad: south, player: q.id });
  await assert.rejects(
    () => command(operator, 'reassignCaptain', { squad: south, player: captains[1].id }, beforeHandoff),
    (e) => e.status === 409,
  );
  await command(q, 'decide', { match: ns, proposal, decision: 'accept' }); // incoming proposal survives handoff
});

test('callbacks find their season by attempt ID without scanning, and a failed delivery leaves no trace', async (t) => {
  const { s, store, read, north, south, match, propose, accept } = await setup(t);
  const id = await match(north, south);
  await propose(id, 0);
  await accept(id);
  // A booking that ended as a no-show, with its retry already queued under a new ID
  await store.edit(s.id, (live) => {
    const m = live.matches.find((x) => x.id === id),
      a = current(m);
    a.state = 'no_show';
    a.fixtureId = 'first';
    m.attempts.push({ ...structuredClone(a), state: 'queued', fixtureId: undefined, externalId: 'retry' });
  });
  const archive = season({ name: 'Archive' });
  await store.insert(archive);
  const before = await read(),
    m = before.matches.find((x) => x.id === id),
    a = m.attempts[0];
  store.list = () => assert.fail('webhook scanned seasons');
  for (const attempt of m.attempts)
    assert.deepEqual(await store.locateAttempt(attempt.externalId), { seasonId: s.id, matchId: id });
  const payload = {
    deliveryId: 'old-delivery',
    occurredAt: new Date().toISOString(),
    fixture: { externalId: a.externalId, fixtureId: 'wrong', state: 'no_show' },
  };
  // A delivery that is refused rolls back its receipt, so the corrected one is still accepted
  await assert.rejects(deliver(store, payload), /Mismatched fixture/);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n, 0);
  payload.fixture.fixtureId = 'first';
  await deliver(store, payload);
  await deliver(store, payload);
  const updated = await read();
  assert.equal(updated.revision, before.revision + 1);
  assert.equal(current(updated.matches.find((x) => x.id === id)).state, 'queued');
  assert.equal((await store.read(archive.id)).revision, 1);
  await assert.rejects(
    deliver(store, { ...payload, deliveryId: 'unknown', fixture: { externalId: 'missing' } }),
    (e) => e.status === 404,
  );
  // An attempt ID belongs to one season: a second season claiming it changes nothing
  await assert.rejects(
    store.edit(archive.id, (live) => void live.matches.push(structuredClone(m))),
    /duplicate key/,
  );
  assert.equal((await store.read(archive.id)).matches.length, 0);
  assert.equal((await store.locateAttempt('retry')).seasonId, s.id);
});

test('a league is deleted with its seasons and their index rows, but not while a match is booked', async (t) => {
  const { s, store, north, south, match, propose, accept } = await setup(t);
  const id = await match(north, south);
  await propose(id, 0);
  await accept(id);
  const league = (await store.read(s.id)).league;
  const other = await store.insertLeague('Untouched');
  const kept = season({ name: 'Kept' });
  kept.league = other.id;
  await store.insert(kept);
  const externalId = current((await store.read(s.id)).matches.find((m) => m.id === id)).externalId;
  // The booking is waiting to be sent to Reloaded: its result would have nowhere to go
  await assert.rejects(store.deleteLeague(league), (e) => e.status === 409 && /booked or being played/.test(e.message));
  assert.equal((await store.read(s.id)).id, s.id);
  await store.edit(s.id, (live) => {
    current(live.matches.find((m) => m.id === id)).state = 'cancelled';
  });
  assert.equal(await store.deleteLeague(league), 1);
  await assert.rejects(store.read(s.id), (e) => e.status === 404);
  await assert.rejects(store.league(league), (e) => e.status === 404);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM fixture_attempts WHERE external_id=$1', [externalId])).rows[0].n, 0);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM match_stats WHERE league=$1', [league])).rows[0].n, 0);
  // Other leagues are left alone
  assert.deepEqual((await store.leagues()).map((l) => l.name), ['Untouched']);
  assert.equal((await store.read(kept.id)).name, 'Kept');
  await assert.rejects(store.deleteLeague(league), (e) => e.status === 404);
});
