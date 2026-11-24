import { bracket, headToHeadWins, rank, standings } from './competition.ts';
import type { Season } from './types.ts';

export const trials = 2000;

type RecordLine = { wins: number; draws: number; played: number };

export function matchupOdds(home: RecordLine, away: RecordLine, drawRate: number) {
  const strength = (row: RecordLine) => (row.wins + row.draws / 2 + 1) / (row.played + 2);
  const a = strength(home), b = strength(away);
  const win = a * (1 - b), loss = b * (1 - a);
  return { home: (1 - drawRate) * win / (win + loss), draw: drawRate, away: (1 - drawRate) * loss / (win + loss) };
}

export function seasonDrawRate(records: RecordLine[]) {
  // Each completed game contributes one appearance to each squad's record.
  const played = records.reduce((n, row) => n + row.played, 0) / 2;
  const draws = records.reduce((n, row) => n + row.draws, 0) / 2;
  return (draws + 1) / (played + 10);
}
export function playoffPicture(
  s: Pick<Season, 'id' | 'squads' | 'format' | 'playoffSpots' | 'bracket'> & {
    matches: Pick<Season['matches'][number], 'home' | 'away' | 'result' | 'series'>[];
  },
) {
  const table = standings(s);
  const qualified = table.slice(0, s.playoffSpots).map((t) => t.id);
  const opening = (s.bracket.length ? s.bracket : bracket(qualified, s.format))
    .filter((node) => node.stage === 'Upper' && node.round === 1)
    .map((node) => node.sources.map((ref) => ('seed' in ref ? ref.seed : null)));
  const chances = new Map(table.map((t) => [t.id, 0]));
  const games = s.matches.filter((m) => !m.series);
  if (s.bracket.length || !games.some((m) => !m.result) || qualified.length === table.length) {
    for (const id of s.bracket.length ? opening.flat() : qualified) if (id) chances.set(id, 1);
  } else {
    // Seeded randomness makes an unchanged schedule reproducible across page loads.
    let seed = [...s.id].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) | 0, 7);
    const random = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const index = new Map(table.map((t, i) => [t.id, i]));
    const drawRate = seasonDrawRate(table);
    const remaining = games
      .filter((m) => !m.result)
      .map((m) => {
        const home = index.get(m.home)!,
          away = index.get(m.away)!;
        return { home, away, threshold: drawRate + matchupOdds(table[home], table[away], drawRate).home };
      });
    // Head-to-head wins so far; each trial adds its own results to a copy
    const versus = headToHeadWins(games);
    const base = table.map((a) => table.map((b) => versus(a.id, b.id)));
    for (let trial = 0; trial < trials; trial++) {
      const rows = table.map((t, i) => ({ ...t, i }));
      const taken = base.map((line) => [...line]);
      for (const { home, away, threshold } of remaining) {
        const roll = random();
        // A draw changes no one's win–loss record
        if (roll >= drawRate) {
          const [winner, loser] = roll < threshold ? [home, away] : [away, home];
          rows[winner].wins++;
          rows[loser].losses++;
          taken[winner][loser]++;
        }
      }
      // Squads still level after head-to-head keep today's kill differential as the best guess
      for (const t of rank(rows, (a, b) => taken[a.i][b.i]).slice(0, s.playoffSpots))
        chances.set(t.id, chances.get(t.id)! + 1);
    }
    for (const [id, count] of chances) chances.set(id, count / trials);
  }
  return { table, opening, chances };
}
