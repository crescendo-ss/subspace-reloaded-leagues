import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const origin = 'https://league.example.org';
const realFetch = globalThis.fetch;
const people = new Map([
  [1, 'Operator'],
  [10, 'Ace'],
  [20, 'Finch'],
  [30, 'Relay'],
]);
let fixture;
globalThis.fetch = async (url, req) => {
  const target = String(url);
  if (
    !target.startsWith('https://auth.subspacereloaded.com/') &&
    !target.startsWith('https://matchmaking.subspacereloaded.com/')
  )
    return realFetch(url, req);
  if (target === 'https://auth.subspacereloaded.com/oauth/token') {
    const input = JSON.parse(req.body);
    assert.equal(input.client_secret, 'test-secret');
    assert.equal(input.redirect_uri, origin + '/auth/callback');
    assert.equal(input.grant_type, 'authorization_code');
    const id = Number(input.code);
    return Response.json({ profileId: id, displayName: people.get(id), scopes: ['identity', 'fixtures'] });
  }
  if (req.method === 'GET')
    return Response.json({ fixture: JSON.parse(readFileSync(process.env.TEST_FIXTURE_FILE, 'utf8')) });
  assert.equal(target, 'https://matchmaking.subspacereloaded.com/api/fixtures');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['x-api-key'], 'test-key');
  const input = JSON.parse(req.body);
  assert.equal(input.callback, 'test-callback');
  fixture = {
    ...input,
    state: 'booked',
    fixtureId: 'fixture-abc',
    matchId: 'match-42',
    matchUrl: 'https://subspacereloaded.com/matches/match-42',
    teams: input.teams.map((t) => ({
      name: t.name,
      players: t.roster.map((p) => ({ ...p, name: people.get(p.profileId) })),
    })),
  };
  writeFileSync(process.env.TEST_FIXTURE_FILE, JSON.stringify(fixture));
  return Response.json({ ok: true, result: 'booked', fixture });
};
