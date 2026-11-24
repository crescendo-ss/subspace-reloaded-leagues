// Turns a playoff graph into what a bracket drawing needs: lanes of columns, a grid position for each
// series, who stands in each slot, and the connectors between rounds. It reads only the graph (each series
// names the seeds or earlier series it draws from), so any structure built that way can be drawn:
// single or double elimination, any number of seeds, with byes.
import type { Series } from './types.ts';

export type BracketNode = Pick<Series, 'id' | 'stage' | 'round' | 'sources' | 'winner' | 'score' | 'skipped'>;
export type BracketSlot =
  | { kind: 'squad'; id: string }
  | { kind: 'bye' }
  // Waits on the winner or loser of the numbered series
  | { kind: 'pending'; take: 'winner' | 'loser'; series: number };
export type BracketCard = {
  node: BracketNode;
  column: number;
  // First and last grid row, counted from 1
  rows: [number, number];
  slots: BracketSlot[];
  // A series is contested; a bye passes one squad through; an empty node is not drawn
  kind: 'series' | 'bye' | 'empty';
  number?: number;
  winner?: string;
};
// A connector in the gap after `column`. `down` and `up` leave the upper and lower of two feeders and meet;
// `in` enters the series they feed; `flat` joins a single feeder straight across.
export type BracketLink = { column: number; rows: [number, number]; turn: 'flat' | 'down' | 'up' | 'in' };
export type BracketLane = {
  key: 'main' | 'lower';
  title: string;
  columns: { stage: string; round: number; title: string }[];
  rowCount: number;
  cards: BracketCard[];
  links: BracketLink[];
};

// Seeds by bracket position: 1 meets the lowest seed, and 1 and 2 can only meet in the final.
export function seedOrder(count: number) {
  let order = [1, 2];
  while (order.length < count) {
    const size = 2 * order.length;
    order = order.flatMap((n) => [n, size + 1 - n]);
  }
  return order;
}

// Named from the end of its stage, so a bracket of any size finishes with the same titles
function roundTitle(stage: string, index: number, rounds: number, double: boolean) {
  if (stage === 'Final') return 'Grand final';
  if (stage === 'Reset') return 'Deciding final';
  if (stage === 'Lower') return index === rounds - 1 ? 'Losers’ final' : 'Round ' + (index + 1);
  if (index === rounds - 1) return double ? 'Winners’ final' : 'Final';
  return index === rounds - 2 ? 'Semifinals' : index === rounds - 3 ? 'Quarterfinals' : 'Round ' + (index + 1);
}

// What a series is called outside the bracket: "Final", "Semifinals", or its round within the playoffs
// The series that decided the title: the last one that was played and has a winner. In double elimination
// the deciding series is skipped when the unbeaten finalist wins the final, so it is not simply the last.
export const titleSeries = <T extends { id: string; winner?: string | null; skipped?: boolean }>(series: T[]) =>
  series.filter((node) => !node.skipped && node.winner).at(-1);
export function seriesTitle(nodes: Pick<Series, 'id' | 'stage' | 'round'>[], id: string) {
  const node = nodes.find((n) => n.id === id);
  if (!node) return null;
  const double = nodes.some((n) => n.stage === 'Lower');
  const rounds = Math.max(...nodes.filter((n) => n.stage === node.stage).map((n) => n.round));
  const title = roundTitle(node.stage, node.round - 1, rounds, double);
  if (!title.startsWith('Round ')) return title;
  return (node.stage === 'Lower' ? 'Losers’ bracket, ' : double ? 'Winners’ bracket, ' : 'Playoffs, ') + title.toLowerCase();
}

