import { methodOf } from '@/src/formation';
import Link from 'next/link';
import { loadLeagueHome } from '@/app/data';
import { jsonLd, leagueMetadata } from '@/app/seo';
import { configuration } from '@/src/runtime';
import { CaptainInterest, LeagueRuleRows, MatchRows, Panel, Rankings, SignUp, WaitingPanel, seriesLabel, squad } from '@/components/league';
import { checkInTime, hasConfirmedTime, isUpcoming, MatchCard } from '@/components/match-card';
import { Icon } from '@/components/symbols';
import { SeasonTimeline } from '@/components/season-timeline';

export const generateMetadata = ({ params }: { params: Promise<{ league: string }> }) =>
  leagueMetadata(params, '', ({ league }) => league.name, ({ league, season }) =>
    league.name + (league.tagline ? ', a ' + league.tagline : '') + ' on ' + configuration().name + ', the Subspace league coordinator' +
    (season ? '. ' + season.name + ': schedule, standings, squads, draft and playoffs.' : '.'));
export default async function LeagueHome({ params }: { params: Promise<{ league: string }> }) {
  const { season: s, actor, league, demo } = await loadLeagueHome(params);
  const settings = actor?.admin && <Link href={'/' + league.slug + '/manage'}>League settings</Link>;
  if (!s) return (
    <div className="league-home">
      <header className="page-head"><h1>{league.name}</h1>{league.tagline && <p>{league.tagline}</p>}</header>
      <p>No season has been announced.</p>
      {actor?.operator && <p><Link href={'/' + league.slug + '/seasons/new'}>Start a new season</Link></p>}
      {settings}
    </div>
  );

  const base = s.base;
  const preseason = !s.matches.length && !s.over;
  const enlisted = actor && Object.hasOwn(s.players, actor.id);
  const now = Date.now();
  const upcoming = s.matches.filter(isUpcoming).filter((m) => {
    const attempt = m.attempts.at(-1);
    return m.proposal || !attempt || Date.parse(attempt.startsBy) >= now;
  });
  // Matches with an agreed time lead, soonest first; the rest are still being arranged
  const [next, ...booked] = upcoming.filter(hasConfirmedTime)
    .sort((a, b) => (checkInTime(a) ?? 'z').localeCompare(checkInTime(b) ?? 'z') || a.number - b.number);
  const arranging = upcoming.filter((m) => !hasConfirmedTime(m)).sort((a, b) => a.round - b.round || a.number - b.number);
  const round = (m: (typeof upcoming)[number]) => (m.series ? seriesLabel(m.series, s) + ' · Game ' + m.round : 'Round ' + m.round);
  const registrationOpen = s.canSignUp;

  const banner = preseason || s.over;
  // Mid-season the page is titled with the league's name; a banner carries its own title
  const seasonLine = banner ? (
    <p className="season-line">
      <strong>{league.name}</strong>
      <span><Link href={base}>{s.name}</Link></span>
      {league.tagline && <span>{league.tagline}</span>}
    </p>
  ) : (
    <header className="page-head">
      <h1>{league.name}</h1>
      <p><Link href={base}>{s.name}</Link>{league.tagline && ' · ' + league.tagline}</p>
    </header>
  );
  const signedUp = Object.entries(s.players);
  // The last few results, newest first, to sit beside what is coming
  const ended = (m: (typeof s.matches)[number]) => m.attempts.at(-1)?.endedAt ?? m.result?.recordedAt ?? '';
  const latest = s.matches.filter((m) => m.result).sort((a, b) => ended(b).localeCompare(ended(a)) || b.number - a.number).slice(0, 4);
  return (
    <div className="league-home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd({
          '@context': 'https://schema.org',
          '@type': 'SportsOrganization',
          name: league.name,
          description: league.tagline || undefined,
          sport: 'Subspace',
          url: configuration().origin + '/' + league.slug,
        })}
      />
      {preseason ? (
        <section className="season-entry hero">
          <img src="/images/hero.webp" alt="" fetchPriority="high" />
          {seasonLine}
          <h1>{s.draft ? 'Draft in progress' : enlisted ? 'You’re signed up' : registrationOpen ? 'Season sign-up' : 'Registration closed'}</h1>
          {s.draft ? <Link className="button primary" href={base + '/draft'}>Open draft room</Link>
            : enlisted ? <>
              <CaptainInterest s={s} pilot={actor!.id} />
              <Link className="arrow-link" href={base}>Season overview <Icon name="arrow" /></Link>
            </>
            : registrationOpen ? <>
              <p className="lead">Sign up to play in {s.name}.</p>
              <SignUp s={s} next={'/' + league.slug} signedIn={!!actor} />
            </> : <p className="lead">The match schedule hasn’t been set yet.</p>}
        </section>
      ) : s.champion ? (
        <section className="season-entry hero">
          <img src="/images/hero.webp" alt="" fetchPriority="high" />
          {seasonLine}
          <h1>Season complete</h1>
          <p className="lead">Champion · <Link href={base + '/squads/' + squad(s, s.champion).slug}>{squad(s, s.champion).name}</Link></p>
          <Link className="arrow-link" href={base + '/schedule?view=results'}>Match results <Icon name="arrow" /></Link>
        </section>
      ) : s.closed ? (
        <section className="season-entry hero">
          <img src="/images/hero.webp" alt="" fetchPriority="high" />
          {seasonLine}
          <h1>Season closed</h1>
          <p className="lead">{s.name} ended without a champion.</p>
          <Link className="arrow-link" href={base}>Season review <Icon name="arrow" /></Link>
        </section>
      ) : seasonLine}
      {s.over && (
        <p className="between-seasons">
          The next season has not been announced. <Link href={'/' + league.slug + '/seasons'}>Past seasons</Link>
          {actor?.operator && <> · <Link href={'/' + league.slug + '/seasons/new'}>Start a new season</Link></>}
          {settings && <> · {settings}</>}
        </p>
      )}
      {/* Anything waiting on the person signed in comes before the league's own news */}
      <WaitingPanel s={s} actor={actor} />
      {/* A season that is still taking pilots says so, wherever in the season it is */}
      {!preseason && s.canSignUp && !enlisted && !actor?.operator && (
        <aside className="sign-in-prompt" aria-label="Sign up">
          <div>
            <strong>Sign-ups for {s.name} are still open</strong>
          </div>
          <SignUp s={s} next={'/' + league.slug} signedIn={!!actor} />
        </aside>
      )}
      <SeasonTimeline s={s} />
      {/* Before the schedule exists the page says who is in and what they are signing up for */}
      {preseason && !s.draft && (
        <div className="panel-pair">
          <Panel framed title={<>Signed up<small>{signedUp.length} {signedUp.length === 1 ? 'pilot' : 'pilots'}{s.volunteers?.length ? ', ' + s.volunteers.length + ' willing to captain' : ''}</small></>}>
            {signedUp.length ? (
              <ul className="name-list">
                {signedUp.map(([id, name]) => <li key={id}><Link href={'/' + league.slug + '/pilots/' + id}>{name}</Link></li>)}
              </ul>
            ) : (
              <p className="muted">No one has signed up yet.</p>
            )}
          </Panel>
          <Panel framed title="Format" action={<Link href={base + '/playoffs#rules'}>Season rules <Icon name="arrow" /></Link>}>
            <dl className="facts">
              <div><dt>Match</dt><dd>{s.minPerTeam} v {s.minPerTeam}, squads of at least {s.minPerTeam}</dd></div>
              <div><dt>Squads</dt><dd>{methodOf(s).label}: {methodOf(s).summary.toLowerCase()}</dd></div>
              <div><dt>Season</dt><dd>Every squad plays every other, then the playoffs</dd></div>
              <div><dt>Standings</dt><dd>Win–loss record, then head-to-head, then kill differential</dd></div>
              <div><dt>Playoffs</dt><dd>Top {s.playoffSpots}, {s.format} elimination, best of {s.bestOf}</dd></div>
              <div><dt>Trades</dt><dd>Allowed, one pilot for one pilot, {s.reviewTrades ? 'with an operator’s approval' : 'when both captains agree'}</dd></div>
            </dl>
          </Panel>
        </div>
      )}
      {/* A league's own rules are read before signing up: eligibility above all */}
      {preseason && !s.draft && !!s.rules?.length && (
        <Panel framed title="League rules" action={<Link href={base + '/playoffs#rules'}>All season rules <Icon name="arrow" /></Link>}>
          <dl className="rules"><LeagueRuleRows rules={s.rules} /></dl>
        </Panel>
      )}
      <div className="home-layout">
        {!preseason && !s.over && (
          <section className="home-schedule">
            <header className="home-section-head">
              <h2>Upcoming matches</h2>
              <Link href={base + '/schedule'}>Full schedule <Icon name="arrow" /></Link>
            </header>
            {!upcoming.length && <p className="empty-box">No upcoming matches are scheduled.</p>}
            {next && <MatchCard season={s} match={next} variant="feature" context={'Next match · ' + round(next)} />}
            {booked.length > 0 && <ul className="match-cards">
              {booked.slice(0, 2).map((m) => <li key={m.id}><MatchCard season={s} match={m} context={round(m)} /></li>)}
            </ul>}
            {arranging.length > 0 && <MatchRows s={s} matches={arranging.slice(0, 4)} />}
            {latest.length > 0 && (
              <>
                <header className="home-section-head home-results">
                  <h2>Latest results</h2>
                  <Link href={base + '/schedule?view=results'}>All results <Icon name="arrow" /></Link>
                </header>
                <MatchRows s={s} matches={latest} />
              </>
            )}
          </section>
        )}
        {!preseason && s.squads.length > 0 && (
          <Panel framed title={s.champion ? 'Final standings' : 'Current standings'} action={<Link href={base + '/standings'}>Full standings <Icon name="arrow" /></Link>}>
            <Rankings s={s} compact />
          </Panel>
        )}
      </div>
    </div>
  );
}
