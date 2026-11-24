import { isTerminal, zoneStates } from './attempts.ts';
import type {
  Season,
  Match,
  Attempt,
  Fixture,
  FixtureEvent,
  ZoneResult,
  ZoneClient,
  ZoneBody,
  RosterSlot,
} from './types.ts';
import type { Store } from './store.ts';
import type { StoredSeason } from './types.ts';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { need, current, withCorrections } from './league.ts';
import { advance } from './competition.ts';

const endpoint = 'https://matchmaking.subspacereloaded.com/api/fixtures';
const states: readonly string[] = zoneStates;
const terminal = (state: string) => isTerminal({ state });

export function verifyEvent(
  headers: Record<string, string>,
  raw: Buffer,
  secret: string,
  now = Date.now(),
): FixtureEvent {
  const ts = headers['x-subspace-timestamp'];
  const sig = headers['x-subspace-signature'];
  need(
    secret && /^\d+$/.test(ts) && Math.abs(now - Number(ts)) <= 300000 && /^[a-f0-9]{64}$/.test(sig),
    'Invalid signature.',
    401,
  );
  const mac = createHmac('sha256', secret)
    .update(ts + '.')
    .update(raw)
    .digest();
  need(timingSafeEqual(mac, Buffer.from(sig, 'hex')), 'Invalid signature.', 401);
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    need(false, 'Invalid delivery.');
  }
  need(
    event.schemaVersion === 1 &&
      typeof event.deliveryId === 'string' &&
      event.deliveryId &&
      event.deliveryId === headers['x-subspace-delivery'] &&
      Number.isFinite(Date.parse(event.occurredAt)),
    'Invalid delivery.',
  );
  return event;
}

function mapResult(m: Match, fixture: Fixture, result: ZoneResult) {
  const names = new Map<string, RosterSlot | null>();
  for (const [i, t] of fixture.teams.entries()) {
    for (const p of t.players) {
      if (p.name)
        names.set(p.name, names.has(p.name) ? null : { id: p.profileId, squad: [m.home, m.away][i] });
    }
  }
  const entries = Object.entries(result.perPlayer ?? {});
  const players = entries
    .filter(([n]) => names.get(n))
    .map(([n, metrics]) => ({ ...names.get(n)!, metrics }));
  const first = result.rankedTeams?.[0] ?? [];
  const ids = new Set(first.map((n) => names.get(n)?.squad));
  const unresolved =
    (!result.draw && (ids.size !== 1 || ids.has(undefined))) || entries.some(([n]) => !names.get(n));
  return { players, winner: result.draw ? null : ([...ids][0] ?? null), unresolved };
}

export function receive(
  s: Season,
  m: Match,
  a: Attempt,
  fixture: Fixture,
  result = fixture.result,
  at: string | null = null,
) {
  need(
    a.externalId === fixture.externalId &&
      fixture.fixtureId &&
      (!a.fixtureId || a.fixtureId === fixture.fixtureId) &&
      states.slice(1).includes(fixture.state),
    'Mismatched fixture.',
  );
  if (terminal(a.state) && fixture.state !== a.state) return;
  if (states.indexOf(fixture.state) < states.indexOf(a.state) && a.state !== 'refused') return;
  if (at && a.eventAt && Date.parse(at) < Date.parse(a.eventAt)) return;
  if (at) a.eventAt = at;
  Object.assign(a, {
    fixtureId: fixture.fixtureId,
    matchId: fixture.matchId,
    matchUrl: fixture.matchUrl,
    replayUrl: fixture.replayUrl,
    state: fixture.state,
    resolution: fixture.resolution,
    opensAt: fixture.opensAt,
    startsBy: fixture.startsBy,
  });
  a.snapshot = fixture;
  if (a.windowJob && a.state !== 'booked') {
    a.windowJob = null;
    a.windowError = 'The zone closed rescheduling before the window change was applied.';
  }
  if (a !== current(m)) return;
  if (m.proposal && m.proposal.state !== a.state) m.proposal = null;
  if (
    fixture.state !== 'complete' ||
    ['abandoned', 'cancelled'].includes(fixture.resolution ?? '') ||
    !result
  )
    return;
  a.rawResult = result;
  const mapped = mapResult(m, fixture, result);
  a.mappedPlayers = mapped.players;
  a.needsReview = mapped.unresolved;
  if (m.rulings.length && m.result) {
    m.result.players = withCorrections(mapped.players, m.statRulings);
  } else if (!mapped.unresolved) {
    m.result = {
      winner: mapped.winner,
      players: withCorrections(mapped.players, m.statRulings),
      source: 'reloaded',
      recordedAt: at ?? m.result?.recordedAt ?? new Date().toISOString(),
    };
    advance(s);
  }
}

export async function deliver(store: Store, event: FixtureEvent) {
  if ((await store.query('SELECT 1 FROM deliveries WHERE id=$1', [event.deliveryId])).rowCount) return;
  const externalId = event.fixture?.externalId;
  need(typeof externalId === 'string', 'Missing fixture external ID.');
  const location = await store.locateAttempt(externalId);
  need(location, 'Unknown fixture.', 404);
  await store.edit(location.seasonId, async (live, tx) => {
    // The receipt is written in the same transaction as the result, so a delivery is applied exactly once
    const inserted = await tx('INSERT INTO deliveries VALUES($1) ON CONFLICT(id) DO NOTHING', [event.deliveryId]);
    if (!inserted.rowCount) return false;
    const match = live.matches.find((m) => m.id === location.matchId);
    const attempt = match?.attempts.find((a) => a.externalId === externalId);
    need(match && attempt, 'Unknown fixture.', 404);
    // Keep lifecycle timestamps even when the start notification arrives after the result.
    if (event.event === 'fixture.started' && event.fixture.state === 'live') attempt.startedAt ??= event.occurredAt;
    if (event.event === 'fixture.ended' && event.fixture.state === 'complete') attempt.endedAt ??= event.occurredAt;
    receive(live, match, attempt, event.fixture, event.result ?? event.fixture.result, event.occurredAt);
  });
}

