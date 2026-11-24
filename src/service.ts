import { randomUUID } from 'node:crypto';
import { forfeitedBy, matchScore } from './match-score.ts';
import { checkRevision } from './revisions.ts';
import { configuration, database } from './runtime.ts';
import { apply, need, resultRoster, season } from './league.ts';
import { standings, performance } from './competition.ts';
import { demoClient, demoStats } from './demo.ts';
import { receive } from './reloaded.ts';
import { formations, methods } from './formation.ts';
import type { StoredSeason, Actor, League, Match, Squad } from './types.ts';
import { inLeague, lookupActor } from './auth.ts';
import { canSignUp, seasonPhase } from './phase.ts';
// What is published about a season, a squad and a match, by name. A page, the JSON API and anyone who asks
// see these and nothing else, so a field added to what is stored stays private until it is listed here.
// What is listed is published whole: a draft, a trade, a result and a ruling have no private parts.
const seasonFields = [
  'id', 'league', 'slug', 'revision', 'name', 'closed', 'gameType', 'format', 'bestOf', 'minPerTeam', 'playoffSpots',
  'reviewTrades', 'enlistedOpen', 'players', 'signups', 'volunteers', 'salaries', 'rules', 'formation', 'draft',
  'draftFinished', 'picks', 'trades', 'bracket', 'champion',
] as const satisfies readonly (keyof StoredSeason)[];
const squadFields = ['id', 'name', 'roster', 'captain'] as const satisfies readonly (keyof Squad)[];
const matchFields = ['id', 'home', 'away', 'round', 'series', 'proposal', 'result', 'rulings', 'statRulings'] as const satisfies readonly (keyof Match)[];
function only<T extends object, K extends keyof T>(source: T, fields: readonly K[]) {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])) as Pick<T, K>;
}
export function publicSeason(s: StoredSeason, league: League) {
  return {
    ...only(s, seasonFields),
    // Where the season's pages live, and whether it is still being played
    base: '/' + league.slug + '/' + s.slug,
    leagueSlug: league.slug,
    leagueName: league.name,
    over: !!s.champion || !!s.closed,
    // Where the season stands, worked out once for every page: see src/phase.ts
    phase: seasonPhase(s),
    canSignUp: canSignUp(s),
    // A finished draft can be reopened while the one it ended is still on record
    draftReopenable: !!s.lastDraft,
    // Signing in is Reloaded's single sign-on; the local demo has its own account picker instead
    accountPath: (configuration().demo ? '/account' : '/auth/login') + '?next=' + encodeURIComponent('/' + league.slug + '/' + s.slug),
    squads: s.squads.map((t) => ({ ...only(t, squadFields), slug: t.slug! })),
    standings: standings(s),
    performance: performance(s),
    matches: s.matches.map((m) => ({
      ...only(m, matchFields),
      number: m.number!,
      score: matchScore(m, s.gameType),
      // The squad that forfeited, if the match was given up rather than played out
      forfeit: forfeitedBy(m),
      resultRoster: m.result ? resultRoster(s, m) : [],
      attempts: m.attempts.map((a) => ({
        externalId: a.externalId,
        fixtureId: a.fixtureId,
        matchId: a.matchId,
        matchUrl: a.matchUrl,
        replayUrl: a.replayUrl,
        state: a.state,
        resolution: a.resolution,
        opensAt: a.opensAt ?? a.booking.opensAt,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        startsBy: a.startsBy ?? a.booking.startsBy,
        needsReview: a.needsReview,
        error: a.error ?? a.rosterError ?? a.windowError,
        pendingWindow: a.windowJob,
        reportedResult: a.rawResult,
      })),
    })),
  };
}

