// The league's statistics. Reloaded reports a set of counters for each pilot in each match (kills, bullets
// fired, damage dealt and so on). A statistic is a named figure worked out from those counters: a total, or
// one sum divided by another. Counters are always summed first and divided once, so a pilot's season figure
// is not an average of per-match figures. The definitions follow the ones on Reloaded's own site, so a
// pilot's league numbers and their Reloaded profile mean the same thing.
export type Counters = Record<string, number>;
export interface Stat {
  key: string;
  // The column heading, and what it stands for
  label: string;
  title: string;
  // A short name for a leaderboard's heading, where the label alone would be too terse
  name?: string;
  // Summed counters, divided by other summed counters when `per` is given, then multiplied by `scale`
  of: string[];
  per?: string[];
  scale?: number;
  // The least the divisor may be, for a ratio that should still read with nothing below the line
  floor?: number;
  format: 'count' | 'decimal' | 'percent' | 'compact' | 'duration';
  digits?: number;
  // A rate or ratio says little after very little play; leaderboards ask for a minimum number of games
  rate?: boolean;
  lowIsBetter?: boolean;
}
// Two figures that are not counters come with every row: games played and games won
const dealt = ['damageDealtGuns', 'damageDealtBombs'];
const taken = ['damageTakenGuns', 'damageTakenBombs'];
const total = (key: string, label: string, title: string, of: string | string[] = key, more: Partial<Stat> = {}): Stat => ({
  key,
  label,
  title,
  of: [of].flat(),
  format: 'count',
  ...more,
});
// Per ten minutes in a ship, which is fair to a substitute and to a short or a long match
const per10 = (key: string, label: string, what: string, of: string | string[], more: Partial<Stat> = {}): Stat => ({
  key,
  label,
  title: what + ' per ten minutes in a ship',
  of: [of].flat(),
  per: ['playingTime'],
  scale: 600,
  format: 'decimal',
  digits: 1,
  rate: true,
  ...more,
});
const share = (key: string, label: string, title: string, of: string | string[], per: string[], more: Partial<Stat> = {}): Stat => ({
  key,
  label,
  title,
  of: [of].flat(),
  per,
  format: 'percent',
  rate: true,
  ...more,
});
const list: Stat[] = [
  total('games', 'GP', 'Games played'),
  total('wins', 'W', 'Games won'),
  total('kills', 'K', 'Kills', 'kills', { name: 'Kills' }),
  total('deaths', 'D', 'Deaths', 'deaths', { lowIsBetter: true, name: 'Deaths' }),
  total('assists', 'A', 'Assists: enemy deaths after this pilot recently damaged them', 'assists', { name: 'Assists' }),
  { key: 'kd', label: 'K/D', name: 'Kills per death', title: 'Kills for each death', of: ['kills'], per: ['deaths'], floor: 1, format: 'decimal', digits: 2, rate: true },
  per10('kills10', 'K/10', 'Kills', 'kills'),
  per10('deaths10', 'D/10', 'Deaths', 'deaths', { lowIsBetter: true }),
  per10('assists10', 'A/10', 'Assists', 'assists'),
  total('time', 'Time', 'Time in a ship', 'playingTime', { format: 'duration' }),
  total('soloKills', 'Solo', 'Solo kills: kills no team-mate contributed to'),
  total('knockouts', 'KO', 'Knockouts: kills that took an opponent’s last life'),
  total('teamKills', 'TK', 'Team kills', 'teamKills', { lowIsBetter: true }),
  share('gunAccuracy', 'Gun acc.', 'Bullet hits for each bullet fired', 'gunHits', ['firesBullet'], { name: 'Gun accuracy' }),
  share('bombAccuracy', 'Bomb acc.', 'Bomb hits for each bomb fired', 'bombHits', ['firesBomb']),
  total('bullets', 'Bullets', 'Bullets fired', 'firesBullet', { format: 'compact' }),
  total('gunHits', 'Gun hits', 'Bullets that hit an opponent', 'gunHits', { format: 'compact' }),
  total('bombs', 'Bombs', 'Bombs fired', 'firesBomb', { format: 'compact' }),
  total('bombHits', 'Bomb hits', 'Bombs that hit an opponent'),
  total('energy', 'Energy', 'Weapon energy spent', 'weaponEnergySpent', { format: 'compact' }),
  total('damage', 'Dealt', 'Damage dealt to opponents', dealt, { format: 'compact' }),
  total('damageTaken', 'Taken', 'Damage taken from opponents', taken, { format: 'compact', lowIsBetter: true }),
  per10('damage10', 'Dealt/10', 'Damage dealt to opponents', dealt, { format: 'compact', name: 'Damage per 10 min' }),
  per10('taken10', 'Taken/10', 'Damage taken from opponents', taken, { format: 'compact', lowIsBetter: true }),
  share('exchange', 'Exchange', 'Damage dealt as a share of damage dealt and taken together', dealt, [...dealt, ...taken]),
  total('lethal', 'Lethal', 'Damage that landed a killing blow', 'killDamage', { format: 'compact' }),
  per10('lethal10', 'Lethal/10', 'Damage that landed a killing blow', 'killDamage', { format: 'compact' }),
  total('teamDamage', 'Team dmg', 'Damage dealt to team-mates', 'damageDealtTeam', { format: 'compact', lowIsBetter: true }),
  total('repels', 'Repels', 'Repels used', 'firesRepel'),
  total('forcedReps', 'Forced', 'Enemy repels forced by this pilot’s pressure'),
  total('forcedCredit', 'Credit', 'Forced repels, split between the pilots who applied the pressure', 'repelCredit', { format: 'decimal', digits: 1 }),
  per10('forced10', 'Forced/10', 'Credited share of enemy repels forced', 'repelCredit', { name: 'Forced repels per 10 min' }),
  total('wastedRepels', 'Wasted', 'Repels still held at death', 'wastedRepels', { lowIsBetter: true }),
  per10('wasted10', 'Wasted/10', 'Repels still held at death', 'wastedRepels', { lowIsBetter: true }),
  total('wastedRockets', 'Rockets lost', 'Rockets still held at death', 'wastedRockets', { lowIsBetter: true }),
];
export const stats = new Map(list.map((stat) => [stat.key, stat]));
const pick = (...keys: string[]) => keys.map((key) => stats.get(key)!);

