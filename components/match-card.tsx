import { isActive } from '@/src/attempts';
import Link from 'next/link';
import type { MatchView } from '@/src/service';
import { CheckInCountdown, LocalTime } from './interactive';
import { Icon } from './symbols';

type Side = { id: string; name: string };
export type CardMatch = Pick<MatchView, 'number' | 'home' | 'away' | 'series' | 'round' | 'result' | 'attempts' | 'proposal' | 'score' | 'forfeit'>;
type SeasonRecord = { id: string; wins: number; draws: number; losses: number };
type CardSeason = { base: string; squads: Side[]; standings?: SeasonRecord[] };

export function isUpcoming(match: MatchView) {
  if (match.result) return false;
  const attempt = match.attempts.at(-1);
  if (!attempt || match.proposal) return true;
  return !attempt.needsReview && ['queued', 'booked', 'open', 'starting'].includes(attempt.state);
}

// Where a match stands, as a key. The words shown for it and how it is toned hang off the key, so a label
// can be reworded without changing what the pages do.
const statuses = {
  final: { label: 'Final score', tone: 'final' },
  forfeit: { label: 'Forfeit', tone: 'final' },
  upcoming: { label: 'To be played', tone: undefined },
  starting: { label: 'Starting', tone: undefined },
  open: { label: 'Check-in open', tone: 'live' },
  live: { label: 'In play', tone: 'live' },
  review: { label: 'Needs ruling', tone: 'alert' },
  abandoned: { label: 'Abandoned', tone: 'alert' },
  cancelled: { label: 'Cancelled', tone: 'alert' },
  no_show: { label: 'No-show', tone: 'alert' },
  refused: { label: 'Booking refused', tone: 'alert' },
} as const;
type StatusKey = keyof typeof statuses;
// What the zone calls a booking's state, as where the match stands
const zoneStatus: Record<string, StatusKey> = {
  queued: 'upcoming', booked: 'upcoming', starting: 'starting', open: 'open', live: 'live',
  cancelled: 'cancelled', no_show: 'no_show', refused: 'refused',
  // Played, and still without a result: the zone's report could not be read on its own
  complete: 'review',
};
function statusKey(m: CardMatch): StatusKey | null {
  const a = m.attempts.at(-1);
  if (m.result) return m.forfeit ? 'forfeit' : 'final';
  if (a?.needsReview) return 'review';
  if (m.proposal || !a) return 'upcoming';
  if (a.resolution === 'abandoned') return 'abandoned';
  if (a.resolution === 'cancelled') return 'cancelled';
  return zoneStatus[a.state] ?? null;
}
export function matchStatus(m: CardMatch): { key: StatusKey | 'unknown'; label: string; tone?: 'live' | 'final' | 'alert' } {
  const key = statusKey(m);
  // A state the zone has added since: shown as the zone names it, and flagged
  return key ? { key, ...statuses[key] } : { key: 'unknown', label: m.attempts.at(-1)!.state, tone: 'alert' };
}
// A fixture both captains have agreed and the zone has booked, as opposed to one still being arranged
export function hasConfirmedTime(m: CardMatch) {
  const attempt = m.attempts.at(-1);
  return !m.result && !m.proposal && isActive(attempt);
}
export function checkInTime(m: CardMatch) {
  if (m.proposal) return m.proposal.opensAt;
  const attempt = m.attempts.at(-1);
  if (isActive(attempt))
    return attempt.opensAt;
}
function Competitor({ squads, id, winner, score, record, forfeited }: { squads: Side[]; id: string; winner?: string | null; score?: number; record?: SeasonRecord; forfeited?: boolean }) {
  const squad = squads.find((side) => side.id === id)!;
  const outcome = winner === undefined ? null : winner === null ? 'draw' : winner === id ? 'win' : 'loss';
  return (
    <span className={'competitor' + (outcome === 'win' ? ' won' : outcome === 'loss' ? ' lost' : '')}>
      {outcome && <span className={'outcome ' + outcome}>{outcome}</span>}
      <span className="result-name">{squad.name}</span>
      {forfeited && <span className="match-state" data-tone="alert">Forfeited</span>}
      {winner === undefined && record && <span className="team-record" aria-label={record.wins + ' wins, ' + record.draws + ' draws, ' + record.losses + ' losses'}>
        ({[record.wins, record.losses, ...(record.draws > 0 ? [record.draws] : [])].join('–')})
      </span>}
      {score !== undefined && <strong className="squad-score" aria-label={squad.name + ' score ' + score}>{score}</strong>}
    </span>
  );
}

