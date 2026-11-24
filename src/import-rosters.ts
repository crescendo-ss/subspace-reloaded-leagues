import { randomUUID } from 'node:crypto';
import { need } from './league.ts';
import type { Season, Squad } from './types.ts';

// Import an already conducted draft. Profile IDs are Reloaded IDs, never guessed from names.
export function importRosters(s: Season, input: string) {
  need(!s.matches.length && !s.draft && !s.squads.length, 'Import before creating squads or a schedule.');
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    need(false, 'Enter a valid JSON draft export.');
  }
  need(
    data && Array.isArray(data.players) && Array.isArray(data.squads) && data.squads.length >= 2,
    'Supply players and at least two squads.',
  );
  const players: Record<number, string> = {};
  const salaries: Record<number, number> = {};
  for (const p of data.players) {
    need(
      p &&
        Number.isSafeInteger(p.id) &&
        p.id > 0 &&
        !Object.hasOwn(players, p.id) &&
        typeof p.name === 'string' &&
        p.name.trim().length > 0 &&
        p.name.length <= 80,
      'Each pilot needs a distinct positive profile ID and a name.',
    );
    // Whole numbers for a draft run here; a draft held elsewhere may have priced pilots in fractions
    need(
      typeof p.salary === 'number' && p.salary >= 0 && p.salary <= 1e6 && Number.isInteger(Math.round(p.salary * 1e6) / 1e4),
      'Each pilot needs a nonnegative salary with at most two decimal places.',
    );
    players[p.id] = p.name.trim();
    salaries[p.id] = p.salary;
  }
  const assigned = new Set<number>(),
    names = new Set<string>();
  const squads: Squad[] = data.squads.map((t: Squad) => {
    need(
      t &&
        typeof t.name === 'string' &&
        t.name.trim() &&
        t.name.length <= 80 &&
        !names.has(t.name.trim().toLowerCase()),
      'Supply distinct squad names.',
    );
    names.add(t.name.trim().toLowerCase());
    need(
      Array.isArray(t.roster) && t.roster.includes(t.captain),
      'Every captain must be on their squad roster.',
    );
    for (const id of t.roster) {
      need(
        Number.isSafeInteger(id) && Object.hasOwn(players, id) && !assigned.has(id),
        'Roster IDs must be known pilots assigned only once.',
      );
      assigned.add(id);
    }
    return { id: randomUUID(), name: t.name.trim(), captain: t.captain, roster: t.roster };
  });
  const picks: Season['picks'] = [];
  if (data.picks !== undefined) {
    need(Array.isArray(data.picks), 'Pick history must be an ordered array.');
    const seen = new Set<number>();
    for (const pick of data.picks) {
      const team = squads.find((t) => t.roster.includes(pick?.player));
      need(
        team && pick.player !== team.captain && !seen.has(pick.player),
        'Each imported pick must be a distinct rostered non-captain.',
      );
      need(
        pick.price === undefined || (Number.isSafeInteger(pick.price) && pick.price > 0),
        'Auction prices must be positive whole numbers.',
      );
      picks.push({ squad: team.id, player: pick.player, salary: salaries[pick.player], price: pick.price });
      seen.add(pick.player);
    }
  }
  s.picks = picks;
  s.squads = squads;
  Object.assign(s.players, players);
  Object.assign(s.salaries, salaries);
  s.draftFinished = true;
}
