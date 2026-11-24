import type { Season } from './types.ts';

// Where a season stands. Every page that says so, or decides what to offer, reads this one value.
//   signups   pilots are signing up and no squad exists
//   forming   squads exist, by whatever method, and there is no schedule yet
//   draft     a live draft is running
//   regular   the regular season is being played
//   seeding   every regular-season match has a result and the playoffs have not been seeded
//   playoffs  the bracket is being played
//   complete  there is a champion
//   closed    an operator ended it without one
export type Phase = 'signups' | 'forming' | 'draft' | 'regular' | 'seeding' | 'playoffs' | 'complete' | 'closed';
type Phased = Pick<Season, 'champion' | 'closed' | 'draft' | 'enlistedOpen'> & {
  bracket: unknown[];
  squads: unknown[];
  matches: { series: string | null; result: unknown }[];
};
export function seasonPhase(s: Phased): Phase {
  if (s.champion) return 'complete';
  if (s.closed) return 'closed';
  if (s.bracket.length) return 'playoffs';
  const regular = s.matches.filter((m) => !m.series);
  if (regular.length) return regular.every((m) => m.result) ? 'seeding' : 'regular';
  if (s.draft) return 'draft';
  return s.squads.length ? 'forming' : 'signups';
}
export const phaseLabels: Record<Phase, string> = {
  signups: 'Sign-ups',
  forming: 'Squads forming',
  draft: 'Draft in progress',
  regular: 'Regular season',
  seeding: 'Regular season complete',
  playoffs: 'Playoffs',
  complete: 'Season complete',
  closed: 'Season closed',
};
// A pilot may sign up while sign-ups are open, outside a live draft, in a season that is not over. This is
// the rule the sign-up command applies.
export const canSignUp = (s: Phased) => s.enlistedOpen && !s.draft && !s.champion && !s.closed;
