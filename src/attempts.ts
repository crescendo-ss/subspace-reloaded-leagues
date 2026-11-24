// A booking with Reloaded, and the states it passes through. Everything that asks "is this booking still
// going?" or "can this match be arranged again?" asks here, so a new state is added in one place.
//   queued    agreed here and not yet sent to the zone
//   booked    the zone holds it
//   open      check-in is open
//   starting, live    being played
//   complete, cancelled, no_show    over, as the zone reports it
//   refused   the zone would not take it: a state of this site's own
export const zoneStates = ['queued', 'booked', 'open', 'starting', 'live', 'complete', 'cancelled', 'no_show'] as const;
export type AttemptState = (typeof zoneStates)[number] | 'refused';
type Stated = { state: string; resolution?: string | null };
// Each test also tells the type checker the booking exists
const among = (states: readonly string[]) => <T extends Stated>(a: T | undefined): a is T => !!a && states.includes(a.state);
// Still to be played or being played: the match is spoken for
export const isActive = among(['queued', 'booked', 'open', 'starting', 'live']);
// Held by the zone and not yet under way: its roster and window can still change
export const isPending = among(['queued', 'booked', 'open']);
// The zone has said its last word
export const isTerminal = among(['complete', 'cancelled', 'no_show']);
// It fell through without a result, so the captains may agree another time
export const retryable = (a: Stated | undefined): boolean =>
  !!a && (['cancelled', 'no_show'].includes(a.state) || (a.state === 'complete' && ['abandoned', 'cancelled'].includes(a.resolution ?? '')));
