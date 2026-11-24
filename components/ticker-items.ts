import type { SeasonView } from '@/src/service';
import { checkInTime, isUpcoming } from './match-card';

export type TickerItem = {
  key: string;
  tag: string;
  tone?: 'live';
  href: string;
  text: string;
  figure?: string;
  tail?: string;
  time?: string;
};

// The ticker is built from the season's current state. Trades and the draft carry no
// timestamps, so they are listed by state after the dated match items.
export function tickerItems(s: SeasonView, now = Date.now()): TickerItem[] {
  const base = s.base;
  const name = (id: string) => s.squads.find((t) => t.id === id)?.name ?? 'Unknown squad';
  const pair = (m: { home: string; away: string }) => name(m.home) + ' v ' + name(m.away);
  const link = (m: { number: number }) => base + '/matches/' + m.number;
  const state = (m: SeasonView['matches'][number]) => (m.result || m.proposal ? undefined : m.attempts.at(-1)?.state);
  const items: TickerItem[] = [];

  if (s.champion) items.push({ key: 'champion', tag: 'Champion', href: base + '/playoffs', text: name(s.champion) });
  for (const m of s.matches) {
    if (state(m) === 'live') items.push({ key: 'live-' + m.id, tag: 'In play', tone: 'live', href: link(m), text: pair(m) });
  }
  for (const m of s.matches) {
    if (state(m) === 'open') items.push({ key: 'open-' + m.id, tag: 'Check-in open', href: link(m), text: pair(m) });
  }
  if (s.draft) items.push({ key: 'draft', tag: 'Draft', tone: 'live', href: base + '/draft', text: 'In progress' });

  const ended = (m: SeasonView['matches'][number]) => m.attempts.at(-1)?.endedAt ?? m.result!.recordedAt;
  const results = s.matches.filter((m) => m.result).sort((a, b) => ended(b).localeCompare(ended(a)));
  for (const m of results.slice(0, 5)) {
    const winner = m.result!.winner;
    // A forfeit is told as one: the score it was awarded says nothing about a game
    if (m.forfeit && winner) {
      items.push({ key: 'final-' + m.id, tag: 'Forfeit', href: link(m), text: name(m.forfeit) + ' forfeited to ' + name(winner) });
      continue;
    }
    items.push(m.score
      ? { key: 'final-' + m.id, tag: 'Final', href: link(m), text: name(m.home), figure: m.score.join('–'), tail: name(m.away) }
      : { key: 'final-' + m.id, tag: 'Final', href: link(m),
          text: winner ? name(winner) + ' beat ' + name(winner === m.home ? m.away : m.home) : name(m.home) + ' drew with ' + name(m.away) });
  }

  const next = s.matches
    .filter((m) => isUpcoming(m) && checkInTime(m) && state(m) !== 'open')
    .filter((m) => m.proposal || Date.parse(m.attempts.at(-1)!.startsBy) >= now)
    .sort((a, b) => checkInTime(a)!.localeCompare(checkInTime(b)!));
  for (const m of next.slice(0, 3)) {
    items.push({ key: 'next-' + m.id, tag: m.proposal ? 'Proposed' : 'Next', href: link(m), text: pair(m), time: checkInTime(m) });
  }

  const tradeTags = { offered: 'Trade offered', review: 'Trade in review', completed: 'Trade completed' } as const;
  const open = s.trades.filter((t) => t.state === 'offered' || t.state === 'review');
  const done = s.trades.filter((t) => t.state === 'completed').slice(-2);
  for (const t of [...open, ...done]) {
    if (t.state !== 'declined') items.push({ key: 'trade-' + t.id, tag: tradeTags[t.state], href: base + '/squads', text: t.squads.map(name).join(' and ') });
  }

  if (s.draftFinished && !results.length) items.push({ key: 'drafted', tag: 'Draft', href: base + '/squads', text: 'Complete' });
  if (!s.draft && !s.draftFinished && !s.matches.length) {
    const pilots = Object.keys(s.players).map(Number);
    if (s.enlistedOpen)
      items.unshift({ key: 'signup', tag: 'Sign-ups open', href: '/' + s.leagueSlug, text: pilots.length + (pilots.length === 1 ? ' pilot' : ' pilots') });
    // While a season is signing up, the news is who has joined: newest first, ahead of everything else
    const joined = (id: number) => s.signups?.[id] ?? '';
    items.unshift(
      ...pilots
        .sort((a, b) => joined(b).localeCompare(joined(a)) || s.players[a].localeCompare(s.players[b]))
        .slice(0, 12)
        .map((id) => ({ key: 'pilot:' + id, tag: 'Signed up', href: base, text: s.players[id] })),
    );
  }
  return items;
}
