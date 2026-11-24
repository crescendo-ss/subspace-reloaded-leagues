import Link from 'next/link';
import { noIndex } from '@/app/seo';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { Command, Field, Select, Section, Setting, Panel, Disclosure, SignInPrompt, WaitingPanel, squad } from '@/components/league';
import { Icon } from '@/components/symbols';
import { freePlayers, ruleLimits } from '@/src/league';
import { methodOf, methods as formationMethods } from '@/src/formation';
import { rated } from '@/src/draft';
import { squadsText } from '@/src/squad-builder';
export const metadata = { title: 'Season management', ...noIndex };
export default async function LeagueDesk(props: LeaguePage) {
  const { season: s, actor, methods, demo } = await loadLeaguePage(props, 'manage'),
    free = freePlayers(s);
  // How this season forms its squads decides which tools the page offers
  const method = methodOf(s),
    salaries = rated(s),
    settled = s.matches.length > 0 || s.picks.length > 0;
  const mine = s.squads.find((t) => t.captain === actor?.id);
  // Squads can be added or removed until the schedule exists or a draft is running
  const forming = !s.matches.length && !s.draft;
  const enlisted = Object.keys(s.players).map(Number).sort((x, y) => s.players[x].localeCompare(s.players[y]));
  // Pilots an operator may take out of the season: not captains, and with no draft pick or result on record
  const removable = enlisted.filter(
    (id) =>
      !s.squads.some((t) => t.captain === id) &&
      !s.picks.some((pick) => pick.player === id) &&
      !s.matches.some((m) => m.result?.players.some((player) => player.id === id)),
  );
  const pilots = (ids: number[]): [number, string][] => ids.map((id) => [id, s.players[id]]);
  // Pilots who said they would captain come first when a captain is chosen
  const willing = new Set(s.volunteers ?? []);
  const rules = s.rules ?? [];
  const candidatesFirst = (ids: number[]): [number, string][] =>
    [...ids].sort((x, y) => Number(willing.has(y)) - Number(willing.has(x))).map((id) => [id, s.players[id] + (willing.has(id) ? ' · willing to captain' : '')]);
  // What the season needs next from its operator, in the order a season runs
  const regular = s.matches.filter((m) => !m.series);
  const step: { text: string; action?: React.ReactNode } = s.over
    ? { text: 'The season is complete. The league can start its next one.', action: <Link className="button primary" href={'/' + s.leagueSlug + '/seasons/new'}>Start a new season</Link> }
    : s.draft
      ? { text: 'The draft is in progress.', action: <Link className="button primary" href={s.base + '/draft'}>Open the draft room</Link> }
      : s.bracket.length
        ? { text: 'The playoffs are under way. Results arrive from the zone; rule on a match from its page if one needs it.', action: <Link className="button" href={s.base + '/playoffs'}>See the bracket</Link> }
        : regular.length && regular.every((m) => m.result)
          ? { text: 'Every regular-season match has a result. Seed the playoffs from the standings.', action: <Command s={s} command="playoffs" label="Seed the playoffs" weight="primary" /> }
          : regular.length
            ? { text: regular.filter((m) => m.result).length + ' of ' + regular.length + ' regular-season matches have been played. Captains agree their own check-in times.', action: <Link className="button" href={s.base + '/schedule'}>See the schedule</Link> }
            : s.squads.length >= 2 && !free.length
              ? { text: 'Every pilot is on a squad. Generate the schedule to start the season.', action: <Command s={s} command="schedule" label="Generate the schedule" weight="primary" /> }
              : s.squads.length >= 2
                ? { text: free.length + (free.length === 1 ? ' pilot is' : ' pilots are') + ' not on a squad yet. ' + (method.kind === 'live' ? 'Run the draft, place them by hand below, or generate the schedule as things stand.' : method.kind === 'instant' ? 'Deal them onto the squads under Squad formation below, or generate the schedule as things stand.' : 'Add them to the squads under Squad formation below, or generate the schedule as things stand.'), action: <>{method.kind === 'live' && <Link className="button primary" href={s.base + '/draft'}>Open the draft room</Link>}<Command s={s} command="schedule" label="Generate the schedule" /></> }
                : enlisted.length
                  ? { text: method.kind === 'instant' ? 'Pilots have signed up. When sign-ups are in, form the squads under Squad formation below.' : method.kind === 'manual' ? 'Pilots have signed up. Enter the squads under Squad formation below.' : s.squads.length ? 'Appoint a second captain below: a season needs at least two squads.' : 'Pilots have signed up. Appoint captains below to create the squads.' }
                  : { text: 'Waiting for pilots to sign up. Share the league’s address; anyone signed in can sign up from its home page.' };
  const own = mine?.roster.filter((x) => x !== mine.captain) ?? [];
  const others = s.squads
    .filter((t) => t.id !== mine?.id)
    .flatMap((t) =>
      t.roster
        .filter((id) => id !== t.captain)
        .map((id): [number, string] => [id, s.players[id] + ' · ' + t.name]),
    );
  return (
    <>
      <h1>{actor?.operator ? 'Manage season' : mine ? 'Captain tools' : 'Season activity'}</h1>
      {s.closed && (
        <div className="notice">
          This season is closed and kept as history.
          {actor?.operator && <Command s={s} command="reopenSeason" label="Reopen season" />}
          {actor?.operator && <Link href={'/' + s.leagueSlug + '/seasons/new'}>Start a new season</Link>}
        </div>
      )}
      {actor?.operator && !s.closed && (
        <>
          {/* The page opens on what the season needs next, with the one filled button on it */}
          <Panel framed title="Next step">
            <div className="next-step">
              <p>{step.text}</p>
              {step.action}
            </div>
          </Panel>
          <Panel framed title="Season settings">
            <Setting name="Sign-ups" note={(s.enlistedOpen ? 'Open' : 'Closed') + '. ' + enlisted.length + (enlisted.length === 1 ? ' pilot has' : ' pilots have') + ' signed up. A pilot signs up for each season they want to play.'}>
              <Command s={s} command="toggleEnlist" label={s.enlistedOpen ? 'Close sign-ups' : 'Open sign-ups'} />
            </Setting>
            {!s.bracket.length && (
              <Setting name="Playoff places" note="How many squads reach the playoffs, from the top of the standings.">
                <Command s={s} command="playoffSpots" label="Save">
                  <Field name="spots" label="Squads that qualify" type="number" min={2} max={128} defaultValue={s.playoffSpots} />
                </Command>
              </Setting>
            )}
            {!s.squads.length && !s.matches.length && !s.draft && (
              <Setting name="Import a season played elsewhere" note="Fills this season from one JSON file: squads and draft, every result with its scoreboard, and the playoffs as they were played. Nothing changes unless the whole file is accepted. The format is in the README.">
                <Command s={s} command="importSeason" label="Import season">
                  <label>
                    Season export (JSON file)
                    <input type="file" name="data" accept="application/json,.json" required />
                  </label>
                </Command>
              </Setting>
            )}
            {s.matches.some((m) => m.result?.players.length) && (
              <Setting name="Update match statistics" note="Replaces the pilots’ statistics of matches already played with fuller ones, from one JSON file. Results, scores and line-ups stay as they are.">
                <Command s={s} command="importStats" label="Update statistics">
                  <label>
                    Statistics (JSON file)
                    <input type="file" name="data" accept="application/json,.json" required />
                  </label>
                </Command>
              </Setting>
            )}
          </Panel>
          <Panel framed title={<>Squad formation<small>{method.label}</small></>}>
            <Setting
              name="How squads are formed"
              note={method.summary + '. ' + (s.draft ? 'It cannot change while the draft is running.' : settled ? 'Settled, now that ' + (s.matches.length ? 'the schedule exists' : 'the draft has picks') + '.' : 'It can change until a draft has picks or the schedule exists.')}
            >
              {!s.draft && (
                <Command s={s} command="setFormation" label="Save">
                  {!settled && <Select name="method" label="Method" defaultValue={s.formation.method} items={Object.entries(formationMethods).map(([id, m]) => [id, m.label])} />}
                  {!s.picks.length && (
                    <Select name="salaries" label="Salaries" defaultValue={salaries ? 'yes' : 'no'} items={[['yes', 'Pilots have salaries'], ['no', 'No salaries']]} />
                  )}
                  {method.kind === 'live' && !s.picks.length && (
                    <>
                      {method.draft?.format === 'auction' && <Field name="credits" label="Credits per squad" type="number" min={1} defaultValue={s.formation.credits ?? 100} />}
                      <Field name="squadSize" label="Pilots per squad" type="number" min={2} max={64} required={false} defaultValue={s.formation.squadSize} placeholder="No limit" />
                      {salaries && (
                        <>
                          <Field name="capPicks" label="Opening cap: picks" type="number" min={1} max={20} required={false} defaultValue={s.formation.cap?.picks} placeholder="None" />
                          <Field name="capSalary" label="Opening cap: salary" type="number" min={1} required={false} defaultValue={s.formation.cap?.salary} placeholder="None" />
                        </>
                      )}
                    </>
                  )}
                  {method.kind === 'live' && (
                    <Field name="clock" label="Clock, in seconds" type="number" min={5} max={3600} required={false} defaultValue={s.formation.clock} placeholder="No clock" />
                  )}
                </Command>
              )}
            </Setting>
            {method.kind === 'live' && (
              <>
                {s.squads.length >= 2 && !settled && !s.draft && (
                  <Setting name="Draft order" note="Squads pick in this order. Draw it at random, or move a squad to the place it should have.">
                    <ol className="seat-order">
                      {s.squads.map((t) => <li key={t.id}>{t.name}</li>)}
                    </ol>
                    <Command s={s} command="drawOrder" label="Draw at random" />
                    <Command s={s} command="moveSquad" label="Move">
                      <Select name="squad" label="Squad" items={s.squads.map((t) => [t.id, t.name])} />
                      <Select name="to" label="To place" items={s.squads.map((_, i) => [i + 1, String(i + 1)])} />
                    </Command>
                  </Setting>
                )}
                <Setting name="Draft room" note={s.draft ? 'The draft is running.' : s.draftFinished ? 'The draft is complete.' : 'Appoint the captains' + (salaries ? ' and set salaries' : '') + ' below, then open the draft from its room.'}>
                  <Link className="arrow-link" href={s.base + '/draft'}>Draft room <Icon name="arrow" /></Link>
                </Setting>
              </>
            )}
            {method.kind === 'instant' && forming && (
              <Setting
                name={s.squads.length ? 'Deal the remaining pilots' : 'Form the squads'}
                note={'Makes the squads and deals every pilot not yet on one' + (method.deal === 'balanced' ? ', highest salary first, each to the squad with the least so far' : ', at random') + '. Captains are taken from the pilots who said they were willing, then from the rest. Any captain you appoint first is kept.'}
              >
                {free.length > 0 ? (
                  <Command s={s} command="form" label={s.squads.length ? 'Deal pilots' : 'Form squads'} weight="primary">
                    <Field name="squads" label="Number of squads" type="number" min={Math.max(2, s.squads.length)} max={64} defaultValue={Math.max(2, s.squads.length, Math.floor(enlisted.length / Math.max(1, s.minPerTeam)))} />
                  </Command>
                ) : (
                  <p className="muted">Every pilot is on a squad.</p>
                )}
              </Setting>
            )}
            {method.kind === 'manual' && forming && !s.picks.length && (
              <Setting
                name="Squads"
                note="One squad to a line: its name, a colon, then its pilots with the captain first, separated by commas. Saving replaces every squad with what is written here."
              >
                <Command s={s} command="setSquads" label="Save squads" weight="primary">
                  <label className="wide">
                    Squads
                    <textarea className="prose-input" name="data" rows={Math.max(6, s.squads.length + 2)} required defaultValue={squadsText(s)} placeholder={'Night Shift: Vesper, Drift, Mercury\nVoid Runners: Sol, Helix, Ember'} />
                  </label>
                </Command>
                {free.length > 0 && <p className="muted">Not on a squad: {free.map((id) => s.players[id]).join(', ')}</p>}
              </Setting>
            )}
            {method.kind !== 'live' && forming && s.squads.length > 0 && !s.picks.length && (
              <Setting name="Start again" note="Dissolves every squad. The pilots stay signed up.">
                <Command s={s} command="clearSquads" label="Clear the squads" weight="danger" />
              </Setting>
            )}
          </Panel>
          <Panel framed title={<>League rules<small>{rules.length}</small></>}>
            <p className="muted">
              Rules of your own, shown first among the season’s rules and on the sign-up page: eligibility, conduct,
              how matches are arranged. The site shows them and does not enforce them. They carry into the league’s
              next season.
            </p>
            {rules.map((rule) => (
              <Disclosure key={rule.id} title={rule.title}>
                <Command s={s} command="saveRule" label="Save rule" fields={{ rule: rule.id }}>
                  <RuleFields rule={rule} />
                </Command>
                <Command s={s} command="removeRule" label="Remove rule" weight="danger" fields={{ rule: rule.id }} />
              </Disclosure>
            ))}
            {rules.length < ruleLimits.count && (
              <Setting name="Add a rule" note="A title and what the rule says. Markdown works: **bold**, *italic*, lists that start with - or 1., and links.">
                <Command s={s} command="saveRule" label="Add rule">
                  <RuleFields />
                </Command>
              </Setting>
            )}
          </Panel>
          <Panel framed title={<>Captains<small>{s.squads.length} {s.squads.length === 1 ? 'squad' : 'squads'}</small></>}>
            {s.squads.map((t) => {
              const candidates = [...t.roster.filter((id) => id !== t.captain), ...free];
              const canRemove = forming && !s.picks.some((pick) => pick.squad === t.id);
              return (
                <Setting key={t.id} name={s.players[t.captain]} note={<>Captain of <Link href={s.base + '/squads/' + t.slug}>{t.name}</Link> · {t.roster.length} {t.roster.length === 1 ? 'pilot' : 'pilots'}</>}>
                  <Disclosure title="Change">
                    {candidates.length > 0 && (
                      <Command s={s} command="reassignCaptain" fields={{ squad: t.id }} label="Change captain">
                        <Select name="player" label="New captain" placeholder="Choose a pilot" items={pilots(candidates)} />
                      </Command>
                    )}
                    <Command s={s} command="renameSquad" fields={{ squad: t.id }} label="Rename squad">
                      <Field name="name" label="Squad name" maxLength={80} defaultValue={t.name} />
                    </Command>
                    {canRemove && (
                      <Command s={s} command="removeSquad" fields={{ squad: t.id }} label="Remove captain and squad" weight="quiet" />
                    )}
                  </Disclosure>
                </Setting>
              );
            })}
            <Setting name="Appoint a captain" note={(willing.size ? [...willing].filter((id) => free.includes(id)).length + ' of the pilots not yet on a squad said they are willing to captain; they are listed first. ' : '') + 'Agree with a pilot that they will captain, then appoint them. Appointing a captain creates their squad.'}>
              {forming && free.length > 0 ? (
                <Command s={s} command="addSquad" label="Appoint captain">
                  <Select name="player" label="Signed-up pilot" placeholder="Choose a pilot" items={candidatesFirst(free)} />
                  <Field name="name" label="Squad name (optional)" maxLength={80} required={false} placeholder="Named after the captain if left empty" />
                </Command>
              ) : forming ? (
                <p className="muted">{enlisted.length ? 'Every pilot who has signed up is already on a squad. More must sign up before another captain can be appointed.' : 'Pilots must sign up before you can form squads.'}</p>
              ) : (
                <p className="muted">New captains cannot be appointed once the {s.draft ? 'draft has started' : 'schedule is generated'}. Existing captains can still be changed.</p>
              )}
            </Setting>
          </Panel>
          <Panel framed title={<>Signed-up pilots<small>{enlisted.length}</small></>}>
            {!enlisted.length ? (
              <p className="muted">No one has signed up yet.</p>
            ) : salaries && !s.draft && !s.draftFinished ? (
              // Until the draft starts every salary can be set here, in one step
              <Command s={s} command="salaries" label="Save salaries">
                <ul className="pilot-grid editable">
                  {enlisted.map((id) => {
                    const t = s.squads.find((x) => x.roster.includes(id));
                    return (
                      <li key={id}>
                        <span><Link href={'/' + s.leagueSlug + '/pilots/' + id}>{s.players[id]}</Link><small>{t ? t.name + (t.captain === id ? ' · captain' : '') : 'Not on a squad' + (willing.has(id) ? ' · willing to captain' : '')}</small></span>
                        <input name={'pilot-' + id} type="number" min={0} step={1} defaultValue={Number.isFinite(s.salaries[id]) ? s.salaries[id] : undefined} placeholder="–" aria-label={'Salary for ' + s.players[id]} />
                      </li>
                    );
                  })}
                </ul>
              </Command>
            ) : (
              <ul className="pilot-grid">
                {enlisted.map((id) => {
                  const t = s.squads.find((x) => x.roster.includes(id));
                  return (
                    <li key={id}>
                      <span><Link href={'/' + s.leagueSlug + '/pilots/' + id}>{s.players[id]}</Link><small>{t ? t.name + (t.captain === id ? ' · captain' : '') : 'Not on a squad' + (willing.has(id) ? ' · willing to captain' : '')}</small></span>
                      {salaries && <b title="Salary">{Number.isFinite(s.salaries[id]) ? s.salaries[id] : '–'}</b>}
                    </li>
                  );
                })}
              </ul>
            )}
            {!s.draft && free.length > 0 && s.squads.length > 0 && (
              <Setting name="Place a pilot on a squad" note="For a pilot placed by hand rather than drafted.">
                <Command s={s} command="assign" label="Assign pilot">
                  <Select name="player" label="Pilot" items={pilots(free)} />
                  <Select name="squad" label="Squad" items={s.squads.map((t) => [t.id, t.name])} />
                </Command>
              </Setting>
            )}
            {!s.draft && free.length > 0 && !s.matches.length && s.squads.length >= 2 && (
              <Setting name="Share out the unassigned pilots" note="Places everyone not yet on a squad in one step, without a draft.">
                <Command s={s} command="form" label="Distribute pilots">
                  <Select name="method" label="Method" items={methods.map((m) => [m.id, m.label])} />
                </Command>
              </Setting>
            )}
            {removable.length > 0 && !s.draft && (
              <Disclosure title={'Prune the pool · ' + removable.length + (removable.length === 1 ? ' pilot' : ' pilots') + ' can be removed'}>
                <p className="muted">
                  Tick everyone who will not play this season, for instance pilots who do not meet the league’s
                  eligibility rule, and remove them in one step. Captains, and pilots who have been drafted or have
                  played, are not listed. {s.enlistedOpen && 'Sign-ups are open, so a pilot removed here can sign up again: close sign-ups first to keep the pool as you leave it.'}
                </p>
                <Command s={s} command="prune" label="Remove ticked pilots" weight="danger">
                  <ul className="pilot-grid choose">
                    {removable.map((id) => {
                      const t = s.squads.find((x) => x.roster.includes(id));
                      return (
                        <li key={id}>
                          <label>
                            <input type="checkbox" name={'pilot-' + id} />
                            <span>{s.players[id]}<small>{t ? t.name : 'Not on a squad'}{Number.isFinite(s.salaries[id]) ? ' · salary ' + s.salaries[id] : ''}</small></span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </Command>
              </Disclosure>
            )}
          </Panel>
          {!s.over && (
            <Panel framed tone="danger" title="Close this season">
              <Setting name="End the season without a champion" note="A closed season is kept as read-only history, and the league can then start its next one. It can be reopened until that happens.">
                <Command s={s} command="closeSeason" label="Close season" weight="danger" />
              </Setting>
            </Panel>
          )}
        </>
      )}
      {mine && <WaitingPanel s={s} actor={actor} />}
      {mine && (
        <Panel framed title={mine.name}>
          <Setting name="Your squad" note={mine.roster.length + (mine.roster.length === 1 ? ' pilot' : ' pilots') + ' on the roster.'}>
            <Link className="arrow-link" href={s.base + '/squads/' + mine.slug}>Roster and results <Icon name="arrow" /></Link>
            <Link className="arrow-link" href={s.base + '/schedule?view=mine'}>Your matches <Icon name="arrow" /></Link>
          </Setting>
          <Setting name="Squad name" note="Shown everywhere the squad is. Its address stays the same.">
            <Command s={s} command="renameSquad" fields={{ squad: mine.id }} label="Rename squad">
              <Field name="name" label="Name" maxLength={80} defaultValue={mine.name} />
            </Command>
          </Setting>
          {own.length > 0 && others.length > 0 && (
            <Setting name="Propose a trade" note="Offers one of your pilots for one of another squad’s. The other captain has to accept.">
              <Command s={s} command="offer" label="Propose trade">
                <Select name="give" label="Offer pilot" items={pilots(own)} />
                <Select name="take" label="Request pilot" items={others} />
              </Command>
            </Setting>
          )}
          {own.length > 0 && (
            <Setting name="Release a pilot" note="Takes the pilot off your squad. They become a free agent.">
              <Command s={s} command="kick" label="Release to free agency" weight="danger">
                <Select name="player" label="Rostered pilot" items={pilots(own)} />
              </Command>
            </Setting>
          )}
        </Panel>
      )}
      {s.trades.length > 0 && (
        <Section title="Trades">
          {s.trades.toReversed().map((t) => (
            <div key={t.id}>
              <h3>
                {s.players[t.players[0]]} for {s.players[t.players[1]]}
              </h3>
              <p>
                {t.squads.map((id) => squad(s, id).name).join(' / ')} ·{' '}
                {
                  {
                    offered: 'Awaiting captain approval',
                    review: 'Awaiting operator approval',
                    completed: 'Completed',
                    declined: 'Declined',
                  }[t.state]
                }
              </p>
              {((t.state === 'offered' && mine?.id === t.squads[1]) ||
                (t.state === 'review' && actor?.operator)) && (
                <div className="actions">
                  <Command
                    s={s}
                    command="trade"
                    fields={{ trade: t.id, decision: 'accept' }}
                    label="Approve trade"
                  />
                  <Command
                    s={s}
                    command="trade"
                    fields={{ trade: t.id, decision: 'decline' }}
                    label="Decline trade"
                  />
                </div>
              )}
            </div>
          ))}
        </Section>
      )}
      {!actor?.operator && !mine && !s.trades.length && (
        <p className="empty-box">{s.draft ? 'The draft is in progress.' : 'No trades have been proposed this season.'}{s.draft && <Link className="arrow-link" href={s.base + '/draft'}>Open the draft room <Icon name="arrow" /></Link>}</p>
      )}
      {!actor && (
        <SignInPrompt demo={demo} next={s.base + '/manage'} title="Sign in to manage your squad">
          Captains manage their roster and trades here, and operators manage the season.
        </SignInPrompt>
      )}
      {actor && !mine && !actor.operator && (
        <p>
          You are signed in, but you are not a captain or an operator in this season.{' '}
          <Link href={s.base}>Season overview and sign-up</Link>
        </p>
      )}
    </>
  );
}

// The two fields of a league rule. The example is the kind of rule the site cannot check for itself.
function RuleFields({ rule }: { rule?: { title: string; body: string } }) {
  return (
    <>
      <Field name="title" label="Title" defaultValue={rule?.title} maxLength={80} placeholder="Eligibility" />
      <label className="wide">
        Rule
        <textarea
          className="prose-input"
          name="body"
          rows={rule ? Math.min(14, Math.max(4, rule.body.split('\n').length + 2)) : 4}
          defaultValue={rule?.body}
          required
          maxLength={ruleLimits.body}
          placeholder="Players must have played 20 ranked 4v4 games in the month before the draft to be in the pool."
        />
      </label>
    </>
  );
}