// The tables a season's statistics are shown in. Every one starts with games played.
export const seasonGroups = [
  { key: 'essentials', label: 'Essentials', stats: pick('games', 'wins', 'kills', 'deaths', 'kd', 'assists', 'kills10', 'deaths10', 'assists10', 'time') },
  { key: 'combat', label: 'Combat', stats: pick('games', 'soloKills', 'knockouts', 'teamKills', 'gunAccuracy', 'bombAccuracy', 'bullets', 'bombs') },
  { key: 'damage', label: 'Damage', stats: pick('games', 'damage', 'damage10', 'taken10', 'exchange', 'lethal10', 'teamDamage') },
  { key: 'repels', label: 'Repels', stats: pick('games', 'repels', 'forcedReps', 'forced10', 'wastedRepels', 'wasted10') },
];
// One match is shown in totals: a rate over a single game adds nothing to the counts beside it
export const matchGroups = [
  { key: 'essentials', label: 'Essentials', stats: pick('kills', 'deaths', 'kd', 'assists', 'time', 'soloKills', 'knockouts', 'teamKills') },
  { key: 'damage', label: 'Damage', stats: pick('damage', 'damageTaken', 'exchange', 'lethal', 'teamDamage') },
  { key: 'weapons', label: 'Weapons', stats: pick('bullets', 'gunHits', 'gunAccuracy', 'bombs', 'bombHits', 'bombAccuracy', 'energy') },
  { key: 'repels', label: 'Repels', stats: pick('repels', 'forcedReps', 'forcedCredit', 'wastedRepels', 'wastedRockets') },
];
export const leaderStats = pick('kills', 'kd', 'assists', 'damage10', 'gunAccuracy', 'forced10');
// Games a pilot must have played to be ranked on a rate or a ratio
export const qualifyingGames = 3;

