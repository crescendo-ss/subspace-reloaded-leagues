import type { Season } from './types.ts';

export function availableSlug(name: string, fallback: string, taken: (value: string) => boolean) {
  const normalized = name
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // Keep generated UUIDs available as aliases for links made by older releases.
  const base = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(normalized)
    ? fallback + '-' + normalized
    : normalized || fallback;
  let slug = base;
  for (let suffix = 2; taken(slug); suffix++) slug = base + '-' + suffix;
  return slug;
}

export function assignSeasonUrls(s: Season) {
  const reserved = new Set(s.squads.flatMap((t) => (t.slug ? [t.id, t.slug] : [t.id])));
  for (const squad of s.squads) {
    if (squad.slug) continue;
    squad.slug = availableSlug(squad.name, 'squad', (slug) => reserved.has(slug));
    reserved.add(squad.slug);
  }
  // Bracket corrections can remove matches. Keep the counter even after removal.
  let last = s.lastMatchNumber ?? 0;
  for (const match of s.matches) last = Math.max(last, match.number ?? 0);
  for (const match of s.matches) match.number ??= ++last;
  s.lastMatchNumber = last;
}
