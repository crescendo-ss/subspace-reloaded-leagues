import { phaseLabels } from '@/src/phase';
import { checkInTime, hasConfirmedTime, isUpcoming, MatchCard } from '@/components/match-card';
import { seasonMetadata } from '@/app/seo';
import Link from 'next/link';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { CaptainInterest, Panel, MatchCards, MatchRows, Rankings, SignInPrompt, SignUp, WaitingPanel, squad, matchContext } from '@/components/league';
import { Icon } from '@/components/symbols';

export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, '', ({ season: s }) => (s.over ? 'Season review' : 'Season overview'), ({ season: s }) =>
    s.name + ' in the ' + s.leagueName + ' Subspace league: ' + s.squads.length + ' squads, ' + s.matches.filter((m) => m.result).length + ' of ' + s.matches.length + ' matches played. Latest results, upcoming matches and leading squads.');
export default async function Review(props: LeaguePage) {
  const { season: s, actor, demo } = await loadLeaguePage(props),
    base = s.base;
  const finished = (m: (typeof s.matches)[number]) => m.attempts.at(-1)?.endedAt ?? m.result?.recordedAt ?? '';
  const completed = s.matches.filter((m) => m.result).sort((a, b) => finished(b).localeCompare(finished(a)));
  const upcoming = s.matches
    .filter(isUpcoming)
    .sort((a, b) => (checkInTime(a) ?? 'z').localeCompare(checkInTime(b) ?? 'z'));
  const phase = phaseLabels[s.phase];
  const enlisted = actor && s.players[actor.id];
  const mySquad = actor ? s.squads.find((t) => t.roster.includes(actor.id)) : undefined;

  // A signed-in pilot's own season: where they were drafted, how their squad stands, and their numbers
  const involves = (m: (typeof s.matches)[number]) => !!mySquad && (m.home === mySquad.id || m.away === mySquad.id);
  const pick = actor ? s.picks.findIndex((p) => p.player === actor.id) : -1;
  const turn = pick >= 0 ? s.picks[pick].turn : undefined;
  const rank = mySquad ? s.standings.findIndex((row) => row.id === mySquad.id) : -1;
  const row = rank >= 0 ? s.standings[rank] : undefined;
  const line = actor ? s.performance.players.find((p) => p.id === actor.id) : undefined;
  const kills = line?.metrics.kills,
    deaths = line?.metrics.deaths;
  const mine = upcoming.filter(involves);
  const nextMatch = mine.find(hasConfirmedTime) ?? mine[0];
  const facts: [string, string, string?][] = mySquad && actor
    ? [
        [
          'Draft',
          mySquad.captain === actor.id ? 'Captain' : pick >= 0 ? 'Pick ' + (pick + 1) : 'Assigned',
          mySquad.captain === actor.id
            ? 'Led the squad from the start'
            : turn !== undefined
              ? 'Round ' + (Math.floor(turn / s.squads.length) + 1) + ' of the draft'
              : undefined,
        ],
        ['Salary', Number.isFinite(s.salaries[actor.id]) ? String(s.salaries[actor.id]) : 'Unrated', pick >= 0 && s.picks[pick].price !== undefined ? 'Bought for ' + s.picks[pick].price + ' credits' : undefined],
        [
          'Squad standing',
          row ? ordinal(rank + 1) + ' of ' + s.standings.length : 'Unranked',
          row ? [row.wins, row.losses, row.draws].join('–') + ' · ' + (rank < s.playoffSpots ? 'in a playoff spot' : 'outside the playoff spots') : undefined,
        ],
        [
          'Your stat line',
          line?.played ? (kills ?? 0) + ' kills · ' + (deaths ?? 0) + ' deaths' : 'No matches yet',
          line?.played ? line.played + (line.played === 1 ? ' match' : ' matches') + ' · ' + line.wins + (line.wins === 1 ? ' win' : ' wins') : undefined,
        ],
      ]
    : [];
  return (
    <>
      <header className="page-head">
        <h1>{s.over ? 'Season review' : 'Season overview'}</h1>
        <p>
          {phase} · {s.squads.length} squads · {completed.length} of {s.matches.length} matches played
        </p>
      </header>
      <WaitingPanel s={s} actor={actor} />
      {/* A finished season leads with who won it */}
      {s.champion && (
        <section className="reigning" aria-label="Season champion">
          <p className="eyebrow">Champion · {s.name}</p>
          <h2><Link href={base + '/squads/' + squad(s, s.champion).slug}>{squad(s, s.champion).name}</Link></h2>
          <Link className="arrow-link" href={base + '/playoffs'}>See the bracket <Icon name="arrow" /></Link>
        </section>
      )}
      {mySquad && actor ? (
        <>
          <p className="group-label">Your season</p>
          <Panel
            framed
            title={<>{s.players[actor.id]} · <Link className="plain-link" href={base + '/squads/' + mySquad.slug}>{mySquad.name}</Link></>}
            action={<Link href={base + '/schedule?view=mine'}>Your matches <Icon name="arrow" /></Link>}
          >
            <dl className="fact-row">
              {facts.map(([label, value, note]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                  {note && <dd className="fact-note">{note}</dd>}
                </div>
              ))}
            </dl>
            {nextMatch && (
              <MatchCard
                season={s}
                match={nextMatch}
                variant="feature"
                context={'Your next match · ' + matchContext(nextMatch, s)}
              />
            )}
            {completed.some(involves) && (
              <>
                <h3>Your results</h3>
                <MatchRows s={s} matches={completed.filter(involves)} />
              </>
            )}
          </Panel>
          <p className="group-label">The league</p>
        </>
      ) : enlisted ? (
        <>
          <p className="notice">You are signed up for this season and waiting to be placed on a squad.</p>
          <CaptainInterest s={s} pilot={actor!.id} />
        </>
      ) : s.canSignUp ? (
        <aside className="sign-in-prompt" aria-label="Sign up">
          <div>
            <strong>Sign-ups for {s.name} are open</strong>
          </div>
          <SignUp s={s} next={base} quiet={!!actor?.operator} signedIn={!!actor} />
        </aside>
      ) : null}
      {s.matches.length > 0 && (
        <div className="overview-fixtures">
          {/* A captain has already seen their own squad's matches above */}
          <Panel title="Latest results" action={<Link href={base + '/schedule?view=results'}>All results <Icon name="arrow" /></Link>}>
            <MatchCards s={s} matches={completed.filter((m) => !mySquad || !involves(m)).slice(0, 3)} context={matchContext} empty="No results yet." />
          </Panel>
          {!s.over && (
            <Panel title="Coming up" action={<Link href={base + '/schedule'}>Full schedule <Icon name="arrow" /></Link>}>
              <MatchCards s={s} matches={upcoming.filter((m) => !mySquad || !involves(m)).slice(0, 3)} context={matchContext} empty="No upcoming matches." />
            </Panel>
          )}
        </div>
      )}
      {s.squads.length > 0 && (
        <Panel framed title={s.over ? 'Final standings' : 'Leading squads'} action={<Link href={base + '/standings'}>Full standings <Icon name="arrow" /></Link>}>
          <Rankings s={s} compact limit={s.over ? undefined : 3} />
        </Panel>
      )}
      {/* For a visitor reading history, the invitation to sign in comes after the history */}
      {!actor && !s.enlistedOpen && (
        <SignInPrompt demo={demo} next={base} title="Sign in to see your own season">
          Your draft position, salary, squad standing, next match and stat line.
        </SignInPrompt>
      )}
    </>
  );
}
function ordinal(n: number) {
  const tail = n % 100 > 10 && n % 100 < 14 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return n + tail;
}
