import type { CommandName } from '@/src/commands';
import { Markdown } from './markdown';
import Link from 'next/link';
import type { ReactNode, InputHTMLAttributes } from 'react';
import type { SeasonView, MatchView } from '@/src/service';
import { MatchCard, MatchRow, ResultRow } from './match-card';
import { playoffStatus, type PlayoffStatus } from '@/src/clinch';
import { seriesTitle } from '@/src/bracket-layout';
import { waitingOn } from '@/src/waiting';
import { Icon } from './symbols';
import { CommandForm } from './interactive';

// A section of a page. Cards and brackets carry their own frames, so a section of those is a heading and
// space. A table, a form or prose has no shape of its own, so its section is `framed`: a box with the
// title in a strip across the top and, at the strip's right, the section's link or filter.
export function Panel({
  title,
  action,
  children,
  framed = false,
  tone,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  framed?: boolean;
  // `danger` marks a section whose action is hard to take back
  tone?: 'danger';
}) {
  return (
    <section className={'panel' + (framed ? ' framed' : '') + (tone ? ' ' + tone : '')}>
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {framed ? <div className="panel-body">{children}</div> : children}
    </section>
  );
}
export function Section({ title, children, tone }: { title: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <Panel title={title} framed tone={tone}>
      <div className="management">{children}</div>
    </Panel>
  );
}
// What is waiting on whoever is signed in, each with the way to where it is dealt with. Nothing is shown
// when nothing is waiting.
export function WaitingPanel({ s, actor }: { s: SeasonView; actor: { id: number; operator: boolean } | null }) {
  const items = waitingOn(s, actor);
  if (!items.length) return null;
  return (
    <Panel framed title={<>Waiting on you<small>{items.length}</small></>}>
      <ul className="link-rows">
        {items.map((item) => (
          <li key={item.key}>
            <span>{item.text}</span>
            <Link className="arrow-link" href={s.base + item.path}>{item.path === '/manage' ? 'Review' : 'Open the match'} <Icon name="arrow" /></Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
// Signing up for a season: the pilot says whether they would captain a squad, then signs up.
// An operator who is only running the league is offered it quietly, not as the page's one action.
// A league's own rules, as rows of a rules list: each a title and what the operators wrote under it
export function LeagueRuleRows({ rules }: { rules: { id: string; title: string; body: string }[] }) {
  return rules.map((rule) => (
    <div key={rule.id}>
      <dt>{rule.title}</dt>
      <dd><Markdown text={rule.body} /></dd>
    </div>
  ));
}
// One press signs a pilot up. Whether they would captain is asked afterwards, on the page they land on
// (see CaptainInterest), so there is one button and no choice to make first. Someone who is not signed in
// presses the same button: they are sent to sign in, and come back signed up. `next` is the page to land on.
export function SignUp({ s, next, quiet = false, signedIn = true, note = true }: { s: { id: string }; next: string; quiet?: boolean; signedIn?: boolean; note?: boolean }) {
  return (
    <div className="sign-up">
      <div className="sign-up-buttons">
        <CommandForm seasonId={s.id} command="join" label="Sign up" fields={{ next }} weight={quiet ? 'default' : 'signup'} />
      </div>
      {note && !signedIn && <p className="sign-up-note">You will sign in with your Subspace Reloaded account first.</p>}
    </div>
  );
}
// For a pilot who has signed up: what they said about captaining, and the way to change it
export function CaptainInterest({ s, pilot }: { s: SeasonView; pilot: number }) {
  const willing = s.volunteers?.includes(pilot) ?? false;
  if (s.matches.length || s.draft || s.squads.some((t) => t.captain === pilot)) return null;
  return (
    <div className="captain-interest">
      <p>{willing ? 'You have said you are willing to captain a squad.' : 'You signed up as a pilot, not as a captain.'}</p>
      <Command s={s} command="volunteer" fields={{ captain: willing ? 'no' : 'yes' }} label={willing ? 'I would rather not captain' : 'I am willing to captain'} />
      {!s.squads.some((t) => t.roster.includes(pilot)) && <Command s={s} command="withdraw" label="Withdraw my sign-up" weight="quiet" />}
    </div>
  );
}
// One setting to a row inside a framed section: what it is and a line about it on the left, its control
// on the right.
export function Setting({ name, children, note }: { name: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div>
        <h3>{name}</h3>
        {note && <p>{note}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
export function Disclosure({
  title,
  children,
  open,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="disclosure" open={open}>
      <summary>{title}</summary>
      <div className="stack">{children}</div>
    </details>
  );
}
export function Table({ headers, rows, numericFrom = headers.length, columnClass, rowClass, hints }: {
  headers: string[];
  // What a terse column heading stands for, shown on hover and read out in place of the heading
  hints?: Record<string, string>;
  rows: ReactNode[][];
  numericFrom?: number;
  columnClass?: (column: number) => string | undefined;
  rowClass?: (row: number) => string | undefined;
}) {
  const cell = (i: number) => [i >= numericFrom && 'number', columnClass?.(i)].filter(Boolean).join(' ') || undefined;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((t, i) => (
              <th key={t} scope="col" className={cell(i)} title={hints?.[t]} aria-label={hints?.[t]}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={rowClass?.(i)}>
              {row.map((v, j) => (
                <td key={j} className={cell(j)}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
// The one way to ask a visitor to sign in, wherever a page needs it: what signing in is for here, and the
// same "Sign in" button as the header. There is a single site-wide sign-in, so the prompt never names another.
// `next` is the page to come back to.
export function signInHref(demo: boolean, next: string) {
  return (demo ? '/account' : '/auth/login') + '?next=' + encodeURIComponent(next);
}
export function SignInPrompt({ demo, next, title, children }: { demo: boolean; next: string; title: string; children?: ReactNode }) {
  return (
    <aside className="sign-in-prompt" aria-label="Sign in">
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      <a className="button primary" href={signInHref(demo, next)}>Sign in</a>
    </aside>
  );
}
export function squad(s: SeasonView, id: string) {
  return s.squads.find((x) => x.id === id)!;
}
// With the season, a series is named for where it stands in the bracket: "Final", "Semifinals"
export function seriesLabel(series: string, s?: Pick<SeasonView, 'bracket'>) {
  const title = s && seriesTitle(s.bracket, series);
  if (title) return title;
  const [stage, round, pairing] = series.split('-');
  if (stage === 'Final') return 'Final';
  if (stage === 'Reset') return 'Deciding final';
  return (
    (stage === 'Upper' ? 'Winners’ bracket' : 'Losers’ bracket') + ', round ' + round + ', series ' + pairing
  );
}
// Where a match sits in the season, for lists that are not already grouped by round
export function matchContext(m: MatchView, s?: Pick<SeasonView, 'bracket'>) {
  return (m.series ? seriesLabel(m.series, s) + ' · Game ' + m.round : 'Round ' + m.round) + (m.series ? '' : ' · Match ' + m.number);
}
export function MatchCards({ s, matches, empty = 'No matches yet.', round = false, context }: {
  s: SeasonView;
  matches: MatchView[];
  empty?: string;
  round?: boolean;
  context?: (m: MatchView, s: SeasonView) => string;
}) {
  if (!matches.length) return <p className="muted">{empty}</p>;
  return (
    <ul className={round ? 'match-cards round-grid' : 'match-cards'}>
      {matches.map((m) => (
        <li key={m.id}><MatchCard season={s} match={m} context={context?.(m, s)} /></li>
      ))}
    </ul>
  );
}
// Matches as rows: a finished one as its score, one still to come as its time. `context` false leaves the
// round off, for a list that sits under a heading naming it.
export function MatchRows({ s, matches, context = true }: { s: SeasonView; matches: MatchView[]; context?: boolean }) {
  const label = (m: MatchView) => (m.series ? seriesLabel(m.series, s) + ' · Game ' + m.round : 'Round ' + m.round);
  return (
    <ul className="match-rows">
      {matches.map((m) => (
        <li key={m.id}>
          {/* Under a round's heading every row is the same shape, played or not, so the list lines up */}
          {!context ? <ResultRow season={s} match={m} game />
            : m.result ? <ResultRow season={s} match={m} context={label(m)} />
            : <MatchRow season={s} match={m} context={label(m)} />}
        </li>
      ))}
    </ul>
  );
}
// A squad's last five regular-season results as letters, oldest first: W, L or D.
function FormGuide({ s, id }: { s: SeasonView; id: string }) {
  const recent = s.matches
    .filter((m) => m.result && !m.series && (m.home === id || m.away === id))
    .sort((a, b) => a.result!.recordedAt.localeCompare(b.result!.recordedAt))
    .slice(-5)
    .map((m) => (m.result!.winner === null ? 'draw' : m.result!.winner === id ? 'win' : 'loss'));
  if (!recent.length) return null;
  return (
    <span className="form-guide" role="img" aria-label={'Last ' + recent.length + ': ' + recent.join(', ')}>
      {recent.map((outcome, i) => <b key={i} className={outcome}>{outcome[0].toUpperCase()}</b>)}
    </span>
  );
}
// Kill differential: green when a squad has scored more than it conceded, red when fewer
export function Difference({ value }: { value: number }) {
  return (
    <span className="difference" data-sign={value > 0 ? 'up' : value < 0 ? 'down' : undefined} aria-label={'Kill differential ' + value}>
      {value > 0 ? '+' + value : value < 0 ? '−' + -value : 0}
    </span>
  );
}
export const differenceHint = 'Kill differential: kills scored minus kills conceded';
// Names the line under the last playoff place; what it means is on hover
export function CutoffLabel({ spots, seeded = false }: { spots: number; seeded?: boolean }) {
  return (
    <span className="cutoff-label" title={'Top ' + spots + (seeded ? ' qualified' : ' qualify') + ' for the playoffs'}>
      Playoff line
    </span>
  );
}
// A squad's settled place in the playoff race, as a short tag beside its name
export function ClinchTag({ status }: { status?: PlayoffStatus }) {
  if (!status) return null;
  return (
    <span className="clinch" data-kind={status.kind}>
      {status.kind === 'seed' ? 'Clinched seed ' + status.seed : status.kind === 'in' ? 'Clinched playoffs' : 'Eliminated'}
    </span>
  );
}
// `compact` is the four-column form for a narrow place; with `formBelow` each squad's recent results sit
// under its name, which is how a phone shows the full standings.
export function Rankings({ s, compact = false, limit, formBelow = false }: { s: SeasonView; compact?: boolean; limit?: number; formBelow?: boolean }) {
  const form = !compact && s.matches.some((m) => m.result && !m.series);
  const cutoff = !limit && s.standings.length > s.playoffSpots ? s.playoffSpots - 1 : -1;
  const headers = compact
    ? ['#', 'Squad', 'W–L–D', '+/−']
    : ['Rank', 'Squad', ...(form ? ['Recent form'] : []), 'Played', 'Wins', 'Losses', 'Draws', '+/−'];
  // What is already settled in the playoff race, until the bracket is seeded
  const settled = s.bracket.length ? new Map() : playoffStatus(s.standings, s.matches, s.playoffSpots);
  return (
    <>
      <Table
        numericFrom={form ? 3 : 2}
        headers={headers}
        hints={{ '+/−': differenceHint, 'W–L–D': 'Wins, losses, draws' }}
        columnClass={(i) => (i === 0 ? 'rank' : form && i === 2 ? 'form-col' : undefined)}
        rowClass={(i) =>
          [i === 0 && s.standings[0].wins > 0 && 'leader', i === cutoff && 'cutoff', cutoff >= 0 && i > cutoff && 'outside'].filter(Boolean).join(' ') || undefined
        }
        rows={s.standings.slice(0, limit).map((r, i) => [
          i + 1,
          <>
            <Link href={s.base + '/squads/' + squad(s, r.id).slug} className="plain-link">
              {r.name}
            </Link>
            <ClinchTag status={settled.get(r.id)} />
            {formBelow && <span className="form-below"><FormGuide s={s} id={r.id} /></span>}
          </>,
          ...(form ? [<FormGuide s={s} id={r.id} />] : []),
          ...(compact ? [[r.wins, r.losses, r.draws].join('–')] : [r.played, r.wins, r.losses, r.draws]),
          <>
            <Difference value={r.killDiff} />
            {i === cutoff && <CutoffLabel spots={s.playoffSpots} seeded={s.bracket.length > 0} />}
          </>,
        ])}
      />
    </>
  );
}
export function Command({
  s,
  ...props
}: {
  s: SeasonView;
  command: CommandName;
  label: string;
  fields?: Record<string, string>;
  weight?: 'primary' | 'default' | 'quiet' | 'danger';
  children?: ReactNode;
}) {
  return <CommandForm seasonId={s.id} revision={s.revision} {...props} />;
}
export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label>
      {label}
      <input required {...props} />
    </label>
  );
}
export function Select({
  name,
  label,
  items,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  items: [string | number, string][];
  defaultValue?: string;
  // An empty first choice, so nothing is submitted until one is picked
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      {/* React does not move an uncontrolled select when its default changes, so a new default from the
          server makes a new select: the one showing always matches what is saved */}
      <select key={String(defaultValue ?? '')} required name={name} defaultValue={defaultValue ?? (placeholder ? '' : undefined)}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {items.map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
