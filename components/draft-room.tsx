'use client';
import { startTransition, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  available,
  blocked,
  remainingBudget,
  turnSquad,
  rated,
  spendable,
  type DraftPool,
  type DraftMove,
  type Pick as DraftPick,
} from '@/src/draft';
import Link from 'next/link';
import { CommandForm } from './interactive';
import { submitCommand } from '@/app/actions';

type Live = { id: string; revision: number };
type Action = (action: DraftMove, player: number, amount: number) => void;
function DraftAction({
  action,
  label,
  player,
  minimum,
  limit,
  amount,
  bidLabel = 'Bid',
  live,
  onMove,
  weight = 'default',
  extra,
}: {
  action: DraftMove;
  label: string;
  player?: number;
  minimum?: number;
  limit?: number;
  amount?: number;
  bidLabel?: string;
  live?: Live;
  onMove?: Action;
  weight?: 'primary' | 'default' | 'quiet';
  // Sent with a live move: the turn it is meant for, and the squad an operator is acting for
  extra?: Record<string, string>;
}) {
  const fields: Record<string, string> = { player: String(player ?? 0), ...extra };
  if (amount !== undefined) fields.amount = String(amount);
  const bid =
    minimum === undefined ? null : (
      <label>
        {bidLabel} <input type="number" name="amount" min={minimum} max={limit} defaultValue={minimum} required />
      </label>
    );
  if (live)
    return (
      <CommandForm seasonId={live.id} revision={live.revision} command={action} label={label} fields={fields} weight={weight}>
        {bid}
      </CommandForm>
    );
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        onMove!(action, player ?? 0, amount ?? Number(new FormData(e.currentTarget).get('amount')));
      }}
    >
      {bid}
      <button className={weight === 'default' ? undefined : weight}>{label}</button>
    </form>
  );
}

// Colours here only tell the board's columns apart: each follows a squad's place in the draft order
// and is not used as the squad's identity anywhere else.
const hue = (pool: DraftPool, id: string) => pool.squads.findIndex((t) => t.id === id) % 8;
const initials = (name: string) => {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
};
function SquadName({ pool, id }: { pool: DraftPool; id: string }) {
  return (
    <span className="squad-chip" data-hue={hue(pool, id)}>
      {pool.squads.find((t) => t.id === id)?.name}
    </span>
  );
}

type Cell =
  | { state: 'made'; n?: number; pick: DraftPick }
  | { state: 'clock' | 'open'; n: number }
  | { state: 'skipped' }
  | null;
