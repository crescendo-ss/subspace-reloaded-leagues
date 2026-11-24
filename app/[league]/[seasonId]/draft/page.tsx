import Link from 'next/link';
import { Icon } from '@/components/symbols';
import { seasonMetadata } from '@/app/seo';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { Command, Panel, Setting, SignInPrompt } from '@/components/league';
import { LiveRevision } from '@/components/interactive';
import { methodOf } from '@/src/formation';
import { rated } from '@/src/draft';
import { DraftBoard } from '@/components/draft-room';
export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, 'draft', 'Draft room', ({ season: s }) =>
    (s.picks.length ? 'Draft results for ' : 'The draft room for ') + s.name + ' in the ' + s.leagueName + ' Subspace league: every pick by round, salaries and squad totals.');
export default async function DraftPage(props: LeaguePage) {
  const { season: s, actor, demo } = await loadLeaguePage(props, 'draft');
  const captain = s.squads.find((t) => t.captain === actor?.id);
  // A finished draft leads with its results; the sign-in and status lines are for a draft still to run
  const complete = !!s.draftFinished && !s.draft && s.squads.length > 0;
  const method = methodOf(s);
  const unpicked = Object.keys(s.players).filter((id) => !s.squads.some((t) => t.roster.includes(Number(id)))).length;
  // The rules this draft runs under, as sentences
  const rules = [
    method.draft?.format === 'auction' && 'Each squad has ' + (s.formation.credits ?? 100) + ' credits.',
    s.formation.squadSize && 'Squads fill to ' + s.formation.squadSize + ' pilots.',
    rated(s) && s.formation.cap && 'A squad’s first ' + s.formation.cap.picks + ' picks may total at most ' + s.formation.cap.salary + ' salary.',
    s.formation.clock && 'A squad has ' + s.formation.clock + ' seconds to pick.',
  ].filter(Boolean) as string[];
  const pool = { squads: s.squads, players: s.players, salaries: s.salaries, picks: s.picks, draft: s.draft, formation: s.formation };
  return (
    <>
      <header className="page-head">
        <h1>Draft room</h1>
        <p>
          {complete
            ? (s.picks.length ? s.picks.length + ' picks · ' : '') + 'Draft complete'
            : s.draft
              ? 'Draft in progress'
              : s.draftFinished
                ? 'Draft complete · Official rosters are awaiting import'
                : 'The live draft has not started'}
        </p>
      </header>
      {/* The mock draft is the same link in the same place, whatever state the draft is in */}
      <p><Link className="arrow-link" href={s.base + '/mock'}>Try a mock draft <Icon name="arrow" /></Link></p>
      {!actor && !complete && (
        <SignInPrompt demo={demo} next={s.base + '/draft'} title={s.draft ? 'Sign in to make your squad’s picks' : 'Sign in before the draft starts'}>
          Captains pick for their squads from this page once signed in. Everyone else can watch the draft here
          without signing in.
        </SignInPrompt>
      )}
      {actor?.operator && !s.matches.length && (
        <Panel framed title="Draft administration">
          {s.draft ? (
            <>
              <Setting name="Take back the last pick" note="The pilot returns to the pool and the turn comes round again.">
                {s.picks.length > 0 && !s.draft.lot ? <Command s={s} command="undoPick" label="Undo last pick" /> : <p className="muted">{s.draft.lot ? 'Finish the pilot on the block first.' : 'No picks yet.'}</p>}
              </Setting>
              <Setting name="Finish the live draft" note="Ends the draft where it stands. Pilots not yet picked stay unassigned. It can be reopened until the schedule is generated.">
                <Command s={s} command="endDraft" label="Finish live draft" weight="danger" />
              </Setting>
            </>
          ) : (
            <>
              {!s.draftFinished && (
                <Setting name="Squads and salaries" note={'Appoint the captains' + (rated(s) ? ' and set each pilot’s salary' : '') + ' before the draft opens. The draft’s rules are set there too.'}>
                  <Link className="arrow-link" href={s.base + '/manage'}>Manage season <Icon name="arrow" /></Link>
                </Setting>
              )}
              {!s.draftFinished && s.squads.length >= 2 && method.draft && (
                <Setting name="Open the live draft" note={method.label + ': ' + method.summary.toLowerCase() + '. ' + rules.join(' ')}>
                  <Command s={s} command="draft" label="Open live draft" weight="primary" />
                </Setting>
              )}
              {!s.draftFinished && !method.draft && (
                <Setting name="No draft this season" note={'This season forms its squads another way: ' + method.label.toLowerCase() + '. Change that under Manage season to run a draft.'}>
                  <Link className="arrow-link" href={s.base + '/manage'}>Manage season <Icon name="arrow" /></Link>
                </Setting>
              )}
              {s.draftFinished && s.draftReopenable && (
                <>
                  {unpicked > 0 && (
                    <Setting name="Reopen the draft" note={unpicked + (unpicked === 1 ? ' pilot was' : ' pilots were') + ' not picked. The draft carries on from the turn it had reached.'}>
                      <Command s={s} command="reopenDraft" label="Reopen draft" />
                    </Setting>
                  )}
                  {s.picks.length > 0 && (
                    <Setting name="Take back the last pick" note="Reopens the draft at that pick, with the pilot back in the pool.">
                      <Command s={s} command="undoPick" label="Undo last pick" />
                    </Setting>
                  )}
                </>
              )}
              {!s.squads.length && (
                <Setting name="Import a completed draft" note="For a draft held elsewhere: paste its export to create the squads with their picks. The format is in the README.">
                  <Command s={s} command="importRosters" label="Import completed draft">
                    <label className="wide">
                      Draft export (JSON)
                      <textarea name="data" rows={6} required placeholder={'{"players":[…],"squads":[…]}'} />
                    </label>
                  </Command>
                </Setting>
              )}
            </>
          )}
        </Panel>
      )}
      {s.draft && <LiveRevision season={s.id} revision={s.revision} />}
      <DraftBoard
        pool={pool}
        captain={captain?.id}
        operator={!!actor?.operator}
        now={Date.now()}
        live={{ id: s.id, revision: s.revision }}
        finished={!!s.draftFinished}
        summary={!complete}
        links={{ squads: s.base + '/squads/', pilots: '/' + s.leagueSlug + '/pilots/' }}
      />
    </>
  );
}