// Everything a page needs: the league in view, its seasons, and one season in full. A season can be named
// by ID or address; without one, the league's current season is used. Without a league either, the first.
export async function leagueData(actor: Actor | null, season?: string | null, leagueKey?: string | null) {
  const store = await database(),
    config = configuration();
  const leagues = await store.leagues();
  const named = season ? await store.read(season, leagueKey ? (await store.league(leagueKey)).id : undefined) : null;
  const league = named ? await store.league(named.league!) : leagueKey ? await store.league(leagueKey) : leagues[0];
  // One listing serves both the league's season in view and its list of seasons
  const seasons = league ? await store.listSeasonNames(league.id) : [];
  const current = (seasons.find((entry) => !entry.over) ?? seasons[0])?.slug;
  const selected = named ?? (league && current ? await store.read(current, league.id) : null);
  return {
    name: config.name,
    demo: config.demo,
    actor: league ? inLeague(actor, league) : actor,
    league: league ?? null,
    leagues,
    seasons,
    season: selected && league ? publicSeason(selected, league) : null,
    methods: [...formations].map(([id, { label }]) => ({ id, label })),
    formationMethods: Object.entries(methods).map(([id, method]) => ({ id, ...method })),
    identities: config.demo
      ? (await store.query('SELECT * FROM identities ORDER BY id')).rows.map((row) => ({ id: Number(row.id), name: String(row.name) }))
      : [],
  };
}
// A league runs one season at a time: the next can start once the current one has a champion or is closed.
export async function newSeason(actor: Actor | null, input: Record<string, unknown>) {
  const store = await database();
  const league = typeof input.league === 'string' && input.league ? await store.league(input.league) : (await store.leagues())[0];
  need(league && inLeague(actor, league)?.operator, 'League operator access required.', 403);
  const s = season(input);
  s.league = league.id;
  // A league's own rules carry into its next season, where they can be changed without touching the last
  const last = (await store.listSeasonNames(league.id))[0];
  const earlier = last && (await store.read(last.id));
  if (earlier?.rules?.length) s.rules = earlier.rules.map((rule) => ({ ...rule, id: randomUUID() }));
  // So does how it forms its squads, unless this season was started with a method of its own
  if (earlier) s.formation = { ...earlier.formation, ...(typeof input.method === 'string' && Object.hasOwn(methods, input.method) && { method: input.method }) };
  // Checked with the league locked, so two operators cannot each start a season at the same moment
  const slug = await store.insert(s, async (tx) => {
    const active = await store.activeSeason(league.id, tx);
    need(!active, active?.name + ' is still in progress. Finish or close it before starting another season.', 409);
  });
  return { id: s.id, slug, league: league.slug, path: '/' + league.slug + '/' + slug };
}
const leagueName = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  need(text.length > 0 && text.length <= 60, 'Give the league a name of up to 60 characters.');
  return text;
};
const tagline = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  need(text.length <= 120, 'Keep the description to 120 characters.');
  return text;
};
export async function newLeague(actor: Actor | null, input: Record<string, unknown>) {
  need(actor?.admin, 'Site admin access required.', 403);
  const league = await (await database()).insertLeague(leagueName(input.name), tagline(input.tagline));
  return { id: league.id, slug: league.slug, path: '/' + league.slug };
}
// Site admins rename a league and describe it.
export async function updateLeague(actor: Actor | null, id: string, input: Record<string, unknown>) {
  need(actor?.admin, 'Site admin access required.', 403);
  return (await database()).editLeague(id, (league) => {
    league.name = leagueName(input.name);
    league.tagline = tagline(input.tagline);
  });
}
// A league's operators and the site admins can delete it, with every season in it. Typing the league's name
// is the confirmation, so it cannot happen by a stray press.
export async function deleteLeague(actor: Actor | null, id: string, confirmation: unknown) {
  const store = await database();
  const league = await store.league(id);
  need(inLeague(actor, league)?.operator, 'League operator access required.', 403);
  need(
    typeof confirmation === 'string' && confirmation.trim().toLowerCase() === league.name.trim().toLowerCase(),
    'Type the league’s name, ' + league.name + ', to confirm.',
  );
  const seasons = await store.deleteLeague(league.id);
  return { deleted: league.id, seasons, path: '/' };
}
// Site admins also name a league's operators. An operator is a Reloaded profile: usually picked from the
// pilots who have signed in here, or given by profile ID for someone who has not yet.
export async function setOperator(actor: Actor | null, id: string, profile: unknown, operator: boolean) {
  need(actor?.admin, 'Site admin access required.', 403);
  const pilot = Number(profile);
  need(Number.isSafeInteger(pilot) && pilot > 0, 'Choose a pilot, or enter a numeric Reloaded profile ID.');
  return (await database()).editLeague(id, (league) => {
    need(!operator || !league.operators.includes(pilot), 'That pilot is already an operator of this league.');
    league.operators = league.operators.filter((x) => x !== pilot);
    if (operator) league.operators.push(pilot);
  });
}
export async function execute(
  actor: Actor | null,
  id: string,
  revision: number,
  command: string,
  params: Record<string, string>,
) {
  need(actor, 'Sign in to continue.', 401);
  const store = await database();
  // Permissions are those the person holds in this season's league
  const league = await store.league((await store.read(id)).league!);
  actor = inLeague(actor, league);
  await store.edit(id, async (s) => {
    // Closing ends a season without a champion and makes it read-only history. It can be reopened while
    // the league has not started another.
    if (command === 'closeSeason' || command === 'reopenSeason') {
      need(actor?.operator, 'League operator access required.', 403);
      if (command === 'closeSeason') {
        need(!s.champion && !s.closed, 'This season is already over.', 409);
        need(!s.draft, 'Finish the live draft before closing the season.', 409);
        s.closed = true;
      } else {
        need(s.closed, 'This season is not closed.', 409);
        const other = await store.activeSeason(league.id);
        need(!other, other?.name + ' is in progress. A league runs one season at a time.', 409);
        s.closed = false;
      }
      return;
    }
    need(!s.closed, 'This season is closed.', 409);
    checkRevision(s, actor, revision, command, params);
    if (command === 'demoOutcome') {
      need(configuration().demo && actor?.operator, 'Demo operator required.', 403);
      const m = s.matches.find((m) => m.id === params.match),
        a = m?.attempts.at(-1);
      need(m && a && ['booked', 'open', 'live'].includes(a.state), 'Choose a booked demo fixture.');
      const f = demoClient('GET', '', undefined, a, s);
      need(['home', 'away', 'no_show', 'cancelled'].includes(params.outcome), 'Unknown outcome.');
      if (['home', 'away'].includes(params.outcome)) {
        const teams = f.teams.map((t) => t.players.map((p) => p.name!));
        f.state = 'complete';
        f.resolution = 'completed';
        f.result = {
          schemaVersion: 1,
          outcome: 'elimination',
          draw: false,
          rankedTeams: params.outcome === 'home' ? teams : teams.reverse(),
          perPlayer: Object.fromEntries(f.teams.flatMap((t, i) => t.players.map((p, j) => [
            p.name!, demoStats((params.outcome === 'home') === (i === 0), 8, j, t.players.length),
          ]))),
        };
      } else {
        f.state = params.outcome;
        f.resolution = f.state === 'no_show' ? 'startsBy' : 'withdrawn';
      }
      receive(s, m, a, f);
    } else apply(s, actor, command, params);
  });
}
export type LeagueData = Awaited<ReturnType<typeof leagueData>>;
export type SeasonView = ReturnType<typeof publicSeason>;
export type MatchView = SeasonView['matches'][number];

