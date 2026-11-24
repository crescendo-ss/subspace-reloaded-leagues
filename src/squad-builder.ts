import { randomUUID } from 'node:crypto';
import type { Season, Squad } from './types.ts';

// Squads written out as text, one to a line, for operators who set them by hand:
//
//   Night Shift: Vesper, Drift, Mercury
//
// The first pilot named is the captain. A pilot is named as they appear on the site, or by profile ID
// with a # in front, which is what is written when a name could not be read back unambiguously.
type Named = Pick<Season, 'players' | 'squads'>;
const key = (name: string) => name.trim().toLowerCase();
function ambiguous(s: Named, id: number) {
  const name = s.players[id];
  return /[,:#]/.test(name) || /^\d+$/.test(name.trim()) || Object.values(s.players).filter((other) => key(other) === key(name)).length > 1;
}
export function squadsText(s: Named) {
  const pilot = (id: number) => (ambiguous(s, id) ? '#' + id : s.players[id]);
  return s.squads
    .map((t) => t.name.replaceAll(':', ' ') + ': ' + [t.captain, ...t.roster.filter((id) => id !== t.captain)].map(pilot).join(', '))
    .join('\n');
}
// Reads that text back into squads, or says which line is wrong. A squad that keeps its name keeps its
// identity, so its address and its history stay where they were.
export function parseSquads(s: Named, text: string, fail: (message: string) => never): Squad[] {
  const byName = new Map<string, number[]>();
  for (const [id, name] of Object.entries(s.players)) byName.set(key(name), [...(byName.get(key(name)) ?? []), Number(id)]);
  const placed = new Map<number, string>();
  const names = new Set<string>();
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) fail('Write at least one squad: a name, a colon, then its pilots with the captain first.');
  return lines.map((line, i) => {
    const where = 'Line ' + (i + 1) + ': ';
    const colon = line.indexOf(':');
    if (colon < 1) fail(where + 'start with the squad’s name and a colon.');
    const name = line.slice(0, colon).trim();
    if (name.length > 80) fail(where + 'a squad’s name is at most 80 characters.');
    if (names.has(key(name))) fail(where + 'two squads are called ' + name + '.');
    names.add(key(name));
    const roster = line.slice(colon + 1).split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const byId = part.match(/^#(\d+)$/);
      const found = byId ? (Object.hasOwn(s.players, Number(byId[1])) ? [Number(byId[1])] : []) : (byName.get(key(part)) ?? []);
      if (!found.length) fail(where + part + ' has not signed up for this season.');
      if (found.length > 1) fail(where + 'more than one pilot is called ' + part + '. Use a profile ID, such as #' + found[0] + '.');
      if (placed.has(found[0])) fail(where + s.players[found[0]] + ' is already on ' + placed.get(found[0]) + '.');
      placed.set(found[0], name);
      return found[0];
    });
    if (!roster.length) fail(where + name + ' has no pilots. Name its captain first.');
    const existing = s.squads.find((t) => key(t.name) === key(name));
    return { ...existing, id: existing?.id ?? randomUUID(), name, captain: roster[0], roster };
  });
}
