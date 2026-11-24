import { need, withCorrections } from './league.ts';
import type { Season } from './types.ts';

// Replace the statistics of matches that have already been played with fuller ones from a file: for a season
// imported with only the figures its old site showed, or to bring in counters recorded after the fact. The
// result, the score and who played are left as they are; only each listed pilot's numbers change. A match
// is named by the zone's match ID, or by its number on this site.
//
//   { "matches": [{ "matchId": "svs-league-4v4-61", "players": [{ "id": 221, "metrics": { "kills": 4, "gunHits": 61 } }] }] }
export function importStats(s: Season, input: string) {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    need(false, 'Choose a valid JSON statistics file.');
  }
  need(data && Array.isArray(data.matches) && data.matches.length, 'Supply the matches to update.');
  // Built on a copy, so a file with a mistake in it changes nothing
  const matches = structuredClone(s.matches);
  const done = new Set<string>();
  data.matches.forEach((entry: Record<string, unknown>, i: number) => {
    const where = 'Entry ' + (i + 1);
    need(entry && typeof entry === 'object', where + ': name a match and its pilots.');
    const m = matches.find((x) =>
      typeof entry.matchId === 'string' ? x.attempts.some((a) => a.matchId === entry.matchId) : Number.isSafeInteger(entry.number) && x.number === entry.number,
    );
    need(m?.result, where + ': no played match has ' + (entry.matchId ? 'the ID ' + entry.matchId : 'that number') + '.');
    need(!done.has(m.id), where + ': this match is listed twice.');
    done.add(m.id);
    need(Array.isArray(entry.players) && entry.players.length, where + ': list the pilots’ statistics.');
    const rows = new Map(m.result.players.map((p) => [p.id, p]));
    for (const p of entry.players as Record<string, unknown>[]) {
      const row = rows.get(p?.id as number);
      need(row, where + ': pilot ' + String(p?.id) + ' is not on this match’s scoreboard.');
      const metrics = p.metrics;
      need(
        metrics && typeof metrics === 'object' && !Array.isArray(metrics) &&
          Object.entries(metrics).every(([key, value]) => key.length > 0 && key.length <= 80 && typeof value === 'number' && Number.isFinite(value)),
        where + ': pilot ' + row.id + ' needs numeric statistics.',
      );
      row.metrics = { ...(metrics as Record<string, number>) };
    }
    // The zone's figures are what a later ruling starts from; corrections an operator made stay on top
    for (const a of m.attempts) if (a.mappedPlayers && (!entry.matchId || a.matchId === entry.matchId)) a.mappedPlayers = structuredClone(m.result.players);
    m.result.players = withCorrections(m.result.players, m.statRulings);
  });
  s.matches = matches;
  return done.size;
}
