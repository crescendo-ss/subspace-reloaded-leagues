// What the rest of the regular season can still change: the best and worst place each squad can finish.
// A squad has clinched the playoffs when its worst finish is inside the playoff places, clinched a seed
// when its best and worst finish are the same, and is eliminated when its best finish is outside them.
import { tiers } from './competition.ts';

type Row = { id: string; name: string; wins: number; losses: number };
type Fixture = { home: string; away: string };
type Played = Fixture & { winner: string | null };
export type Finish = { best: number; worst: number };

// Beyond this many unplayed matches, trying every outcome (three per match) costs too much for a page load.
export const exactLimit = 9;

// `table` is in standings order. `played` are the regular-season results so far, which decide ties between
// squads with the same win–loss record. Squads that even those cannot separate are split by kill differential,
// which no one can know in advance, so each of them might take any of the places they share.
export function finishRange(table: Row[], remaining: Fixture[], played: Played[] = [], limit = exactLimit): Map<string, Finish> {
  const index = new Map(table.map((row, i) => [row.id, i]));
  const games = remaining.map((m) => [index.get(m.home)!, index.get(m.away)!] as const);
  // With nothing left to play the standings are final
  if (!games.length) return new Map(table.map((row, i) => [row.id, { best: i + 1, worst: i + 1 }]));
  const range = table.map(() => ({ best: table.length, worst: 1 }));
  if (games.length <= limit) {
    // Every combination of results, each ranked the way the standings are
    const rows = table.map((row, i) => ({ ...row, i }));
    const taken = table.map(() => table.map(() => 0));
    for (const m of played) {
      const home = index.get(m.home),
        away = index.get(m.away);
      if (home === undefined || away === undefined) continue;
      if (m.winner === m.home) taken[home][away]++;
      else if (m.winner !== null) taken[away][home]++;
    }
    const play = (n: number) => {
      if (n === games.length) {
        let place = 1;
        for (const tier of tiers(rows, (a, b) => taken[a.i][b.i])) {
          for (const row of tier) {
            range[row.i].best = Math.min(range[row.i].best, place);
            range[row.i].worst = Math.max(range[row.i].worst, place + tier.length - 1);
          }
          place += tier.length;
        }
        return;
      }
      const [home, away] = games[n];
      for (const [winner, loser] of [[home, away], [away, home]]) {
        rows[winner].wins++;
        rows[loser].losses++;
        taken[winner][loser]++;
        play(n + 1);
        rows[winner].wins--;
        rows[loser].losses--;
        taken[winner][loser]--;
      }
      // A draw changes no one's record
      play(n + 1);
    };
    play(0);
  } else {
    // Bounds instead: a squad's worst case against every rival's best case, and the reverse. A rival that
    // could finish level counts against the squad, since the tie-break is not known yet. These never claim
    // a clinch or an elimination that is not certain, but can confirm one a little late.
    const left = table.map((_, i) => games.filter((game) => game.includes(i)).length);
    type Line = { wins: number; losses: number };
    // Winning everything left, and losing everything left
    const ceiling = table.map((row, i) => ({ wins: row.wins + left[i], losses: row.losses }));
    const floor = table.map((row, i) => ({ wins: row.wins, losses: row.losses + left[i] }));
    const ahead = (a: Line, b: Line) => a.wins - b.wins || b.losses - a.losses;
    table.forEach((_, i) => {
      range[i].worst = 1 + table.filter((_, j) => j !== i && ahead(ceiling[j], floor[i]) >= 0).length;
      range[i].best = 1 + table.filter((_, j) => j !== i && ahead(floor[j], ceiling[i]) > 0).length;
    });
  }
  return new Map(table.map((row, i) => [row.id, range[i]]));
}

export type PlayoffStatus = { kind: 'seed'; seed: number } | { kind: 'in' } | { kind: 'out' };
// Only what is already settled; a squad still in the race has no status.
export function playoffStatus(
  table: Row[],
  matches: { home: string; away: string; series: string | null; result: { winner?: string | null } | null }[],
  spots: number,
): Map<string, PlayoffStatus> {
  const regular = matches.filter((m) => !m.series);
  const settled = new Map<string, PlayoffStatus>();
  if (!regular.length) return settled;
  const played = regular.flatMap((m) => (m.result ? [{ home: m.home, away: m.away, winner: m.result.winner ?? null }] : []));
  for (const [id, { best, worst }] of finishRange(table, regular.filter((m) => !m.result), played)) {
    if (best > spots) settled.set(id, { kind: 'out' });
    else if (worst <= spots && best === worst) settled.set(id, { kind: 'seed', seed: best });
    // With a place for every squad, reaching the playoffs is not news
    else if (worst <= spots && table.length > spots) settled.set(id, { kind: 'in' });
  }
  return settled;
}
