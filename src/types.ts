import type { Draft, DraftRules, Pick as DraftPick } from './draft.ts';
export interface Identity {
  id: number;
  name: string;
}
// `operator` is the right to manage whatever is being looked at: a site admin anywhere, or a league's own
// operator within that league. `admin` marks the site admins, who also create leagues and name their operators.
export interface Actor extends Identity {
  operator: boolean;
  admin?: boolean;
}
// A competition run on the site. It has one active season at a time and keeps its finished ones as history.
export interface League {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  operators: number[];
}
export interface Squad {
  id: string;
  slug?: string;
  name: string;
  roster: number[];
  captain: number;
}
export interface RosterSlot {
  id: number;
  squad: string;
}
export interface PlayerStats extends RosterSlot {
  metrics: Record<string, number>;
}
export interface MetricRuling extends RosterSlot {
  by: number;
  at: string;
  metric: string;
  value: number;
  reason: string;
}
export interface Window {
  opensAt: string;
  startsBy: string;
}
export interface BookingTeam {
  name: string;
  captainProfileId: number;
  roster: { profileId: number }[];
}
export interface Booking extends Window {
  externalId: string;
  teams: BookingTeam[];
  gameType?: string;
  minPerTeam?: number;
}
export interface ZoneResult {
  draw: boolean;
  rankedTeams: string[][];
  perPlayer: Record<string, Record<string, number>>;
  schemaVersion?: number;
  outcome?: string;
}
export interface Fixture extends Window {
  externalId: string;
  fixtureId: string;
  matchId: string;
  state: string;
  resolution?: string | null;
  result?: ZoneResult | null;
  teams: { name: string; players: { profileId: number; name: string | null }[] }[];
  matchUrl?: string | null;
  replayUrl?: string | null;
}
export interface FixtureEvent {
  event?: string;
  deliveryId: string;
  occurredAt: string;
  fixture: Fixture;
  result?: ZoneResult | null;
}
export interface Attempt {
  externalId: string;
  state: string;
  booking: Booking;
  desiredTeams: BookingTeam[];
  sentTeams?: BookingTeam[];
  resolution?: string | null;
  fixtureId?: string;
  matchId?: string;
  matchUrl?: string | null;
  replayUrl?: string | null;
  opensAt?: string;
  startsBy?: string;
  windowJob?: Window | null;
  windowError?: string | null;
  rosterError?: string | null;
  syncRequested?: boolean;
  error?: string | null;
  polled?: number;
  after?: number;
  // Calls to the zone that have failed in a row, which sets how long to wait before the next
  failures?: number;
  snapshot?: Fixture;
  rawResult?: ZoneResult;
  needsReview?: boolean;
  mappedPlayers?: PlayerStats[];
  eventAt?: string;
  startedAt?: string;
  endedAt?: string;
}
export interface Match {
  id: string;
  number?: number;
  home: string;
  away: string;
  round: number;
  series: string | null;
  attempts: Attempt[];
  proposal: (Window & { id: string; by: string; attempt: string | null; state: string | null }) | null;
  // `score` is set only by ruling or import, as [home, away]; otherwise the score is worked out from the scoreboard
  // `forfeit` says the losing squad gave the match up. An operator's ruling always says one way or the other;
  // the zone's own results leave it out and its report is read instead (src/match-score.ts).
  result: { winner: string | null; source: string; players: PlayerStats[]; recordedAt: string; score?: [number, number]; forfeit?: boolean } | null;
  rulings: { by: number; at: string; winner: string | null; reason: string; score?: [number, number]; forfeit?: boolean }[];
  statRulings?: MetricRuling[];
  rulingRoster?: RosterSlot[];
}
export type BracketRef = { seed: string | null } | { node: string; take: 'winner' | 'loser' };
export interface Series {
  id: string;
  stage: string;
  round: number;
  sources: BracketRef[];
  sides?: (string | null)[];
  winner?: string | null;
  score?: number[];
  skipped?: boolean;
}
export interface Trade {
  id: string;
  squads: string[];
  players: number[];
  state: 'offered' | 'review' | 'completed' | 'declined';
}
export interface Season {
  id: string;
  // The league this season belongs to. Storage fills it in for a season created without one.
  league?: string;
  // Ended by an operator without a champion. A closed season is read-only history.
  closed?: boolean;
  lastMatchNumber?: number;
  name: string;
  gameType: string;
  format: 'single' | 'double';
  bestOf: number;
  minPerTeam: number;
  reviewTrades: boolean;
  enlistedOpen: boolean;
  players: Record<number, string>;
  // When each pilot signed up, for pilots who joined after this was recorded
  signups?: Record<number, string>;
  // Pilots who said, when signing up or since, that they are willing to captain a squad
  volunteers?: number[];
  // Rules the league's operators wrote for this season, shown with the rules the site applies. The site
  // does not enforce them. The body is Markdown.
  rules?: LeagueRule[];
  squads: Squad[];
  matches: Match[];
  trades: Trade[];
  bracket: Series[];
  champion: string | null;
  draft: Draft | null;
  salaries: Record<number, number>;
  picks: DraftPick[];
  draftFinished?: boolean;
  // A draft that has ended, kept so an operator can reopen it or take back its last pick
  lastDraft?: Draft | null;
  // How this season's squads are formed, and the rules its draft runs under
  formation: Formation;
  playoffSpots: number;
}
export interface ResourceVersions {
  baseline: number;
  changed: Record<string, number>;
}
export type StoredSeason = Season & { slug: string; revision: number; resourceVersions?: ResourceVersions };
export interface ZoneBody {
  teams?: BookingTeam[];
  opensAt?: string;
  startsBy?: string;
  callback?: string;
}
export type ZoneClient = (
  method: string,
  path: string,
  body: ZoneBody | undefined,
  attempt: Attempt,
  season: Season,
) => Promise<Fixture | undefined> | Fixture;
export type LeagueRule = { id: string; title: string; body: string };
// `method` is a key of the formation methods (src/formation.ts). The rest are the draft's rules, plus the
// credits each squad starts an auction with.
export type Formation = DraftRules & { method: string; credits?: number };
