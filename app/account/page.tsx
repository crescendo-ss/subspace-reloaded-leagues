import Link from 'next/link';
import { noIndex } from '@/app/seo';
import { loadLeague } from '@/app/data';
import { database } from '@/src/runtime';
import { Icon } from '@/components/symbols';
import { Select } from '@/components/league';
import { CommandForm } from '@/components/interactive';
export const metadata = { title: 'Account', ...noIndex };
export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; season?: string; auth?: string; next?: string }>;
}) {
  const { league, season, auth, next } = await searchParams,
    data = await loadLeague(season, league);
  // Where the signed-in pilot stands in each league's current season
  const store = data.actor ? await database() : null;
  const standing = store && data.actor
    ? (await Promise.all((await store.leagues()).map(async (l) => {
        const slug = await store.currentSeasonSlug(l.id);
        const s = slug ? await store.read(slug, l.id) : null;
        if (!s || !Object.hasOwn(s.players, data.actor!.id)) return null;
        const mine = s.squads.find((t) => t.roster.includes(data.actor!.id));
        return { league: l, season: s.name, squad: mine?.name, captain: mine?.captain === data.actor!.id };
      }))).filter((row) => row !== null)
    : [];
  // Where the visitor came from, to go back to after signing in or out
  const returning = next && /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(next) ? next : undefined;
  const back = returning ?? (season && data.season ? data.season.base : league && data.league ? '/' + data.league.slug : '/');
  const from = returning ? 'where you were' : season && data.season ? data.season.name : league && data.league ? data.league.name : undefined;
  const query = new URLSearchParams(returning ? { next: returning } : { ...(league && data.league ? { league: data.league.slug } : {}), ...(season && data.season ? { season: data.season.slug } : {}) });
  return (
    <div className="form-page">
      {from && <Link className="back-link" href={back}>Back to {from}</Link>}
      <h1>{data.actor ? 'Your account' : 'Sign in'}</h1>
      {auth === 'declined' && <p role="status">Sign-in was declined.</p>}
      {data.actor && (
        <>
          <p>
            Signed in as <strong>{data.actor.name}</strong>
            {data.demo ? ' · demo profile ' : ' through your Subspace Reloaded account · profile '}
            {data.actor.id}
          </p>
          <CommandForm command="logout" label="Sign out" fields={{ next: back }} />
          <section className="panel framed">
            <div className="panel-head"><h2>Your leagues</h2></div>
            <div className="panel-body">
              {standing.length ? (
                <ul className="link-rows">
                  {standing.map((row) => (
                    <li key={row.league.id}>
                      <span>
                        <strong>{row.league.name}</strong>
                        <small>{row.season} · {row.squad ? (row.captain ? 'Captain of ' : '') + row.squad : 'Signed up, not on a squad yet'}</small>
                      </span>
                      <Link className="arrow-link" href={'/' + row.league.slug + '/pilots/' + data.actor!.id}>Your record <Icon name="arrow" /></Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">You have not signed up for a season yet. A league’s home page has the sign-up while its season is open.</p>
              )}
            </div>
          </section>
        </>
      )}
      {data.demo && data.actor && <h3 className="form-divider">Demo accounts</h3>}
      {data.demo ? (
        <CommandForm command="login" label={data.actor ? 'Switch account' : 'Sign in'} fields={{ next: back }} weight={data.actor ? 'default' : 'primary'}>
          <Select
            name="id"
            label="Demo account"
            items={data.identities.map((p) => [
              p.id,
              p.name +
                (p.id === 1
                  ? ' · Site admin'
                  : data.season?.squads.some((t) => t.captain === p.id)
                    ? ' · Captain'
                    : ' · Pilot'),
            ])}
          />
        </CommandForm>
      ) : data.actor ? (
        <p>
          Your name and identity come from Reloaded.{' '}
          <a href="https://auth.subspacereloaded.com/oauth/grants">Manage what this site can access at Reloaded</a>
        </p>
      ) : (
        <p>
          {data.name} uses your Subspace Reloaded account. Sign in there once and you are signed in here, with
          the same pilot name. There is no separate password.
        </p>
      )}
      {data.demo || data.actor ? null : (
        <a
          className="button primary"
          href={'/auth/login' + (query.size ? '?' + query : '')}
        >
          Sign in with Reloaded
        </a>
      )}
    </div>
  );
}
