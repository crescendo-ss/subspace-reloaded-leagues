import Link from 'next/link';
import { database } from '@/src/runtime';
import { loadLeague, viewer } from './data';
import { Icon } from '@/components/symbols';
import { SignUp } from '@/components/league';
import { seasonStages } from '@/components/season-timeline';
import { configuration } from '@/src/runtime';
import { jsonLd } from './seo';

export const metadata = { alternates: { canonical: '/' } };

// The site's front page: every league it hosts, and where each one's season stands.
export default async function Leagues() {
  const actor = await viewer();
  const site = configuration();
  const leagues = await Promise.all(
    (await (await database()).leagues()).map(async (league) => ({
      league,
      season: (await loadLeague(undefined, league.slug)).season,
    })),
  );
  return (
    <div className="season-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: site.name,
          alternateName: site.tagline,
          description: site.description,
          url: site.origin + '/',
        })}
      />
      <h1>Subspace Reloaded Leagues</h1>
      <p className="front-lead">
        Pick a league to follow its schedule, standings, statistics and playoffs. Sign in with your Subspace
        Reloaded account to sign up for a season.
      </p>
      {leagues.length ? <div className="season-directory">
        {leagues.map(({ league, season }, i) => {
          const stages = season ? seasonStages(season) : [];
          const stage = stages.find((x) => x.state === 'current') ?? stages.at(-1);
          const home = '/' + league.slug;
          return (
            <article className="season-card" key={league.id}>
              <img src={i % 2 ? '/images/season.webp' : '/images/hero.webp'} alt="" loading="lazy" />
              <div className="season-card-body">
                <p className="eyebrow">{league.tagline || 'League'}</p>
                <h2><Link href={home}>{league.name}<Icon name="arrow" /></Link></h2>
                {season && stage ? (
                  <p className="season-progress">
                    {season.name} · {season.champion ? 'Champion: ' + stage.detail : season.closed ? 'Closed' : stage.label + ', ' + stage.detail.split(' · ')[0].toLowerCase()}
                  </p>
                ) : (
                  <p className="season-progress">No season announced yet</p>
                )}
                {/* While a season is taking sign-ups, that is the card's action: one press, here */}
                {season?.canSignUp && (
                  actor && Object.hasOwn(season.players, actor.id)
                    ? !season.matches.length && <p className="season-progress">You’re signed up. <Link href={home}>See who else is in</Link></p>
                    // The page's own lead says signing in comes first; a season under way offers sign-up quietly
                    : <SignUp s={season} next={home} signedIn={!!actor} note={false} quiet={season.matches.length > 0} />
                )}
                <nav aria-label={league.name}>
                  {season && season.matches.length > 0 && <Link href={season.base + '/schedule'}>Schedule</Link>}
                  {season && season.squads.length > 0 && <Link href={season.base + '/standings'}>Standings</Link>}
                  {season?.champion && <Link href={home + '/champions'}>Champions</Link>}
                </nav>
              </div>
            </article>
          );
        })}
      </div> : <p className="empty-box">No leagues yet.</p>}
      {actor?.admin && <p className="directory-foot"><Link className="button" href="/leagues/new">Create a league</Link></p>}
    </div>
  );
}
