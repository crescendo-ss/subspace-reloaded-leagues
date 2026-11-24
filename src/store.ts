// Storage, on Postgres. A season is kept whole as one JSON document with its league, address and revision
// beside it, because the league's rules work on a season as a unit. Two things are also kept as rows so they
// can be looked up without opening every season: which season owns a fixture attempt, and each pilot's
// statistics for each match.
import { isActive } from './attempts.ts';
import { upgrade } from './upgrade.ts';
import type { League, Match, Season, StoredSeason } from './types.ts';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { invariant, need } from './league.ts';
import { resourceState, updateVersions } from './revisions.ts';
import { assignSeasonUrls, availableSlug } from './urls.ts';

// Addresses are /league/season/page, so these names are taken by the site and by each league's own pages.
export const reservedLeagueSlugs = ['account', 'api', 'auth', 'leagues', 'seasons', 'webhooks', 'images', 'fonts', 'new'];
export const reservedSeasonSlugs = ['new', 'seasons', 'manage', 'champions', 'pilots'];
// Raised when the tables or the store's own functions change, so a development server reopens its connection
export const storeVersion = 4;

// Postgres returns 64-bit integers as text. Profile IDs and millisecond times are well within a JS number.
pg.types.setTypeParser(20, Number);

type Rows = Record<string, any>[];
// Runs one statement, inside a transaction when it was handed out by one
export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Rows; rowCount: number }>;

const tables = `
  CREATE TABLE IF NOT EXISTS leagues(
    position BIGINT GENERATED ALWAYS AS IDENTITY,
    id TEXT PRIMARY KEY,
    data JSON NOT NULL,
    slug TEXT GENERATED ALWAYS AS (data ->> 'slug') STORED UNIQUE
  );
  CREATE TABLE IF NOT EXISTS seasons(
    position BIGINT GENERATED ALWAYS AS IDENTITY,
    id TEXT PRIMARY KEY,
    data JSON NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    league TEXT GENERATED ALWAYS AS (data ->> 'league') STORED,
    slug TEXT GENERATED ALWAYS AS (data ->> 'slug') STORED,
    name TEXT GENERATED ALWAYS AS (data ->> 'name') STORED,
    finished BOOLEAN GENERATED ALWAYS AS ((data ->> 'champion') IS NOT NULL OR coalesce((data ->> 'closed')::boolean, false)) STORED,
    started BOOLEAN GENERATED ALWAYS AS (json_array_length(data -> 'matches') > 0) STORED,
    UNIQUE (league, slug)
  );
  CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS identities(id BIGINT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, profile BIGINT NOT NULL, expires BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS oauth(token TEXT PRIMARY KEY, expires BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS fixture_attempts(
    external_id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    match_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_stats(
    league TEXT NOT NULL,
    season_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    player BIGINT NOT NULL,
    squad TEXT NOT NULL,
    won BOOLEAN NOT NULL,
    playoff BOOLEAN NOT NULL,
    metrics JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS match_stats_match ON match_stats(season_id, match_id);
  CREATE INDEX IF NOT EXISTS match_stats_player ON match_stats(player);
  CREATE INDEX IF NOT EXISTS match_stats_league ON match_stats(league);
`;

// Changes to a database that already exists, in order. `tables` always describes the newest shape, so a new
// database starts at the last of these and an older one runs the ones it has not had. Add to the end, and
// never edit one that has shipped. Each should be safe to run twice.
export const migrations: string[] = [
  // 1. What a list of seasons needs, kept beside the document so the document is not parsed to list them
  `ALTER TABLE seasons
     ADD COLUMN IF NOT EXISTS name TEXT GENERATED ALWAYS AS (data ->> 'name') STORED,
     ADD COLUMN IF NOT EXISTS finished BOOLEAN GENERATED ALWAYS AS ((data ->> 'champion') IS NOT NULL OR coalesce((data ->> 'closed')::boolean, false)) STORED,
     ADD COLUMN IF NOT EXISTS started BOOLEAN GENERATED ALWAYS AS (json_array_length(data -> 'matches') > 0) STORED`,
];