// Signing up asks nothing of the page it was pressed on, so it is applied to the season as it stands
// and not to the copy the pilot was looking at.
export async function signUp(actor: Actor | null, id: string, captain: boolean) {
  need(actor, 'Sign in to continue.', 401);
  const store = await database();
  for (let attempt = 0; ; attempt++) {
    try {
      return await execute(actor, id, (await store.read(id)).revision, 'enlist', { captain: captain ? 'yes' : 'no' });
    } catch (error) {
      // Someone else changed the season in the same moment: once more against the newer copy
      if (attempt || !(error instanceof Error && 'status' in error && error.status === 409)) throw error;
    }
  }
}
// A visitor who presses "Sign up" before signing in is sent to sign in, and the season and their answer
// about captaining wait in a cookie. Once they are back the sign-up is finished for them. If something
// stops it (sign-ups closed meanwhile), the page they land on says where things stand.
export const signUpIntent = (id: string, captain: boolean) => id + '.' + (captain ? 'yes' : 'no');
export async function finishSignUp(sessionKey: string, intent: string | undefined) {
  const [, id, captain] = intent?.match(/^([A-Za-z0-9-]{1,64})\.(yes|no)$/) ?? [];
  if (!id) return;
  try {
    await signUp(await lookupActor(sessionKey), id, captain === 'yes');
  } catch (error) {
    if (!(error instanceof Error && 'status' in error)) throw error;
  }
}