// A statistic's value from summed counters, or null when the counters it needs were never reported. A
// missing counter is not a zero: a match imported with only its kills and deaths has no accuracy to show.
export function statValue(stat: Stat, counters: Counters): number | null {
  const sum = (keys: string[]) => {
    const present = keys.filter((key) => Number.isFinite(counters[key]));
    return present.length ? present.reduce((n, key) => n + counters[key], 0) : null;
  };
  const top = sum(stat.of);
  if (top === null) return null;
  if (!stat.per) return top;
  const base = sum(stat.per);
  if (base === null) return null;
  const divisor = Math.max(base, stat.floor ?? 0);
  return divisor > 0 ? (top / divisor) * (stat.scale ?? 1) : null;
}
export function formatStat(stat: Stat, value: number | null): string {
  if (value === null) return '–';
  switch (stat.format) {
    case 'percent':
      return (value * 100).toFixed(stat.digits ?? 1) + '%';
    case 'decimal':
      return value.toFixed(stat.digits ?? 2);
    case 'duration': {
      const seconds = Math.round(value);
      const h = Math.floor(seconds / 3600),
        m = Math.floor((seconds % 3600) / 60),
        s = seconds % 60;
      return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    }
    case 'compact':
      if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + 'M';
      if (Math.abs(value) >= 1e4) return Math.round(value / 1e3) + 'k';
      if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + 'k';
      return String(Math.round(value));
    default:
      return Math.round(value).toLocaleString('en-US');
  }
}

// Counters added together, for a total over seasons or over a set of matches
export function sumCounters(list: Counters[]): Counters {
  const total: Counters = {};
  for (const counters of list) for (const [key, value] of Object.entries(counters)) if (Number.isFinite(value)) total[key] = (total[key] ?? 0) + value;
  return total;
}
export type Stage = 'all' | 'regular' | 'playoffs';
export interface StatRow {
  id: string;
  name: string;
  // A pilot's squad: the one they last played for in these matches
  squad?: string;
  counters: Counters;
}
type StatMatch = {
  home: string;
  away: string;
  series: string | null;
  result: { winner: string | null; players: { id: number; squad: string; metrics: Counters }[] } | null;
};
// Every pilot's and every squad's counters summed over a season's matches, or over one stage of it.
// A squad's counters are its pilots' together, so its rates are per ten pilot-minutes, like a pilot's.
export function seasonStats(
  s: { players: Record<number, string>; squads: { id: string; name: string }[]; matches: StatMatch[] },
  stage: Stage = 'all',
): { pilots: StatRow[]; squads: StatRow[] } {
  const squads = new Map(s.squads.map((t) => [t.id, { id: t.id, name: t.name, counters: { games: 0, wins: 0 } as Counters }]));
  const pilots = new Map<number, StatRow>();
  const add = (into: Counters, metrics: Counters) => {
    for (const [key, value] of Object.entries(metrics)) if (Number.isFinite(value)) into[key] = (into[key] ?? 0) + value;
  };
  for (const m of s.matches) {
    if (!m.result || (stage === 'regular' && m.series) || (stage === 'playoffs' && !m.series)) continue;
    for (const id of [m.home, m.away]) {
      const row = squads.get(id);
      if (!row) continue;
      row.counters.games++;
      if (m.result.winner === id) row.counters.wins++;
    }
    for (const p of m.result.players) {
      let row = pilots.get(p.id);
      if (!row) pilots.set(p.id, (row = { id: String(p.id), name: s.players[p.id] ?? 'Pilot ' + p.id, counters: { games: 0, wins: 0 } }));
      row.squad = p.squad;
      row.counters.games++;
      if (m.result.winner === p.squad) row.counters.wins++;
      add(row.counters, p.metrics);
      const side = squads.get(p.squad);
      if (side) add(side.counters, p.metrics);
    }
  }
  return { pilots: [...pilots.values()], squads: [...squads.values()] };
}
// The order for one statistic: best first, pilots without the figure last, then by name. With `qualified`,
// a pilot short of the games a rate needs is ranked below every pilot who has them.
export function rankBy<T extends StatRow>(rows: T[], stat: Stat, qualified?: (row: T) => boolean): T[] {
  const value = (row: T) => statValue(stat, row.counters);
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    if (qualified && stat.rate && qualified(a) !== qualified(b)) return qualified(a) ? -1 : 1;
    if ((x === null) !== (y === null)) return x === null ? 1 : -1;
    return (x !== null && y !== null && x !== y ? (stat.lowIsBetter ? x - y : y - x) : 0) || a.name.localeCompare(b.name);
  });
}