function attempts(s: Season) {
  const byExternalId = new Map<string, string>();
  for (const m of s.matches) {
    for (const a of m.attempts) {
      invariant(!byExternalId.has(a.externalId), 'Duplicate fixture attempt ID.');
      byExternalId.set(a.externalId, m.id);
    }
  }
  return byExternalId;
}
// One row for each pilot in each match that has a result, as the statistics table holds them
function statRows(m: Match) {
  return (m.result?.players ?? []).map((p) => ({
    player: p.id,
    squad: p.squad,
    won: m.result!.winner === p.squad,
    metrics: p.metrics,
  }));
}
// What a match contributes to the statistics table, as text, so a change to it can be noticed
const stats = (s: Season) =>
  new Map(s.matches.filter((m) => m.result).map((m) => [m.id, JSON.stringify([m.result!.recordedAt, !!m.series, statRows(m)])]));

export async function openStore(
  url: string,
  { schema }: { schema?: string } = {},
) {
  need(!schema || /^[a-z_][a-z0-9_]*$/.test(schema), 'A database schema name uses lowercase letters, digits and underscores.');
  // With a schema, everything this store does stays inside it: the demo and each test run have their own.
  const pool = new pg.Pool({ connectionString: url, max: 10, options: schema ? '-c search_path=' + schema : undefined });
  const query: Query = async (sql, params) => {
    const result = await pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  };
  async function transaction<T>(fn: (tx: Query) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(async (sql, params) => {
        const result = await client.query(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      });
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  // Holds a lock that every process opening this database respects, for work that must happen only once:
  // creating the tables, and filling an empty database. The web server and the worker start together.
  async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', ['deepspace:' + (schema ?? 'public')]);
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['deepspace:' + (schema ?? 'public')]).catch(() => {});
      client.release();
    }
  }
  await exclusive(async () => {
    if (schema) await query('CREATE SCHEMA IF NOT EXISTS ' + schema);
    // A database that had seasons before it had a version is at version 0; a new one is already current
    const existed = (await query(`SELECT to_regclass('seasons') IS NOT NULL AS found`)).rows[0].found;
    // A new installation starts with no leagues: a site admin creates the first one.
    await query(tables);
    const recorded = (await query('SELECT version FROM schema_version')).rows[0];
    let version = recorded ? Number(recorded.version) : existed ? 0 : migrations.length;
    if (!recorded) await query('INSERT INTO schema_version VALUES($1)', [version]);
    for (; version < migrations.length; version++) {
      const step = version;
      await transaction(async (tx) => {
        await tx(migrations[step]);
        await tx('UPDATE schema_version SET version=$1', [step + 1]);
      });
    }
  });

  const stored = (row: Rows[number]): StoredSeason => upgrade({ ...row.data, revision: Number(row.revision) });
  // By ID, or by address within a league. Without a league, an address finds the oldest season that has
  // it, which is how links from before leagues existed still resolve.
  const read = async (idOrSlug: string, league?: string): Promise<StoredSeason> => {
    const { rows } = await query(
      `SELECT data, revision FROM seasons
       WHERE id=$1 OR (slug=$1 AND ($2::text IS NULL OR league=$2))
       ORDER BY (id=$1) DESC, position LIMIT 1`,
      [idOrSlug, league ?? null],
    );
    need(rows[0], 'Season not found.', 404);
    return stored(rows[0]);
  };
  const league = async (idOrSlug: string): Promise<League> => {
    const { rows } = await query('SELECT data FROM leagues WHERE id=$1 OR slug=$1', [idOrSlug]);
    need(rows[0], 'League not found.', 404);
    return rows[0].data;
  };
  const seasonsOf = async (leagueId?: string, run: Query = query) =>
    (
      await run(
        `SELECT id, name, slug, league, finished, started
         FROM seasons WHERE $1::text IS NULL OR league=$1 ORDER BY position DESC`,
        [leagueId ?? null],
      )
    ).rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      league: String(row.league),
      // Over: it has a champion, or an operator closed it
      over: !!row.finished,
      started: !!row.started,
    }));
  // Keep the lookup tables in step with a season, changing only the rows whose match changed.
  async function index(tx: Query, s: Season, previousAttempts: Map<string, string>, previousStats: Map<string, string>) {
    const next = attempts(s);
    for (const [id, match] of previousAttempts)
      if (next.get(id) !== match) await tx('DELETE FROM fixture_attempts WHERE external_id=$1 AND season_id=$2', [id, s.id]);
    for (const [id, match] of next)
      if (previousAttempts.get(id) !== match)
        await tx('INSERT INTO fixture_attempts(external_id,season_id,match_id) VALUES($1,$2,$3)', [id, s.id, match]);
    const nextStats = stats(s);
    for (const id of new Set([...previousStats.keys(), ...nextStats.keys()])) {
      if (previousStats.get(id) === nextStats.get(id)) continue;
      await tx('DELETE FROM match_stats WHERE season_id=$1 AND match_id=$2', [s.id, id]);
      const m = s.matches.find((match) => match.id === id);
      if (!m?.result) continue;
      for (const row of statRows(m))
        await tx(
          `INSERT INTO match_stats(league,season_id,match_id,player,squad,won,playoff,metrics,recorded_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [s.league, s.id, m.id, row.player, row.squad, row.won, !!m.series, JSON.stringify(row.metrics), m.result.recordedAt],
        );
    }
  }
  return {
    version: storeVersion,
    query,
    exclusive,
    read,
    async locateAttempt(id: string) {
      const row = (await query('SELECT season_id, match_id FROM fixture_attempts WHERE external_id=$1', [id])).rows[0];
      return row && { seasonId: String(row.season_id), matchId: String(row.match_id) };
    },
    list: async () => (await query('SELECT data, revision FROM seasons ORDER BY position DESC')).rows.map(stored),
    // Seasons still being played: the only ones with bookings to keep in step, however long the history
    unfinished: async () => (await query('SELECT data, revision FROM seasons WHERE NOT finished ORDER BY position DESC')).rows.map(stored),
    league,
    leagues: async (): Promise<League[]> => (await query('SELECT data FROM leagues ORDER BY position')).rows.map((row) => row.data),
    insertLeague(name: string, tagline = '') {
      return transaction(async (tx) => {
        // One league is named at a time, so two cannot take the same address
        await tx('SELECT pg_advisory_xact_lock(hashtext($1))', ['deepspace:league-names']);
        const taken = new Set((await tx('SELECT id, slug FROM leagues')).rows.flatMap((row) => [row.id, row.slug]));
        const created: League = {
          id: randomUUID(),
          slug: availableSlug(name, 'league', (value) => reservedLeagueSlugs.includes(value) || taken.has(value)),
          name,
          tagline,
          operators: [],
        };
        await tx('INSERT INTO leagues(id,data) VALUES($1,$2)', [created.id, JSON.stringify(created)]);
        return created;
      });
    },
    // The address stays the same when a league is renamed, so links to it keep working.
    editLeague(id: string, fn: (league: League) => void) {
      return transaction(async (tx) => {
        const row = (await tx('SELECT data FROM leagues WHERE id=$1 OR slug=$1 FOR UPDATE', [id])).rows[0];
        need(row, 'League not found.', 404);
        const current: League = row.data;
        fn(current);
        await tx('UPDATE leagues SET data=$1 WHERE id=$2', [JSON.stringify(current), current.id]);
        return current;
      });
    },
    // A league goes with everything in it: its seasons and their squads, results and statistics. It is refused
    // while a match is booked with Reloaded or being played, whose result would arrive for a league that is gone.
    deleteLeague(id: string) {
      return transaction(async (tx) => {
        need((await tx('SELECT 1 FROM leagues WHERE id=$1 FOR UPDATE', [id])).rowCount, 'League not found.', 404);
        const seasons = (await tx('SELECT id, data FROM seasons WHERE league=$1 FOR UPDATE', [id])).rows;
        for (const row of seasons) {
          const s: Season = row.data;
          const busy = s.matches.some((m) => m.attempts.some((a) => isActive(a)));
          need(!busy, s.name + ' has a match booked or being played. Wait for it to finish, or cancel it, before deleting the league.', 409);
        }
        await tx('DELETE FROM match_stats WHERE league=$1', [id]);
        await tx('DELETE FROM fixture_attempts WHERE season_id = ANY($1)', [seasons.map((row) => String(row.id))]);
        await tx('DELETE FROM seasons WHERE league=$1', [id]);
        await tx('DELETE FROM leagues WHERE id=$1', [id]);
        return seasons.length;
      });
    },
    // A league's season in progress: the newest one that is not over. A league has at most one.
    activeSeason: async (leagueId: string, run?: Query) => (await seasonsOf(leagueId, run)).find((entry) => !entry.over),
    // The season a league's home shows: the one in progress, or failing that its most recent.
    async currentSeasonSlug(leagueId: string) {
      const entries = await seasonsOf(leagueId);
      return (entries.find((entry) => !entry.over) ?? entries[0])?.slug;
    },
    // Sessions that have run out are of no use to anyone
    pruneSessions: () => query('DELETE FROM sessions WHERE expires<=$1', [Date.now()]),
    listSeasonNames: seasonsOf,
    // `check` runs once the league is locked, for a rule that must hold at the moment of creation.
    insert(s: Season, check?: (tx: Query) => Promise<void>) {
      return transaction(async (tx) => {
        // A season made without a league joins the first one.
        // A season saved without naming a league joins the oldest one
        s.league ??= (await tx('SELECT id FROM leagues ORDER BY position LIMIT 1')).rows[0]?.id;
        need(s.league, 'Create a league before its first season.', 404);
        // Seasons are added to a league one at a time, so two cannot take the same address
        need((await tx('SELECT 1 FROM leagues WHERE id=$1 FOR UPDATE', [s.league])).rowCount, 'League not found.', 404);
        await check?.(tx);
        const taken = new Set((await tx('SELECT slug FROM seasons WHERE league=$1', [s.league])).rows.map((row) => row.slug));
        const slug = availableSlug(s.name, 'season', (value) => reservedSeasonSlugs.includes(value) || taken.has(value));
        assignSeasonUrls(s);
        const { revision: _revision, resourceVersions: _versions, slug: _slug, ...data } = s as StoredSeason;
        await tx('INSERT INTO seasons(id,data) VALUES($1,$2)', [s.id, JSON.stringify({ ...data, slug })]);
        await index(tx, s, new Map(), new Map());
        return slug;
      });
    },
    // The season's row is locked while `fn` changes it, so two changes to one season never interleave.
    // Returning false from `fn` leaves the revision alone unless something a client depends on changed.
    edit(id: string, fn: (s: StoredSeason, tx: Query) => void | boolean | Promise<void | boolean>) {
      return transaction(async (tx) => {
        const row = (await tx('SELECT data, revision FROM seasons WHERE id=$1 FOR UPDATE', [id])).rows[0];
        need(row, 'Season not found.', 404);
        // As stored, to tell afterwards whether anything changed
        const original = JSON.stringify(row.data);
        const s = stored(row);
        const before = resourceState(s),
          originalAttempts = attempts(s),
          originalStats = stats(s);
        const requestedBump = (await fn(s, tx)) !== false;
        assignSeasonUrls(s);
        const changedVersions = updateVersions(before, s);
        const bump = requestedBump || !!changedVersions;
        const { revision, ...data } = s;
        if (bump)
          data.resourceVersions = changedVersions ??
            s.resourceVersions ?? { baseline: revision, changed: {} };
        await index(tx, s, originalAttempts, originalStats);
        // A check that found nothing new, which is most of what the sync does, writes nothing
        const text = JSON.stringify(data);
        if (bump || text !== original) await tx('UPDATE seasons SET data=$1, revision=revision+$2 WHERE id=$3', [text, Number(bump), s.id]);
      });
    },
    // One pilot's line from every match on record, in every league
    async pilotMatches(player: number) {
      const { rows } = await query('SELECT league, season_id, won, playoff, metrics FROM match_stats WHERE player=$1', [player]);
      return rows.map((row) => ({
        league: String(row.league),
        seasonId: String(row.season_id),
        won: !!row.won,
        playoff: !!row.playoff,
        metrics: row.metrics as Record<string, number>,
      }));
    },
    // Each pilot's totals across every match on record, in one league or in all of them
    async pilotTotals(leagueId?: string) {
      const { rows } = await query(
        `SELECT s.player, i.name,
           count(DISTINCT s.season_id) AS seasons,
           count(*) AS played,
           count(*) FILTER (WHERE s.won) AS wins,
           coalesce(sum((s.metrics ->> 'kills')::numeric), 0) AS kills,
           coalesce(sum((s.metrics ->> 'deaths')::numeric), 0) AS deaths
         FROM match_stats s LEFT JOIN identities i ON i.id = s.player
         WHERE $1::text IS NULL OR s.league=$1
         GROUP BY s.player, i.name ORDER BY kills DESC, s.player`,
        [leagueId ?? null],
      );
      return rows.map((row) => ({
        player: Number(row.player),
        name: row.name as string | null,
        seasons: Number(row.seasons),
        played: Number(row.played),
        wins: Number(row.wins),
        kills: Number(row.kills),
        deaths: Number(row.deaths),
      }));
    },
    // A test run removes its own schema when it is done.
    async close({ drop = false } = {}) {
      if (drop && schema) await query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
      await pool.end();
    },
  };
}

export type Store = Awaited<ReturnType<typeof openStore>>;
