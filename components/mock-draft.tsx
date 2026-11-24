'use client';
// The mock draft: a private draft in the visitor's own browser, run by the same engine as the live one.
// Nothing here is sent to the server.
import { useEffect, useState } from 'react';
import { startDraft, move, type DraftPool, type DraftFormat, type DraftMove } from '@/src/draft';
import { autoPickers, defaultAutoPicker } from '@/src/autopick';
import { DraftBoard } from './draft-room';

type Setup = { format: DraftFormat; budget: number; order: string; seat: string; picker: string };
// The squad that should answer the current lot, or the squad on the clock
const bidder = (pool: DraftPool, fallback: string) =>
  pool.draft?.lot
    ? (pool.squads.find((t) => t.id !== pool.draft!.lot!.leader && !pool.draft!.lot!.passed.includes(t.id))?.id ??
      fallback)
    : (pool.draft?.next ?? '');
export function MockDraft({ initial, practice }: { initial: DraftPool; practice: boolean }) {
  const [setup, setSetup] = useState<Setup>({
    format: 'regular',
    budget: 100,
    order: 'snake',
    seat: initial.squads[0]?.id ?? '',
    picker: defaultAutoPicker,
  });
  const [format, setFormat] = useState<DraftFormat>(setup.format);
  const [pool, setPool] = useState<DraftPool | null>(null),
    [history, setHistory] = useState<DraftPool[]>([]),
    [actor, setActor] = useState(''),
    [error, setError] = useState('');
  // In a regular draft the visitor may hold one seat while the other squads pick automatically
  const seat = setup.format === 'regular' ? setup.seat : '';
  const d = pool?.draft;
  const auto = !!(d && seat && d.next !== seat);
  const captain = d?.lot ? actor : seat || d?.next;
  function start(next: Setup) {
    const fresh = structuredClone(initial);
    try {
      startDraft(fresh, next.format, next.budget, next.order);
      setSetup(next);
      setPool(fresh);
      setHistory([]);
      setActor(fresh.draft!.next);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function act(cmd: DraftMove, player: number, amount: number) {
    if (!pool || !captain) return;
    const next = structuredClone(pool);
    try {
      move(next, captain, cmd, player, amount);
      setHistory([...history, pool]);
      setPool(next);
      setActor(bidder(next, captain));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setPool(previous);
    setHistory(history.slice(0, -1));
    setActor(bidder(previous, actor));
    setError('');
  }
  useEffect(() => {
    if (!pool || !auto) return;
    // A short beat between automatic picks, so each one can be followed on the board
    const timer = setTimeout(() => {
      const next = structuredClone(pool),
        squad = next.draft!.next;
      const pick = (autoPickers[setup.picker] ?? autoPickers[defaultAutoPicker]).choose(next, squad);
      try {
        move(next, squad, pick === undefined ? 'skipTurn' : 'pick', pick);
      } catch {
        move(next, squad, 'skipTurn');
      }
      setPool(next);
    }, 450);
    return () => clearTimeout(timer);
  }, [pool, auto, setup.picker]);
  const pickers = Object.entries(autoPickers);
  return (
    <>
      {!pool ? (
        <section className="panel framed mock-panel">
        <div className="panel-head">
          <h2>Set up a practice draft<small>{practice ? 'Practice squads and example salaries' : 'This season’s captains and rated pilots'}</small></h2>
        </div>
        <div className="panel-body">
        <form
          className="form-grid mock-setup"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start({
              format,
              budget: f.has('budget') ? Number(f.get('budget')) : setup.budget,
              order: String(f.get('order') ?? setup.order),
              seat: String(f.get('seat') ?? setup.seat),
              picker: String(f.get('picker') ?? setup.picker),
            });
          }}
        >
          <label>
            Format
            <select name="format" value={format} onChange={(e) => setFormat(e.target.value as DraftFormat)}>
              <option value="regular">Regular</option>
              <option value="auction">Auction</option>
            </select>
          </label>
          {format === 'regular' ? (
            <>
              <label>
                Pick order
                <select name="order" defaultValue={setup.order}>
                  <option value="snake">Snake</option>
                  <option value="linear">Same order each round</option>
                </select>
              </label>
              <label>
                You draft for
                <select name="seat" defaultValue={setup.seat}>
                  {initial.squads.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value="">Every squad</option>
                </select>
              </label>
              {pickers.length > 1 && (
                <label>
                  Other squads pick
                  <select name="picker" defaultValue={setup.picker}>
                    {pickers.map(([key, picker]) => (
                      <option key={key} value={key}>
                        {picker.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <label>
              Credits per squad
              <input name="budget" type="number" min={1} defaultValue={setup.budget} required />
            </label>
          )}
          <button className="primary">Start mock draft</button>
        </form>
        <p className="mock-note">
          {format === 'regular'
            ? pickers.length === 1 ? 'Squads you are not drafting for pick automatically: ' + pickers[0][1].label.toLowerCase() + '.' : 'Squads you are not drafting for pick automatically.'
            : 'In an auction you bid for every squad in turn.'}
          {' '}Nothing here is saved, and leaving the page ends the practice session.
        </p>
        </div>
        </section>
      ) : (
        <DraftBoard
          pool={pool}
          captain={captain}
          onMove={act}
          auto={auto}
          controls={
            <>
              {pool.draft?.lot && (
                <label className="act-as">
                  Act as
                  <select value={actor} onChange={(e) => setActor(e.target.value)}>
                    {pool.squads.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!pool.draft && (
                <button type="button" className="primary" onClick={() => start(setup)}>
                  Run it again
                </button>
              )}
              <button type="button" onClick={undo} disabled={!history.length}>
                Undo
              </button>
              <button
                type="button"
                title="Ends this practice session and returns to the setup"
                onClick={() => {
                  setPool(null);
                  setError('');
                }}
              >
                Change setup
              </button>
            </>
          }
        />
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </>
  );
}