export function layoutBracket(nodes: BracketNode[]): BracketLane[] {
  const double = nodes.some((n) => n.stage === 'Lower');
  const laneOf = (n: BracketNode) => (n.stage === 'Lower' ? 'lower' : 'main');
  const lanes = new Map<string, BracketLane>();
  const cards = new Map<string, BracketCard & { lane: string }>();
  const outcomes = new Map<string, { winner: BracketSlot; loser: BracketSlot }>();
  const leaves = new Map<string, number>();
  const feeding = new Map<string, BracketCard[]>();
  let contested = 0;
  for (const node of nodes) {
    const key = laneOf(node);
    if (!lanes.has(key))
      lanes.set(key, {
        key,
        title: key === 'lower' ? 'Losers’ bracket' : double ? 'Winners’ bracket and final' : 'Bracket',
        columns: [],
        rowCount: 0,
        cards: [],
        links: [],
      });
    const lane = lanes.get(key)!;
    let column = lane.columns.findIndex((c) => c.stage === node.stage && c.round === node.round);
    if (column < 0) column = lane.columns.push({ stage: node.stage, round: node.round, title: '' }) - 1;
    // Who stands in each slot, following byes and decided series through the graph
    const slots = node.sources.map<BracketSlot>((ref) =>
      'seed' in ref ? (ref.seed ? { kind: 'squad', id: ref.seed } : { kind: 'bye' }) : outcomes.get(ref.node)![ref.take],
    );
    const squads = slots.filter((slot) => slot.kind === 'squad');
    const byes = slots.filter((slot) => slot.kind === 'bye').length;
    let kind: BracketCard['kind'] = 'series';
    let winner: string | undefined;
    if (node.skipped) {
      kind = 'empty';
      outcomes.set(node.id, { winner: { kind: 'bye' }, loser: { kind: 'bye' } });
    } else if (byes) {
      // The other slot passes straight through. Only a known squad is worth drawing as a bye.
      const through = slots.find((slot) => slot.kind !== 'bye') ?? { kind: 'bye' };
      kind = through.kind === 'squad' ? 'bye' : 'empty';
      outcomes.set(node.id, { winner: through, loser: { kind: 'bye' } });
    } else {
      const number = ++contested;
      if (squads.length === 2 && node.winner && squads.some((slot) => slot.id === node.winner)) {
        winner = node.winner;
        outcomes.set(node.id, { winner: squads.find((slot) => slot.id === winner)!, loser: squads.find((slot) => slot.id !== winner)! });
      } else
        outcomes.set(node.id, {
          winner: { kind: 'pending', take: 'winner', series: number },
          loser: { kind: 'pending', take: 'loser', series: number },
        });
    }
    // A series sits level with the middle of the series in its own lane that feed it
    const feeders = [...new Set(node.sources.flatMap((ref) => ('node' in ref ? [ref.node] : [])))]
      .map((id) => cards.get(id)!)
      .filter((card) => card.lane === key)
      .sort((x, y) => x.rows[0] - y.rows[0]);
    let rows: [number, number];
    if (feeders.length) rows = [Math.min(...feeders.map((f) => f.rows[0])), Math.max(...feeders.map((f) => f.rows[1]))];
    else {
      const row = (leaves.get(key) ?? 0) + 1;
      leaves.set(key, row);
      rows = [row, row];
    }
    lane.rowCount = Math.max(lane.rowCount, rows[1]);
    const card = { node, column, rows, slots, kind, number: kind === 'series' ? contested : undefined, winner, lane: key };
    cards.set(node.id, card);
    lane.cards.push(card);
    feeding.set(node.id, feeders);
  }
  for (const lane of lanes.values()) {
    // A round where every series was a bye has nothing to draw, so its column goes
    const kept = lane.columns.map((_, i) => lane.cards.some((card) => card.column === i && card.kind !== 'empty'));
    const moved = kept.map((_, i) => kept.slice(0, i).filter(Boolean).length);
    lane.columns = lane.columns.filter((_, i) => kept[i]);
    for (const card of lane.cards) card.column = moved[card.column];
    for (const [i, column] of lane.columns.entries()) {
      const stage = lane.columns.filter((c) => c.stage === column.stage);
      column.title = roundTitle(column.stage, stage.indexOf(column), stage.length, double);
      lane.columns[i] = column;
    }
    for (const card of lane.cards) {
      if (card.kind === 'empty') continue;
      const feeders = feeding.get(card.node.id)!;
      const drawn = feeders.filter((f) => f.kind !== 'empty' && f.column === card.column - 1);
      for (const feeder of drawn)
        lane.links.push({
          column: feeder.column,
          rows: feeder.rows,
          turn: feeders.length === 1 ? 'flat' : feeder === feeders[0] ? 'down' : 'up',
        });
      if (drawn.length && feeders.length > 1) lane.links.push({ column: card.column - 1, rows: card.rows, turn: 'in' });
    }
  }
  return [...lanes.values()];
}
