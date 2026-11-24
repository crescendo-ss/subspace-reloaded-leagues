import type { Match } from './types.ts';

// The squad that gave a match up: the loser of a match recorded as a forfeit. An operator says so when
// ruling; for a result the zone reported, its own report says whether it was a forfeit or a walkover.
// A result that merely has no scoreboard is not a forfeit, and a draw has no squad that forfeited.
export function forfeitedBy(m: Pick<Match, 'home' | 'away' | 'result' | 'attempts'>): string | null {
  const result = m.result;
  if (!result?.winner) return null;
  const reported = m.attempts.at(-1)?.rawResult?.outcome ?? '';
  const forfeit = result.forfeit ?? (result.source === 'reloaded' && ['forfeit', 'walkover'].includes(reported));
  return forfeit ? (result.winner === m.home ? m.away : m.home) : null;
}

// Four field positions with three lives each. Substitutes share the position's lives.
const lives = 12;
export function matchScore(m: Match, seasonGameType: string): [number, number] | null {
  const attempt = m.attempts.at(-1);
  const result = m.result;
  // A score recorded with the result stands as given
  if (result?.score) return result.score;
  if (!result || (attempt?.booking.gameType ?? seasonGameType) !== 'svs-league-4v4') return null;
  const report = attempt?.rawResult;
  if (result.source === 'operator' && !report) return null;
  if (attempt?.needsReview || ['forfeit', 'walkover'].includes(report?.outcome ?? '')) return null;
  if (report?.rankedTeams?.flat().some((name) => !Object.hasOwn(report.perPlayer ?? {}, name))) return null;
  const lost = [0, 0];
  const seen = new Set<number>();
  for (const player of result.players) {
    const side = player.squad === m.home ? 0 : player.squad === m.away ? 1 : -1;
    const deaths = player.metrics.deaths;
    if (side < 0 || !Number.isSafeInteger(deaths) || deaths < 0) return null;
    lost[side] += deaths;
    seen.add(side);
  }
  if (seen.size < 2 || lost.some((n) => n > lives)) return null;
  const score: [number, number] = [lost[1], lost[0]];
  // An elimination closes every remaining position on the losing side, including departures.
  if (result.source === 'reloaded' && report?.outcome === 'elimination' && result.winner) {
    score[result.winner === m.home ? 0 : 1] = lives;
  }
  if (result.source === 'reloaded' && report?.outcome === 'mutual_elimination' && report.draw) return [lives, lives];
  const leader = score[0] === score[1] ? null : score[0] > score[1] ? m.home : m.away;
  return leader === result.winner ? score : null;
}
