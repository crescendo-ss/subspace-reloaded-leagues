import { checkInTime, hasConfirmedTime, isUpcoming } from '@/components/match-card';
import { seasonMetadata } from '@/app/seo';
import Link from 'next/link';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { MatchCards, MatchRows, matchContext, seriesLabel } from '@/components/league';
import type { MatchView } from '@/src/service';
export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, 'schedule', 'Schedule', ({ season: s }) =>
    'Fixtures and results for ' + s.name + ' in the ' + s.leagueName + ' Subspace league: confirmed check-in times, matches awaiting scheduling and final scores.');
export default async function Schedule(props: LeaguePage) {
  const { season: s, actor } = await loadLeaguePage(props, 'schedule'),
    { view } = await props.searchParams;
  const mine = s.squads.find((t) => actor && t.roster.includes(actor.id));
  const groups = [
    { key: 'upcoming', label: 'To be played', games: s.matches.filter(isUpcoming) },
    { key: 'results', label: 'Results', games: s.matches.filter((m) => m.result) },
    { key: 'all', label: 'All matches', games: s.matches },
  ];
  if (mine)
    groups.push({
      key: 'mine',
      label: 'My matches',
      games: s.matches.filter((m) => m.home === mine.id || m.away === mine.id),
    });
  // With nothing left to play, the page opens on what was played
  const selected = groups.find((group) => group.key === view) ?? (groups[0].games.length || !groups[1].games.length ? groups[0] : groups[1]);
  // To be played: fixtures with a time, soonest first, apart from those the captains are still arranging
  const confirmed = selected.games
    .filter(hasConfirmedTime)
    .sort((a, b) => (checkInTime(a) ?? '').localeCompare(checkInTime(b) ?? '') || a.number - b.number);
  const arranging = selected.games.filter((m) => !hasConfirmedTime(m));
  const rounds = new Map<string, MatchView[]>();
  for (const m of selected.games) {
    const round = m.series ? seriesLabel(m.series, s) : 'Round ' + m.round;
    if (!rounds.has(round)) rounds.set(round, []);
    rounds.get(round)!.push(m);
  }
  // While matches are still to be played, results run from the latest round back. The full list, and the
  // results of a season that is over, run in playing order.
  const sections = selected.key === 'results' && groups[0].games.length ? [...rounds].reverse() : [...rounds];
  const anchor = (round: string) => round.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <>
      <h1>Schedule</h1>
      <nav className="filters" aria-label="Filter schedule">
        {groups.map(({ key, label, games }) => (
          <Link key={key} aria-current={key === selected.key ? 'true' : undefined} href={'?view=' + key}>
            {label} ({games.length})
          </Link>
        ))}
      </nav>
      {selected.key === 'upcoming' && selected.games.length > 0 && (
        <>
          <section className="schedule-round">
            <h3>Confirmed times</h3>
            {confirmed.length ? (
              <MatchCards round s={s} matches={confirmed} context={matchContext} />
            ) : (
              <p className="muted">No match has a confirmed time yet.</p>
            )}
          </section>
          {arranging.length > 0 && (
            <section className="schedule-round">
              <h3>Awaiting scheduling</h3>
              <MatchRows s={s} matches={arranging} />
            </section>
          )}
        </>
      )}
      {!['upcoming'].includes(selected.key) && selected.games.length > 0 && (
        <>
          {sections.length > 3 && (
            <nav className="jump-links" aria-label="Jump to a round">
              {sections.map(([round]) => <a key={round} href={'#' + anchor(round)}>{round.replace('Round ', 'R')}</a>)}
            </nav>
          )}
          {/* Two rounds to a row on a wide screen, in order down the page */}
          <div className="schedule-rounds">
            {sections.map(([round, games]) => (
              <section key={round} className="schedule-round" id={anchor(round)}>
                <h3>{round}</h3>
                <MatchRows s={s} matches={games} context={false} />
              </section>
            ))}
          </div>
        </>
      )}
      {!selected.games.length && (
        <p className="empty-box">
          {selected.key === 'results'
            ? 'No results yet.'
            : selected.key === 'upcoming'
              ? 'No upcoming matches.'
              : selected.key === 'mine'
                ? 'Your squad has no matches yet.'
                : 'The schedule has not been generated yet.'}
        </p>
      )}
    </>
  );
}
