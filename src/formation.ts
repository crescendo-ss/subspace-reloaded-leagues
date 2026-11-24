import type { Formation, Season } from './types.ts';

// How a season turns its signed-up pilots into squads. A season names one method, and the pages offer the
// tools that method needs and nothing else. Add an entry to offer another.
//   live     squads are picked in the draft room: captains are appointed first
//   instant  the site deals the pilots in one step, and makes the squads itself
//   manual   the operators enter the squads
export type MethodKind = 'live' | 'instant' | 'manual';
export interface FormationMethod {
  label: string;
  // One line a pilot reads before signing up
  summary: string;
  kind: MethodKind;
  // For a live method, the draft it opens
  draft?: { format: 'regular' | 'auction'; order?: string };
  // For an instant method, the strategy that deals the pilots: a key of `formations`
  deal?: string;
}
export const methods: Record<string, FormationMethod> = {
  snake: {
    label: 'Snake draft',
    summary: 'Captains pick in turn, and the order reverses each round',
    kind: 'live',
    draft: { format: 'regular', order: 'snake' },
  },
  captains: {
    label: 'Captains’ draft',
    summary: 'Captains pick in turn, in the same order every round',
    kind: 'live',
    draft: { format: 'regular', order: 'linear' },
  },
  auction: {
    label: 'Auction draft',
    summary: 'Captains bid credits for each pilot',
    kind: 'live',
    draft: { format: 'auction' },
  },
  random: { label: 'Random teams', summary: 'Pilots are dealt into squads at random', kind: 'instant', deal: 'random' },
  balanced: {
    label: 'Balanced teams',
    summary: 'Pilots are dealt into squads by salary, so the squads are even',
    kind: 'instant',
    deal: 'balanced',
  },
  manual: { label: 'Preset squads', summary: 'The league’s operators set the squads', kind: 'manual' },
};
export const defaultMethod = 'snake';
export const methodOf = (s: { formation?: Formation }) => methods[s.formation?.method ?? ''] ?? methods[defaultMethod];
// A new season's formation: the method asked for, with the options every method starts from
export function formation(method: unknown = defaultMethod): Formation {
  return { method: typeof method === 'string' && Object.hasOwn(methods, method) ? method : defaultMethod, salaries: true, cap: null, credits: 100 };
}
// A season stored before formation was recorded: the method its record shows, and the rules every draft
// ran under then, so nothing about it changes.
export function inferFormation(s: Pick<Season, 'picks' | 'draft' | 'squads' | 'matches' | 'draftFinished'>): Formation {
  const method = s.draft
    ? s.draft.format === 'auction' ? 'auction' : s.draft.order === 'linear' ? 'captains' : 'snake'
    : s.picks.some((pick) => pick.price !== undefined)
      ? 'auction'
      : s.picks.length || !s.squads.length || !(s.matches.length || s.draftFinished)
        ? 'snake'
        : 'manual';
  return { method, salaries: true, cap: { picks: 3, salary: 30 }, credits: s.draft?.budget ?? 100 };
}

// Strategies that deal free pilots onto squads that already exist. Each receives a copy of the season and
// returns an assignment for every free pilot. Captains and existing rosters stay in place.
export interface Dealer {
  label: string;
  assign(season: Season, pilots: number[]): { player: number; squad: string }[];
}
// Random numbers from the platform's own source, which the server and a browser both have
const randomInt = (below: number) => crypto.getRandomValues(new Uint32Array(1))[0] % below;
export function shuffle<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
// Each pilot in turn goes to the squad with the fewest pilots; among those, the one `lightest` prefers
function distribute(season: Season, pilots: number[], weight: (id: number) => number = () => 0) {
  const squads = season.squads.map((t) => ({ id: t.id, size: t.roster.length, weight: t.roster.reduce((sum, id) => sum + weight(id), 0) }));
  return pilots.map((player) => {
    const target = squads.reduce((best, t) => (t.size < best.size || (t.size === best.size && t.weight < best.weight) ? t : best));
    target.size++;
    target.weight += weight(player);
    return { player, squad: target.id };
  });
}
export const formations = new Map<string, Dealer>([
  ['random', { label: 'At random', assign: (season, pilots) => distribute(season, shuffle(pilots)) }],
  [
    'balanced',
    {
      label: 'Balanced by salary',
      // The highest salaries are placed first, each on the squad that has the least so far
      assign(season, pilots) {
        const salary = (id: number) => season.salaries[id] ?? 0;
        const dealt = distribute(season, pilots.sort((a, b) => salary(b) - salary(a) || season.players[a].localeCompare(season.players[b])), salary);
        // Then any two dealt pilots change places while that brings the squads' totals closer together.
        // Squad sizes, captains and pilots already placed are not touched.
        const total = new Map(season.squads.map((t) => [t.id, t.roster.reduce((sum, id) => sum + salary(id), 0)]));
        for (const pick of dealt) total.set(pick.squad, total.get(pick.squad)! + salary(pick.player));
        for (let improved = true, passes = 0; improved && passes < 50; passes++) {
          improved = false;
          for (const a of dealt)
            for (const b of dealt) {
              const gap = total.get(a.squad)! - total.get(b.squad)!,
                move = salary(a.player) - salary(b.player);
              // Swapping moves `move` from a's squad to b's: worth it when that narrows the gap between them
              if (a.squad === b.squad || move <= 0 || Math.abs(gap - 2 * move) >= Math.abs(gap)) continue;
              total.set(a.squad, total.get(a.squad)! - move);
              total.set(b.squad, total.get(b.squad)! + move);
              [a.squad, b.squad] = [b.squad, a.squad];
              improved = true;
            }
        }
        return dealt;
      },
    },
  ],
  // Fills the squads to even numbers in the order pilots signed up
  ['even', { label: 'Even numbers, in sign-up order', assign: (season, pilots) => distribute(season, pilots) }],
]);
