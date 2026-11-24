import { noIndex } from '@/app/seo';
import Link from 'next/link';
import { loadLeagueHome } from '@/app/data';
import { database } from '@/src/runtime';
import { Field, SignInPrompt } from '@/components/league';
import { CommandForm } from '@/components/interactive';
export const metadata = { title: 'League settings', ...noIndex };
export default async function LeagueSettings({ params }: { params: Promise<{ league: string }> }) {
  const { actor, league, seasons, demo } = await loadLeagueHome(params);
  // Everyone who has signed in to the site, so operators can be chosen by name
  const known: { id: number; name: string }[] = actor?.admin
    ? (await (await database()).query('SELECT id, name FROM identities ORDER BY name')).rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
      }))
    : [];
  const name = (id: number) => known.find((pilot) => pilot.id === id)?.name;
  const candidates = known.filter((pilot) => !league.operators.includes(pilot.id));
  return (
    <div className="form-page">
      <Link className="back-link" href={'/' + league.slug}>Back to {league.name}</Link>
      <h1>League settings</h1>
      {actor?.admin && (
        <>
          <section className="panel framed">
            <div className="panel-head"><h2>Name and description</h2></div>
            <div className="panel-body">
          <CommandForm command="saveLeague" seasonId={league.id} label="Save league">
            <Field name="name" label="League name" maxLength={60} defaultValue={league.name} />
            <Field name="tagline" label="Short description" maxLength={120} defaultValue={league.tagline} required={false} />
          </CommandForm>
          <p className="muted">The league’s address, /{league.slug}, stays the same when it is renamed.</p>
            </div>
          </section>
          <section className="panel framed">
            <div className="panel-head">
              <h2>Operators</h2>
            </div>
            <div className="panel-body">
            <p>
              Operators run this league’s seasons: they appoint captains, set salaries, manage the pilots who sign up and
              rule on matches. Site admins can already do this in every league.
            </p>
            {league.operators.length > 0 ? (
              <ul className="operator-list">
                {league.operators.map((id) => (
                  <li key={id}>
                    <span>
                      {name(id) ?? 'Not signed in yet'} <small>Profile {id}</small>
                    </span>
                    <CommandForm command="removeOperator" seasonId={league.id} fields={{ profile: String(id) }} label="Remove" weight="quiet" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">This league has no operators of its own yet.</p>
            )}
            <CommandForm command="addOperator" seasonId={league.id} label="Add operator">
              {candidates.length > 0 && (
                <label>
                  Pilot
                  <select name="known" defaultValue="">
                    <option value="">Choose a pilot</option>
                    {candidates.map((pilot) => (
                      <option key={pilot.id} value={pilot.id}>
                        {pilot.name} · profile {pilot.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {candidates.length > 0 ? 'or a Reloaded profile ID' : 'Reloaded profile ID'}
                <input name="profile" type="number" min={1} step={1} />
              </label>
            </CommandForm>
            <p className="muted">
              The list shows everyone who has signed in to this site, so the simplest way to add someone is to ask
              them to sign in once. Their profile ID is also shown on their Account page.
            </p>
            </div>
          </section>
        </>
      )}
      {actor?.operator && (
        <section className="panel framed danger">
          <div className="panel-head">
            <h2>Delete this league</h2>
          </div>
          <div className="panel-body">
          <p>
            Deleting {league.name} removes it from the site for good, along with{' '}
            {seasons.length === 0 ? 'its settings' : seasons.length === 1 ? 'its season' : 'its ' + seasons.length + ' seasons'}
            {seasons.length > 0 && ' and every squad, match result and statistic in ' + (seasons.length === 1 ? 'it' : 'them')}. This
            cannot be undone.
          </p>
          <CommandForm command="deleteLeague" seasonId={league.id} label="Delete league" weight="danger">
            <Field name="confirm" label={'Type “' + league.name + '” to confirm'} autoComplete="off" />
          </CommandForm>
          </div>
        </section>
      )}
      {!actor ? (
        <SignInPrompt demo={demo} next={'/' + league.slug + '/manage'} title="Sign in to change league settings">
          This page is for the league’s operators and site admins.
        </SignInPrompt>
      ) : !actor.operator ? (
        <p>You are signed in, but only this league’s operators and site admins can change its settings.</p>
      ) : !actor.admin ? (
        <p className="muted">Renaming the league and choosing its operators is done by a site admin.</p>
      ) : null}
    </div>
  );
}
