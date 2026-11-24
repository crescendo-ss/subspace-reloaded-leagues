// Shared by the authoritative live draft and the browser's private mock draft.
import type { Squad } from './types.ts';

export type DraftFormat = 'regular' | 'auction';
// `turn` is the draft turn a regular pick was made on, so the board can place it in its round. `at` is the
// turn an auction lot was nominated on, which is what undoing it goes back to.
export type Pick = { squad: string; player: number; salary: number; price?: number; turn?: number; at?: number };
// Pick orders for a regular draft: the seat that acts on a turn. Squads stand in draft order, so a seat is
// an index into them. Add an entry to offer another order.
export const orders: Record<string, { label: string; seat: (turn: number, seats: number) => number }> = {
  snake: {
    label: 'Snake',
    seat: (turn, seats) => (Math.floor(turn / seats) % 2 ? seats - 1 - (turn % seats) : turn % seats),
  },
  linear: { label: 'Same order each round', seat: (turn, seats) => turn % seats },
};
export interface Draft {
  format: DraftFormat;
  pick: number;
  next: string;
  budget: number;
  order: string;
  skips: number;
  lot: { player: number; bid: number; leader: string; passed: string[] } | null;
  // When the squad on the clock, or the standing bid, began waiting
  since?: number;
}
// What a league has decided about its draft. A rule left out does not apply.
export interface DraftRules {
  // Pilots carry salaries. Without them a draft needs none and no salary rule applies.
  salaries?: boolean;
  // A squad's opening picks share a salary cap
  cap?: { picks: number; salary: number } | null;
  // Pilots per squad, captain included. A full squad takes no further part.
  squadSize?: number;
  // Seconds a squad has to pick, or a bid has to be beaten
  clock?: number;
}
export interface DraftPool {
  squads: Squad[];
  players: Record<number, string>;
  salaries: Record<number, number>;
  picks: Pick[];
  draft: Draft | null;
  formation?: DraftRules;
  // A draft that has ended, kept so an operator can reopen it
  lastDraft?: Draft | null;
}
// Why a squad may not take a pilot: the sentence a refused move is answered with, and a few words for a
// pilot's card. Nothing reads the wording to decide what to do.
export type Block = { message: string; brief: string };
// A league's own rule may answer with a sentence alone; its short form is then the sentence
export type PickValidator = (pool: DraftPool, squad: string, player: number) => string | Block | undefined;
// Whether pilots carry salaries in this league
export const rated = (pool: { formation?: DraftRules }) => pool.formation?.salaries !== false;
export const pickValidators: PickValidator[] = [
  (pool, squad, player) => {
    const cap = pool.formation?.cap;
    if (!cap || !rated(pool)) return;
    const picks = pool.picks.filter((p) => p.squad === squad);
    if (picks.length < cap.picks && picks.reduce((sum, p) => sum + p.salary, pool.salaries[player]) > cap.salary)
      return {
        brief: 'Over cap',
        message: cap.picks === 1
          ? 'A squad’s first pick may have at most ' + cap.salary + ' salary.'
          : 'First ' + cap.picks + ' picks may total at most ' + cap.salary + ' salary.',
      };
  },
];
function requireDraft(value: unknown, message: string, status = 400): asserts value {
  if (!value) throw Object.assign(new Error(message), { status });
}
export function available(pool: DraftPool) {
  const rostered = new Set(pool.squads.flatMap((s) => s.roster));
  return Object.keys(pool.players)
    .map(Number)
    .filter((id) => !rostered.has(id));
}
// Places a squad still has to fill. Without a squad size there is no limit.
export function placesLeft(pool: DraftPool, squad: string) {
  const size = pool.formation?.squadSize;
  const roster = pool.squads.find((t) => t.id === squad)?.roster.length ?? 0;
  return size ? Math.max(0, size - roster) : Infinity;
}
export function remainingBudget(pool: DraftPool, squad: string) {
  return (
    (pool.draft?.budget ?? 0) -
    pool.picks.filter((p) => p.squad === squad).reduce((sum, p) => sum + (p.price ?? 0), 0)
  );
}
// What a squad may bid: its credits, less one held back for each further place it has to fill
export function spendable(pool: DraftPool, squad: string) {
  const left = placesLeft(pool, squad);
  return remainingBudget(pool, squad) - (Number.isFinite(left) ? Math.max(0, left - 1) : 0);
}
export function blocked(pool: DraftPool, squad: string, player: number): Block | undefined {
  if (!Object.hasOwn(pool.players, player) || pool.squads.some((s) => s.roster.includes(player)))
    return { message: 'Already selected or outside the pool.', brief: 'Already selected' };
  if (!placesLeft(pool, squad)) return { message: 'Squad is full.', brief: 'Squad full' };
  if (rated(pool) && !Number.isSafeInteger(pool.salaries[player])) return { message: 'Awaiting salary.', brief: 'No salary' };
  for (const rule of pickValidators) {
    const reason = rule(pool, squad, player);
    if (reason) return typeof reason === 'string' ? { message: reason, brief: reason.replace(/\.$/, '') } : reason;
  }
}
// The sentence alone, for refusing a move
export const ineligible = (pool: DraftPool, squad: string, player: number) => blocked(pool, squad, player)?.message;
export function startDraft(pool: DraftPool, format: string, budget: number, order = 'snake') {
  requireDraft(
    !pool.draft && !pool.picks.length && pool.squads.length >= 2 && available(pool).length,
    'A draft needs two squads and available pilots.',
  );
  requireDraft(Object.hasOwn(orders, order), 'Choose a supported pick order.');
  requireDraft(format === 'regular' || format === 'auction', 'Choose a supported draft format.');
  requireDraft(Number.isSafeInteger(budget) && budget > 0, 'Enter a positive whole-number budget.');
  requireDraft(
    !rated(pool) || available(pool).every((id) => Number.isSafeInteger(pool.salaries[id])),
    'Set a salary for every available pilot first.',
  );
  requireDraft(pool.squads.some((t) => placesLeft(pool, t.id) > 0), 'Every squad is already full.');
  pool.draft = { format, pick: 0, next: pool.squads[0].id, order, budget, skips: 0, lot: null, since: Date.now() };
  pool.lastDraft = null;
  seat(pool);
}
// The squad that acts on a turn
export function turnSquad(pool: DraftPool, turn: number) {
  const d = pool.draft!,
    seats = pool.squads.length;
  return pool.squads[d.format === 'regular' ? (orders[d.order] ?? orders.linear).seat(turn, seats) : turn % seats].id;
}
// Settle on the turn in hand, passing over squads that are full. They have no turn.
function seat(pool: DraftPool) {
  const d = pool.draft!;
  for (let passed = 0; passed <= pool.squads.length * 2; passed++, d.pick++) {
    d.next = turnSquad(pool, d.pick);
    if (placesLeft(pool, d.next)) break;
  }
  d.since = Date.now();
}
// A draft is over when the pool is empty, every squad is full, or every squad has skipped in a row.
// `used` says whether the turn in hand was taken, so a reopened draft starts in the right place.
function end(pool: DraftPool, used: boolean) {
  const d = pool.draft!;
  pool.lastDraft = { ...d, lot: null, skips: 0, pick: d.pick + Number(used) };
  pool.draft = null;
}
export function endDraft(pool: DraftPool) {
  requireDraft(pool.draft && !pool.draft.lot, 'Finish the current auction before closing the draft.');
  end(pool, false);
}
// An operator reopens a draft that ended, at the turn it had reached
export function resumeDraft(pool: DraftPool) {
  requireDraft(!pool.draft && pool.lastDraft, 'There is no finished draft to reopen.');
  pool.draft = { ...pool.lastDraft, lot: null, skips: 0 };
  pool.lastDraft = null;
  seat(pool);
}
// Takes back the last pick: the pilot returns to the pool and the turn it was made on comes round again
export function undoPick(pool: DraftPool) {
  requireDraft(!pool.draft?.lot, 'Finish the current auction first.');
  const last = pool.picks.at(-1);
  requireDraft(last, 'There is no pick to take back.');
  if (!pool.draft) resumeDraft(pool);
  const d = pool.draft!;
  pool.picks.pop();
  const team = pool.squads.find((t) => t.id === last.squad);
  if (team) team.roster = team.roster.filter((id) => id !== last.player);
  d.pick = last.turn ?? last.at ?? Math.max(0, d.pick - 1);
  d.skips = 0;
  seat(pool);
}
function advanceTurn(pool: DraftPool, skipped: boolean) {
  const d = pool.draft!;
  d.lot = null;
  d.skips = skipped ? d.skips + 1 : 0;
  // A snake reverses at each end, so a full two rounds visits every squad.
  if (
    !available(pool).length ||
    !pool.squads.some((t) => placesLeft(pool, t.id) > 0) ||
    d.skips >= pool.squads.length * (d.format === 'regular' && d.order === 'snake' ? 2 : 1)
  ) {
    end(pool, true);
    return;
  }
  d.pick++;
  seat(pool);
}
function award(pool: DraftPool, squad: string, player: number, price?: number) {
  const reason = ineligible(pool, squad, player);
  requireDraft(!reason, reason ?? '');
  pool.squads.find((t) => t.id === squad)!.roster.push(player);
  const pick: Pick = { squad, player, salary: pool.salaries[player] ?? 0, price };
  if (pool.draft!.format === 'regular') pick.turn = pool.draft!.pick;
  else pick.at = pool.draft!.pick;
  pool.picks.push(pick);
  advanceTurn(pool, false);
}
// The clock has run out. A standing bid wins its lot; a squad that has not picked is picked for by
// `choose`, or skipped when that offers no one. Anyone at the draft may call time: it only succeeds once
// the time has really passed.
export function clockOut(pool: DraftPool, choose: (pool: DraftPool, squad: string) => number | undefined) {
  const d = pool.draft,
    clock = pool.formation?.clock;
  requireDraft(d && clock, 'This draft has no clock.');
  requireDraft(Date.now() - (d.since ?? 0) >= clock * 1000, 'The clock is still running.', 409);
  if (d.lot) return award(pool, d.lot.leader, d.lot.player, d.lot.bid);
  const player = d.format === 'regular' ? choose(pool, d.next) : undefined;
  if (player === undefined) advanceTurn(pool, true);
  else award(pool, d.next, player);
}
export type DraftMove = 'pick' | 'nominate' | 'bid' | 'passBid' | 'skipTurn';
export function move(pool: DraftPool, squad: string, action: DraftMove, player = 0, amount = 0) {
  const d = pool.draft;
  requireDraft(d && pool.squads.some((t) => t.id === squad), 'Only a participating captain can act.', 403);
  if (!d.lot) {
    requireDraft(squad === d.next, 'Wait for your squad’s turn.', 403);
    if (action === 'skipTurn') {
      advanceTurn(pool, true);
      return;
    }
    const reason = ineligible(pool, squad, player);
    requireDraft(!reason, reason ?? '');
    if (d.format === 'regular') {
      requireDraft(action === 'pick', 'Select a pilot.');
      award(pool, squad, player);
      return;
    }
    requireDraft(action === 'nominate', 'Nominate a pilot.');
    requireDraft(
      Number.isSafeInteger(amount) && amount >= 1 && amount <= spendable(pool, squad),
      'Opening bid must be within what your squad can spend.',
    );
    d.lot = { player, bid: amount, leader: squad, passed: [] };
    d.since = Date.now();
  } else {
    const lot = d.lot;
    requireDraft(lot.player === player, 'The auction has moved to another pilot.');
    requireDraft(
      lot.leader !== squad && !lot.passed.includes(squad),
      'You lead or have passed on this pilot.',
    );
    if (action === 'passBid') lot.passed.push(squad);
    else {
      requireDraft(action === 'bid', 'Bid or pass on the nominated pilot.');
      const reason = ineligible(pool, squad, player);
      requireDraft(!reason, reason ?? '');
      requireDraft(
        Number.isSafeInteger(amount) && amount > lot.bid && amount <= spendable(pool, squad),
        'Raise the bid within what your squad can spend.',
      );
      lot.bid = amount;
      lot.leader = squad;
      d.since = Date.now();
    }
  }
  const lot = d.lot;
  const challengers = pool.squads.some(
    (t) =>
      t.id !== lot.leader &&
      !lot.passed.includes(t.id) &&
      spendable(pool, t.id) > lot.bid &&
      !ineligible(pool, t.id, lot.player),
  );
  if (!challengers) award(pool, lot.leader, lot.player, lot.bid);
}