// The picks to show. A finished draft without a pick history still has its outcome: who ended up on which squad.
function draftPicks(pool: DraftPool) {
  const recorded = pool.picks.length > 0 || !!pool.draft;
  const made: { state: 'made'; n?: number; pick: DraftPick }[] = recorded
    ? pool.picks.map((pick, i) => ({ state: 'made', n: i + 1, pick }))
    : pool.squads.flatMap((t) =>
        t.roster
          .filter((id) => id !== t.captain)
          .map((player) => ({ state: 'made', pick: { squad: t.id, player, salary: pool.salaries[player] } })),
      );
  return { recorded, made };
}
// On a phone the board is too wide to read, so one squad's picks and totals are shown at a time
function SquadPicks({ pool, initial }: { pool: DraftPool; initial?: string }) {
  const [focus, setFocus] = useState(initial ?? pool.squads[0]?.id);
  const d = pool.draft;
  const squad = pool.squads.find((t) => t.id === focus) ?? pool.squads[0];
  if (!squad) return null;
  const { recorded, made } = draftPicks(pool);
  const mine = made.filter((cell) => cell.pick.squad === squad.id);
  const sum = (key: 'salary' | 'price', picks = mine) => picks.reduce((n, cell) => n + (cell.pick[key] ?? 0), 0);
  const auction = d ? d.format === 'auction' : pool.picks.some((p) => p.price !== undefined);
  // The league's own draft rules decide which figures there are to show
  const salaries = rated(pool),
    cap = salaries ? pool.formation?.cap : null;
  return (
    <div className="squad-picks" data-hue={hue(pool, squad.id)}>
      <label>
        Squad
        <select value={squad.id} onChange={(e) => setFocus(e.target.value)}>
          {pool.squads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">Captain: {pool.players[squad.captain]}</p>
      <ol>
        {mine.map((cell, i) => (
          <li key={i}>
            <b>{cell.n ?? i + 1}</b>
            <span className="cell-name">{pool.players[cell.pick.player]}</span>
            <span>
              {cell.pick.turn !== undefined && 'Round ' + (Math.floor(cell.pick.turn / pool.squads.length) + 1) + ' · '}
              {salaries && (Number.isFinite(cell.pick.salary) ? 'Sal ' + cell.pick.salary : 'Unrated')}
              {cell.pick.price !== undefined && (salaries ? ' · ' : '') + cell.pick.price + ' cr'}
            </span>
          </li>
        ))}
        {d && !d.lot && d.next === squad.id && (
          <li data-state="clock">
            <b>{pool.picks.length + 1}</b>
            <span className="cell-name">Picking now</span>
          </li>
        )}
      </ol>
      {!mine.length && !(d && d.next === squad.id) && <p className="muted">No picks yet.</p>}
      <dl>
        {recorded && cap && (
          <div>
            <dt>First {cap.picks}</dt>
            <dd>
              {sum('salary', mine.slice(0, cap.picks))} / {cap.salary}
            </dd>
          </div>
        )}
        {salaries && (
          <div>
            <dt>Salary</dt>
            <dd>{sum('salary')}</dd>
          </div>
        )}
        {!!pool.formation?.squadSize && (
          <div>
            <dt>Pilots</dt>
            <dd>{squad.roster.length} / {pool.formation.squadSize}</dd>
          </div>
        )}
        {auction && (
          <div>
            <dt>Spent</dt>
            <dd>{sum('price')}</dd>
          </div>
        )}
        {d?.format === 'auction' && (
          <div>
            <dt>Credits</dt>
            <dd>{remainingBudget(pool, squad.id)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
// One column per squad. A regular draft has one row per round, so the pick numbers show the order;
// an auction, or a history without recorded turns, stacks each squad's picks in the order they were made.
// `links` gives the addresses squads and pilots live under, for a board that is a record and not a draft in play
type BoardLinks = { squads: string; pilots: string };
function PickBoard({ pool, links }: { pool: DraftPool; links?: BoardLinks }) {
  const d = pool.draft,
    squads = pool.squads,
    count = squads.length;
  const column = new Map(squads.map((t, i) => [t.id, i]));
  const left = available(pool).length;
  const { recorded, made } = draftPicks(pool);
  const auction = d ? d.format === 'auction' : pool.picks.some((p) => p.price !== undefined);
  const rows: { label: string; arrow?: string; hint: string; cells: Cell[] }[] = [];
  if (recorded && !auction && pool.picks.every((p) => p.turn !== undefined)) {
    const done = d ? d.pick : Math.max(-1, ...pool.picks.map((p) => p.turn!)) + 1;
    const turns = d ? d.pick + left : done;
    const byTurn = new Map(made.map((cell) => [cell.pick.turn!, cell]));
    for (let r = 0; r * count < turns; r++) {
      const reversed = d
        ? d.order === 'snake' && r % 2 === 1
        : pool.picks.some((p) => Math.floor(p.turn! / count) === r && p.turn! % count !== column.get(p.squad));
      rows.push({
        label: 'R' + (r + 1),
        arrow: reversed ? '←' : '→',
        hint: 'Round ' + (r + 1) + ', picking ' + (reversed ? 'right to left' : 'left to right'),
        cells: squads.map((_, i) => {
          const turn = r * count + (reversed ? count - 1 - i : i);
          return (
            byTurn.get(turn) ??
            (d && turn === d.pick
              ? { state: 'clock', n: pool.picks.length + 1 }
              : d && turn > d.pick && turn < turns
                ? { state: 'open', n: pool.picks.length + 1 + turn - d.pick }
                : turn < done
                  ? { state: 'skipped' }
                  : null)
          );
        }),
      });
    }
  } else {
    const lists = squads.map((t) => made.filter((cell) => cell.pick.squad === t.id));
    const depth = Math.max(0, ...lists.map((list) => list.length));
    for (let n = 0; n < depth; n++)
      rows.push({ label: String(n + 1), hint: 'Selection ' + (n + 1), cells: lists.map((list) => list[n] ?? null) });
  }
  const sum = (picks: DraftPick[], key: 'salary' | 'price') => picks.reduce((n, p) => n + (p[key] ?? 0), 0);
  const picksOf = (id: string) => made.filter((cell) => cell.pick.squad === id).map((cell) => cell.pick);
  const salaries = rated(pool),
    cap = salaries ? pool.formation?.cap : null;
  const totals: [string, string, (id: string) => ReactNode][] = salaries ? [['Salary', 'Total salary drafted', (id) => sum(picksOf(id), 'salary')]] : [];
  if (recorded && cap)
    totals.unshift([
      'First ' + cap.picks,
      'Salary across a squad’s first ' + cap.picks + ' picks, of ' + cap.salary + ' allowed',
      (id) => sum(picksOf(id).slice(0, cap.picks), 'salary') + ' / ' + cap.salary,
    ]);
  if (auction) totals.push(['Spent', 'Credits spent', (id) => sum(picksOf(id), 'price')]);
  if (d?.format === 'auction') totals.push(['Credits', 'Credits remaining', (id) => remainingBudget(pool, id)]);
  return (
    <div className="table-wrap">
      <table className="pick-board" style={{ minWidth: 'calc(3.75rem + ' + count + ' * 5.25rem)' }}>
        <thead>
          <tr>
            <td />
            {squads.map((t) => (
              <th
                key={t.id}
                scope="col"
                data-hue={hue(pool, t.id)}
                data-active={d && (d.lot ? d.lot.leader === t.id : d.next === t.id) ? 'true' : undefined}
              >
                {links && t.slug ? <Link href={links.squads + t.slug}>{t.name}</Link> : t.name}
                <small>Capt. {pool.players[t.captain]}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" title={row.hint} aria-label={row.hint}>
                {row.label}
                {row.arrow && <span aria-hidden="true"> {row.arrow}</span>}
              </th>
              {row.cells.map((cell, i) => (
                <td key={squads[i].id} data-hue={i % 8} data-state={cell?.state}>
                  {cell?.state === 'made' && (
                    <>
                      <span className="cell-meta">
                        <b>{cell.n}</b>
                        <span>
                          {salaries && (Number.isFinite(cell.pick.salary) ? 'Sal ' + cell.pick.salary : 'Unrated')}
                          {cell.pick.price !== undefined && (salaries ? ' · ' : '') + cell.pick.price + ' cr'}
                        </span>
                      </span>
                      <span className="cell-name" title={pool.players[cell.pick.player]}>
                        {links ? <Link href={links.pilots + cell.pick.player}>{pool.players[cell.pick.player]}</Link> : pool.players[cell.pick.player]}
                      </span>
                    </>
                  )}
                  {(cell?.state === 'clock' || cell?.state === 'open') && (
                    <span className="cell-meta">
                      <b>{cell.n}</b>
                    </span>
                  )}
                  {cell?.state === 'clock' && <span className="cell-name">Picking</span>}
                  {cell?.state === 'skipped' && <span className="cell-name">Skipped</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {totals.map(([label, hint, value]) => (
            <tr key={label}>
              <th scope="row" title={hint} aria-label={hint}>
                {label}
              </th>
              {squads.map((t) => (
                <td key={t.id}>{value(t.id)}</td>
              ))}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

export function DraftBoard({
  pool,
  captain: own,
  operator = false,
  now,
  live,
  onMove,
  controls,
  auto = false,
  finished,
  summary = true,
  links,
}: {
  pool: DraftPool;
  // The squad the viewer captains
  captain?: string;
  // The viewer runs the league, and may act for any squad
  operator?: boolean;
  // The server's time when the page was made, so the clock does not depend on the viewer's own
  now?: number;
  live?: Live;
  onMove?: Action;
  // Extra buttons for the status strip, such as the mock draft's undo
  controls?: ReactNode;
  // The squad on the clock is being picked for automatically
  auto?: boolean;
  // The draft is over. Defaults to a draft that has ended with picks on record.
  finished?: boolean;
  // Whether a finished draft gets a status strip; a page that states the outcome itself turns it off
  summary?: boolean;
  links?: BoardLinks;
}) {
  const [sort, setSort] = useState<'salary' | 'name'>('salary');
  const [choice, setChoice] = useState<{ player: number; at: number } | null>(null);
  const d = pool.draft,
    lot = d?.lot;
  // An operator acts for the squad they choose; left alone, for whichever squad is on the clock
  const [actFor, setActFor] = useState('');
  const captain = operator && live ? actFor || own || d?.next : own;
  const over = !d && (finished ?? pool.picks.length > 0);
  // What a finished draft has to show: its picks, or failing that the squads it produced
  const outcome = pool.picks.length > 0 || pool.squads.some((t) => t.roster.some((id) => id !== t.captain));
  const evaluating = d && (captain ?? d.next);
  const canPick = !!d && captain === d.next && !lot && !auto;
  const budget = captain && d ? remainingBudget(pool, captain) : undefined;
  // What the squad may bid: its credits, less one held back for each further place it must fill
  const canSpend = captain && d ? spendable(pool, captain) : 0;
  const extra: Record<string, string> = {};
  if (operator && live && captain) extra.squad = captain;
  if (d && !lot) extra.turn = String(d.pick);
  const actionProps = { live, onMove, extra };
  const poolIds = available(pool).sort(
    (a, b) =>
      (sort === 'salary' && rated(pool) ? (pool.salaries[b] ?? -1) - (pool.salaries[a] ?? -1) : 0) ||
      pool.players[a].localeCompare(pool.players[b]),
  );
  // A choice only stands for the turn it was made on
  const selected =
    canPick && choice?.at === pool.picks.length && poolIds.includes(choice.player) ? choice.player : undefined;
  const verb = d?.format === 'auction' ? 'Nominate' : 'Pick';
  const upcoming: string[] = [];
  if (d?.format === 'regular')
    for (let turn = d.pick + 1; turn < d.pick + poolIds.length && upcoming.length < 8; turn++)
      upcoming.push(turnSquad(pool, turn));
  const lotStanding =
    lot && captain
      ? captain === lot.leader
        ? (operator && captain !== own ? 'This squad holds' : 'You hold') + ' the high bid.'
        : lot.passed.includes(captain)
          ? (operator && captain !== own ? 'This squad' : 'You') + ' passed on this pilot.'
          : blocked(pool, captain, lot.player)
            ? blocked(pool, captain, lot.player)!.brief + ' for your squad.'
            : canSpend <= lot.bid
              ? 'Not enough credits to raise.'
              : undefined
      : undefined;
  const canBid = lot && captain && captain !== lot.leader && !lot.passed.includes(captain);
  // On a wide screen the board and the pool take the height left under the status strip and scroll inside it,
  // so the page itself stays still. The floor keeps both usable in a short window.
  const columns = useRef<HTMLDivElement>(null);
  const fit = () => {
    const el = columns.current;
    if (!el) return;
    // A finished board has no pool beside it to keep in view, so it runs its full height
    if (!d) {
      el.style.setProperty('--room-height', 'none');
      return;
    }
    const below = parseFloat(getComputedStyle(el.closest('.shell') ?? document.body).paddingBottom) || 0;
    const room = window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - below;
    el.style.setProperty('--room-height', Math.max(352, Math.floor(room)) + 'px');
  };
  useLayoutEffect(fit);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div className="draft-room">
      {(d || (over && outcome && summary) || controls) && (
        <section className="draft-status" aria-label="Draft status">
          <div className="draft-status-main" aria-live="polite">
            {d && !lot && (
              <>
                <p className="eyebrow">
                  {d.format === 'regular'
                    ? 'Round ' + (Math.floor(d.pick / pool.squads.length) + 1) + ' · Pick ' + (pool.picks.length + 1) + ' of ' + (pool.picks.length + poolIds.length)
                    : 'Auction · ' + poolIds.length + ' pilots left'}
                </p>
                <h2>
                  <SquadName pool={pool} id={d.next} />
                  {d.format === 'regular' ? ' is on the clock' : ' nominates next'}
                  {auto && <small>Auto-pick</small>}
                  {live && own === d.next && <small>Your turn</small>}
                </h2>
              </>
            )}
            {lot && (
              <>
                <p className="eyebrow">On the block{rated(pool) && ' · Salary ' + pool.salaries[lot.player]}</p>
                <h2>{pool.players[lot.player]}</h2>
                <p>
                  High bid: {lot.bid} {lot.bid === 1 ? 'credit' : 'credits'} from <SquadName pool={pool} id={lot.leader} />
                </p>
              </>
            )}
            {over && outcome && (
              <>
                <p className="eyebrow">{pool.picks.length ? pool.picks.length + ' picks' : 'Pick order not recorded'}</p>
                <h2>Draft complete</h2>
              </>
            )}
            {d?.format === 'auction' && budget !== undefined && (
              <p>
                {operator && captain !== own ? pool.squads.find((t) => t.id === captain)?.name + ' has ' : 'Your squad has '}
                {budget} credits remaining{canSpend < budget && ', and can bid up to ' + canSpend}.
              </p>
            )}
            {d && live && !!pool.formation?.clock && (
              <DraftClock key={d.pick + ':' + (lot ? lot.player + ':' + lot.bid : '')} since={d.since ?? 0} seconds={pool.formation.clock} now={now} live={live} call={!!own || operator} lot={!!lot} />
            )}
            {lotStanding && <p>{lotStanding}</p>}
          </div>
          {upcoming.length > 0 && (
            <div className="draft-order">
              <span className="eyebrow">Up next</span>
              <ol>
                {upcoming.map((id, i) => {
                  const name = pool.squads.find((t) => t.id === id)!.name;
                  return (
                    <li key={i} data-hue={hue(pool, id)} title={name} aria-label={name}>
                      {initials(name)}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <div className="draft-actions">
            {selected !== undefined && d && (
              <>
                {d.format === 'regular' ? (
                  <DraftAction
                    {...actionProps}
                    action="pick"
                    weight="primary"
                    label={'Confirm ' + pool.players[selected]}
                    player={selected}
                  />
                ) : (
                  <DraftAction
                    key={selected}
                    {...actionProps}
                    action="nominate"
                    weight="primary"
                    label={'Nominate ' + pool.players[selected]}
                    bidLabel="Opening bid"
                    player={selected}
                    minimum={1}
                    limit={canSpend}
                  />
                )}
                <button type="button" className="quiet" onClick={() => setChoice(null)}>
                  Cancel
                </button>
              </>
            )}
            {canBid && !lotStanding && (
              <>
                {[1, 5]
                  .filter((step) => lot!.bid + step <= canSpend)
                  .map((step) => (
                    <DraftAction
                      key={lot!.bid + ':' + step}
                      {...actionProps}
                      action="bid"
                      weight={step === 1 ? 'primary' : 'default'}
                      label={'Bid ' + (lot!.bid + step)}
                      player={lot!.player}
                      amount={lot!.bid + step}
                    />
                  ))}
                <DraftAction
                  key={lot!.bid}
                  {...actionProps}
                  action="bid"
                  label="Raise bid"
                  player={lot!.player}
                  minimum={lot!.bid + 1}
                  limit={canSpend}
                />
              </>
            )}
            {canBid && (
              <DraftAction {...actionProps} action="passBid" label="Pass on this pilot" player={lot!.player} weight="default" />
            )}
            {canPick && selected === undefined && (
              <DraftAction {...actionProps} action="skipTurn" label="Skip this turn" weight="default" />
            )}
            {operator && live && d && (
              <label className="act-as">
                Acting for
                <select value={actFor} onChange={(e) => setActFor(e.target.value)}>
                  <option value="">{own ? 'My own squad' : 'The squad on the clock'}</option>
                  {pool.squads.filter((t) => t.id !== own).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            {controls}
          </div>
        </section>
      )}
      <div
        ref={columns}
        className={'draft-columns' + (d && poolIds.length ? '' : ' single')}
        style={{ ['--board-min' as string]: 'calc(3.75rem + ' + pool.squads.length + ' * 5.25rem)' }}
      >
        {(d || (over && outcome)) && (
          <section className="draft-picks">
            <h2>{over ? 'Draft results' : 'Draft board'}</h2>
            <PickBoard pool={pool} links={over ? links : undefined} />
            <SquadPicks pool={pool} initial={captain ?? d?.next} />
          </section>
        )}
        {!over && (poolIds.length > 0 || !d) && (
          <section className="draft-pool">
            <header className="draft-pool-head">
              <h2>Player pool</h2>
              {poolIds.length > 0 && <span className="roster-count">{poolIds.length} left</span>}
              {poolIds.length > 1 && rated(pool) && (
                <div className="sort-toggle" role="group" aria-label="Sort pilots by">
                  {(['salary', 'name'] as const).map((key) => (
                    <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>
                      {key === 'salary' ? 'Salary' : 'Name'}
                    </button>
                  ))}
                </div>
              )}
            </header>
            {poolIds.length ? (
              <ul className="pilot-cards">
                {poolIds.map((id) => {
                  let reason = evaluating ? blocked(pool, evaluating, id) : undefined;
                  if (lot) reason = undefined;
                  else if (!reason && d?.format === 'auction' && evaluating && spendable(pool, evaluating) < 1)
                    reason = { message: 'This squad has no credits left to open the bidding.', brief: 'Budget spent' };
                  const onBlock = lot?.player === id;
                  const state = onBlock ? 'lot' : reason ? 'blocked' : selected === id ? 'chosen' : undefined;
                  return (
                    <li key={id} className="pilot-card" data-state={state}>
                      <span className="pilot-name" title={pool.players[id]}>
                        {pool.players[id]}
                      </span>
                      {rated(pool) && (
                        <span className="pilot-salary" aria-label={'Salary ' + (pool.salaries[id] ?? 'unrated')}>
                          {pool.salaries[id] ?? '–'}
                        </span>
                      )}
                      {onBlock && <span className="pilot-note">On the block</span>}
                      {reason && (
                        <span className="pilot-note" title={reason.message}>
                          {reason.brief}
                        </span>
                      )}
                      {/* A captain's card always carries its button, so the cards keep their size between turns */}
                      {d && captain && !reason && !onBlock && (
                        <button
                          type="button"
                          disabled={!canPick}
                          aria-label={verb + ' ' + pool.players[id]}
                          aria-pressed={live || d!.format === 'auction' ? selected === id : undefined}
                          onClick={() =>
                            d!.format === 'regular' && !live
                              ? onMove!('pick', id, 0)
                              : setChoice({ player: id, at: pool.picks.length })
                          }
                        >
                          {verb}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No pilots are in the draft pool yet.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// Counts down the time a squad has to pick, or a bid has to be beaten. When it runs out, the browser of
// anyone entitled to act calls time, and the server does the rest once it agrees the time has passed.
function DraftClock({ since, seconds, now, live, call, lot }: { since: number; seconds: number; now?: number; live: Live; call: boolean; lot: boolean }) {
  // How far the viewer's clock is from the server's, taken once when the page arrives
  const [skew] = useState(() => (now ? now - Date.now() : 0));
  const [left, setLeft] = useState(() => Math.ceil((since + seconds * 1000 - (now ?? Date.now())) / 1000));
  const called = useRef(false);
  useEffect(() => {
    const tick = () => {
      const remaining = Math.ceil((since + seconds * 1000 - (Date.now() + skew)) / 1000);
      setLeft(remaining);
      if (remaining > 0 || called.current || !call) return;
      called.current = true;
      // Several browsers reach zero together; a short random wait lets one go first
      setTimeout(() => startTransition(() => void submitCommand('clockOut', live.id, live.revision, { message: '' }, new FormData())), 300 + Math.random() * 1200);
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [since, seconds, skew, call, live.id, live.revision]);
  const shown = Math.max(0, left);
  return (
    <p className="draft-clock" data-low={shown <= 10 ? 'true' : undefined} role="timer">
      <b>{Math.floor(shown / 60)}:{String(shown % 60).padStart(2, '0')}</b>
      {shown > 0 ? (lot ? ' to beat this bid' : ' to pick') : lot ? ' Sold' : ' Time is up'}
    </p>
  );
}