export function zoneClient(config: { apiKey: string }, request = fetch): ZoneClient {
  return async (method, path, body) => {
    const response = await request(endpoint + path, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok || value.ok === false) {
      const temporary = ['fixture_opening', 'identity_unavailable', 'too_many_fixtures'].includes(
        value.result,
      );
      throw Object.assign(
        new Error([value.result ?? value.error ?? response.status, value.detail].filter(Boolean).join(' — ')),
        // The zone has understood and said no: asking again will get the same answer. A wrong key (401,
        // 403) is this site's fault and is put right here, and "slow down" or a timeout passes, so those
        // are tried again.
        { refused: !temporary && response.status >= 400 && response.status < 500 && ![401, 403, 408, 429].includes(response.status) },
      );
    }
    return value.fixture;
  };
}

// Persist intent before network I/O. Every completion re-reads the latest season so
// votes, webhook deliveries and roster edits made during the request are preserved.
// How long to leave a booking alone after calls for it have failed in a row: half a minute, doubling to
// half an hour
export const backoff = (failures: number) => Math.min(30000 * 2 ** Math.max(0, failures - 1), 1800000);
export async function synchronize(store: Store, config: { callback: string }, call: ZoneClient) {
  for (const season of await store.unfinished()) {
    // One season's trouble is logged and left behind: the seasons after it are still brought up to date
    try {
      if ((await synchronizeSeason(store, config, call, season)) === 'timeout') return;
    } catch (error) {
      console.error('Fixture synchronization, season ' + season.id + ':', error);
    }
  }
}
// Returns 'timeout' when the zone did not answer, which ends the pass: every further call would wait as long
async function synchronizeSeason(store: Store, config: { callback: string }, call: ZoneClient, season: StoredSeason) {
  {
    for (const match of season.matches) {
      const a = current(match);
      if (!a || ((a.after ?? 0) > Date.now() && !a.syncRequested)) continue;
      const path = '/' + encodeURIComponent(a.fixtureId ?? '');
      let task: string, body: ZoneBody | undefined, method: string, route: string;
      if (a.state === 'queued') {
        task = 'book';
        body = { ...a.booking, callback: config.callback };
        method = 'POST';
        route = '';
      } else if (a.windowJob && a.state === 'booked' && !a.windowError) {
        task = 'window';
        body = a.windowJob;
        method = 'PATCH';
        route = path;
      } else if (
        ['booked', 'open'].includes(a.state) &&
        !a.rosterError &&
        JSON.stringify(a.sentTeams) !== JSON.stringify(a.desiredTeams)
      ) {
        task = 'roster';
        body = { teams: a.desiredTeams };
        method = 'PUT';
        route = path + '/roster';
      } else if (
        a.fixtureId &&
        (a.syncRequested || (!terminal(a.state) && Date.now() - (a.polled ?? 0) > 60000))
      ) {
        task = 'poll';
        method = 'GET';
        route = path;
      } else continue;
      function update(fn: (s: Season, m: Match, a: Attempt) => void | boolean) {
        return store.edit(season.id, (live) => {
          const m = live.matches.find((x) => x.id === match.id)!;
          const attempt = m.attempts.find((x) => x.externalId === a!.externalId)!;
          return fn(live, m, attempt);
        });
      }
      try {
        const fixture = await call(method, route, body, a, season);
        await update((s, m, next) => {
          const changed =
            task !== 'poll' ||
            next.error ||
            next.syncRequested ||
            JSON.stringify(next.snapshot) !== JSON.stringify(fixture);
          if (['book', 'roster', 'poll'].includes(task)) {
            need(fixture?.fixtureId, 'The zone response did not include a fixture.');
            receive(s, m, next, fixture);
          }
          if (task === 'book') next.sentTeams = a.booking.teams;
          if (task === 'roster') next.sentTeams = body!.teams;
          if (task === 'window') {
            if (next.state === 'booked' && next.windowJob) {
              next.opensAt = body!.opensAt;
              next.startsBy = body!.startsBy;
              next.windowJob = null;
            }
          }
          next.polled = Date.now();
          next.error = null;
          next.after = 0;
          next.failures = 0;
          next.syncRequested = false;
          return Boolean(changed);
        });
      } catch (err) {
        await update((_s, _m, next) => {
          next.error = String(err instanceof Error ? err.message : err).slice(0, 300);
          next.failures = (next.failures ?? 0) + 1;
          next.after = Date.now() + backoff(next.failures);
          next.syncRequested = false;
          if (!(err instanceof Error && 'refused' in err && err.refused)) return;
          if (task === 'book' && next.state === 'queued') next.state = 'refused';
          if (task === 'window') {
            next.windowError = next.error;
            next.windowJob = null;
          }
          if (task === 'roster') next.rosterError = next.error;
        });
        if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
      }
    }
  }
}