export function Faceoff({ squads, home, away, winner, score, standings, forfeit }: {
  squads: Side[]; home: string; away: string; winner?: string | null; score?: [number, number] | null; standings?: SeasonRecord[];
  // The squad that forfeited, named on its own line
  forfeit?: string | null;
}) {
  return (
    <span className={score ? 'faceoff scored' : 'faceoff'}>
      <Competitor squads={squads} id={home} winner={winner} score={score?.[0]} record={standings?.find((s) => s.id === home)} forfeited={forfeit === home} />
      <span className="versus">{score ? '–' : 'vs'}</span>
      <Competitor squads={squads} id={away} winner={winner} score={score?.[1]} record={standings?.find((s) => s.id === away)} forfeited={forfeit === away} />
    </span>
  );
}

// `feature` is the one fixture a page leads with: the two squads and the local check-in time side by side.
export function MatchCard({ season, match, variant = 'scoreboard', context }: {
  season: CardSeason;
  match: CardMatch;
  variant?: 'detail' | 'scoreboard' | 'feature';
  context?: string;
}) {
  const when = checkInTime(match);
  const state = matchStatus(match);
  const attempt = match.attempts.at(-1);
  const ended = attempt?.endedAt ?? (match.result?.source === 'example' ? match.result.recordedAt : undefined);
  const seconds = ended && attempt?.startedAt ? Math.round((Date.parse(ended) - Date.parse(attempt.startedAt)) / 1000) : null;
  // The countdown belongs wherever one fixture is the subject: the featured card, and the match's own page
  const feature = variant !== 'scoreboard' && !match.result && !!when;
  const faceoff = (
    <Faceoff squads={season.squads} home={match.home} away={match.away} winner={match.result?.winner} score={match.score} standings={season.standings} forfeit={match.forfeit} />
  );
  const contents = (
    <>
      <span className="card-meta">
        <span>{context ?? (match.series ? 'Game ' + match.round : 'Match ' + match.number)}</span>
        {(!match.result || variant === 'detail') && <span className="match-state" data-state={state.key} data-tone={state.tone}>{state.label}</span>}
      </span>
      {feature ? (
        <span className="feature-body">
          {faceoff}
          <CheckInCountdown iso={when!} proposed={!!match.proposal} />
        </span>
      ) : faceoff}
      <span className="match-footer">
        {feature && variant !== 'detail' && <span className="card-time">Match details</span>}
        {variant !== 'detail' && !feature && !match.result && when && (
          <span className="card-time"><Icon name="calendar" />
            <span><small>{match.proposal ? 'Proposed check-in' : 'Check-in'}</small><LocalTime iso={when} /></span>
          </span>
        )}
        {!match.result && !when && state.key === 'upcoming' && variant !== 'detail' && (
          <span className="card-time">Awaiting scheduling</span>
        )}
        {match.result && !match.score && <span className="card-time">{match.forfeit ? 'No game played' : 'Score unavailable'}</span>}
        {match.result && (
          <span className="card-time final-time">
            <span>{variant === 'detail' ? (ended ? 'Completed ' : 'Result recorded ') : ''}<LocalTime iso={ended ?? match.result.recordedAt} dateOnly /></span>
            {variant === 'detail' && seconds !== null && seconds >= 0 && <span>· Duration {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
          </span>
        )}
        {variant !== 'detail' && <span className="card-arrow" aria-hidden="true"><Icon name="arrow" /></span>}
      </span>
    </>
  );
  const className = 'match-card card-' + (variant === 'detail' ? 'detail' + (feature ? ' card-feature' : '') : feature ? 'feature' : 'scoreboard');
  return variant === 'detail' ? <div className={className}>{contents}</div> : (
    <Link className={className} href={season.base + '/matches/' + match.number}>
      {contents}
    </Link>
  );
}

// A fixture still being arranged, as one quiet line: it should not compete with matches that have a time.
export function MatchRow({ season, match, context }: { season: CardSeason; match: CardMatch; context: string }) {
  const name = (id: string) => season.squads.find((side) => side.id === id)!.name;
  const state = matchStatus(match),
    when = checkInTime(match);
  return (
    <Link className="match-row" href={season.base + '/matches/' + match.number}>
      <span className="match-row-context">{context}</span>
      <span className="match-row-names">{name(match.home)} <span>vs</span> {name(match.away)}</span>
      {/* What stands between this match and being played: a state worth naming, its time, or no time yet */}
      <span className="match-row-time">
        {state.key !== 'upcoming' && <span className="match-state" data-tone={state.tone}>{state.label}</span>}
        {match.proposal ? <>Proposed <LocalTime iso={match.proposal.opensAt} /></> : when ? <LocalTime iso={when} /> : state.key === 'upcoming' ? 'Awaiting scheduling' : null}
      </span>
      <span className="card-arrow" aria-hidden="true"><Icon name="arrow" /></span>
    </Link>
  );
}

// A match as a row of a list, laid out as a scoreboard: the two squads one above the other at the left edge,
// their scores in a column beside them, then a fixed column for the date or time. Every row has the same
// columns whether the match is played or not, so a list lines up whatever its rows hold, at any width.
export function ResultRow({ season, match, context, game }: {
  season: CardSeason;
  match: CardMatch;
  // A leading label, for a list whose rows are not all from one round
  context?: string;
  // Name the game of a playoff series above the date
  game?: boolean;
}) {
  const name = (id: string) => season.squads.find((side) => side.id === id)!.name;
  const winner = match.result?.winner;
  const attempt = match.attempts.at(-1);
  const state = matchStatus(match),
    when = checkInTime(match);
  const side = (id: string, i: number) => {
    const outcome = !match.result ? undefined : winner === id ? 'won' : winner ? 'lost' : 'drew';
    return (
      <span className={'result-side' + (outcome ? ' ' + outcome : '')}>
        <span className="result-squad">
          <span>{name(id)}</span>
          {match.forfeit === id && <span className="match-state" data-tone="alert">Forfeited</span>}
        </span>
        {/* Without a score the row still says who won */}
        {match.result && (match.score
          ? <b aria-label={name(id) + ' score ' + match.score[i]}>{match.score[i]}</b>
          : <b className="result-letter">{outcome === 'won' ? 'Won' : outcome === 'lost' ? 'Lost' : 'Draw'}</b>)}
      </span>
    );
  };
  return (
    <Link className={'match-row result-row' + (context ? ' with-context' : '')} href={season.base + '/matches/' + match.number}>
      {context && <span className="match-row-context">{context}</span>}
      <span className="result-sides">
        {side(match.home, 0)}
        {side(match.away, 1)}
      </span>
      <span className="match-row-time">
        {game && match.series && <span>Game {match.round}</span>}
        {match.result ? (
          <LocalTime iso={attempt?.endedAt ?? match.result.recordedAt} dateOnly />
        ) : (
          <>
            {state.key !== 'upcoming' && <span className="match-state" data-tone={state.tone}>{state.label}</span>}
            {match.proposal ? <><span className="match-state">Proposed</span><LocalTime iso={match.proposal.opensAt} /></> : when ? <LocalTime iso={when} /> : state.key === 'upcoming' ? 'Awaiting scheduling' : null}
          </>
        )}
      </span>
      <span className="card-arrow" aria-hidden="true"><Icon name="arrow" /></span>
    </Link>
  );
}
