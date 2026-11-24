// Automated picking for squads nobody is controlling. The mock draft uses these for every squad
// except the one the visitor drafts for. Add an entry here to offer another algorithm.
import { available, ineligible, type DraftPool } from './draft.ts';

export type AutoPicker = {
  label: string;
  // The pilot to take for this squad, or undefined to skip the turn.
  choose: (pool: DraftPool, squad: string) => number | undefined;
};
export const autoPickers: Record<string, AutoPicker> = {
  best: {
    label: 'Best player available',
    // Salary is the league's rating of a pilot, so the best available is the highest salary the squad may take.
    choose: (pool, squad) =>
      available(pool)
        .filter((id) => !ineligible(pool, squad, id))
        .sort((a, b) => (pool.salaries[b] ?? 0) - (pool.salaries[a] ?? 0) || pool.players[a].localeCompare(pool.players[b]))[0],
  },
};
export const defaultAutoPicker = 'best';
