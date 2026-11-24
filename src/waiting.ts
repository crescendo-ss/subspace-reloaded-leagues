import { retryable } from './attempts.ts';
import type { Actor } from './types.ts';

// What is waiting on the person signed in, in one season: for a captain, a proposed time to answer, a match
// that still needs a time, a trade offered to them; for an operator, a match that needs a ruling and a trade
// to approve. `path` is the page where it is dealt with, under the season's own address.
export type Waiting = { key: string; text: string; path: string };
// Only what the answer depends on, so a season as stored and a season as shown both fit
type Watched = {
  closed?: boolean;
  squads: { id: string; name: string; captain: number }[];
  trades: { id: string; state: string; squads: string[] }[];
  matches: {
    id: string;
    number?: number;
    home: string;
    away: string;
    round: number;
    series: string | null;
    result: unknown;
    proposal: { by: string } | null;
    attempts: { state: string; resolution?: string | null; needsReview?: boolean }[];
  }[];
};
export function waitingOn(s: Watched, actor: Pick<Actor, 'id' | 'operator'> | null): Waiting[] {
  if (!actor || s.closed) return [];
  const out: Waiting[] = [];
  const name = (id: string) => s.squads.find((t) => t.id === id)?.name ?? 'the other squad';
  const page = (m: Watched['matches'][number]) => '/matches/' + m.number;
  const mine = s.squads.find((t) => t.captain === actor.id);
  if (mine) {
    // Only the earliest match without a time is named, or a new season would list every one of them
    let needsTime = false;
    for (const m of [...s.matches].sort((a, b) => Number(!!a.series) - Number(!!b.series) || a.round - b.round)) {
      if (m.result || (m.home !== mine.id && m.away !== mine.id)) continue;
      const other = name(m.home === mine.id ? m.away : m.home);
      const a = m.attempts.at(-1);
      // The same test the server applies before it accepts a new time
      const fellThrough = retryable(a);
      if (m.proposal && m.proposal.by !== mine.id) out.push({ key: 'answer-' + m.id, text: other + ' proposed a time for your match', path: page(m) });
      else if (!m.proposal && (!a || fellThrough) && !needsTime) {
        needsTime = true;
        out.push({ key: 'time-' + m.id, text: 'Your match with ' + other + (fellThrough ? ' needs a new time' : ' needs a time'), path: page(m) });
      }
    }
    for (const t of s.trades) if (t.state === 'offered' && t.squads[1] === mine.id) out.push({ key: 'trade-' + t.id, text: name(t.squads[0]) + ' offered you a trade', path: '/manage' });
  }
  if (actor.operator) {
    for (const m of s.matches) {
      const a = m.attempts.at(-1);
      if (m.result || !a) continue;
      if (a.needsReview || a.state === 'complete') out.push({ key: 'rule-' + m.id, text: name(m.home) + ' v ' + name(m.away) + ' needs a ruling', path: page(m) });
      else if (a.state === 'refused') out.push({ key: 'refused-' + m.id, text: name(m.home) + ' v ' + name(m.away) + ': the zone refused the booking', path: page(m) });
    }
    for (const t of s.trades) if (t.state === 'review') out.push({ key: 'review-' + t.id, text: 'A trade between ' + t.squads.map(name).join(' and ') + ' awaits your approval', path: '/manage' });
  }
  return out;
}
