import { need, ruledScore } from './league.ts';
import { importRosters } from './import-rosters.ts';
import { advance, game } from './competition.ts';
import type { Actor, Attempt, BracketRef, Match, PlayerStats, Season, Series } from './types.ts';

// Import a season that was played somewhere else: its squads and draft, every regular-season result with the
// pilots' statistics, and the playoffs as they were played. It fills an empty season in one step or not at
// all. Squads are named in the file; pilots are Reloaded profile IDs, never guessed from names.
//
//   {
//     "players": [{ "id": 221, "name": "Green", "salary": 12 }],
//     "squads":  [{ "name": "North", "captain": 221, "roster": [221, 305] }],
//     "picks":   [{ "player": 305, "price": 4 }],
//     "matches": [{
//       "round": 1, "home": "North", "away": "South",
//       "winner": "North",                      // a squad's name, or "draw"; leave out for an unplayed match
//       "score": [12, 7],                       // optional, home first; otherwise worked out from the scoreboard
//       "reason": "South forfeited",            // optional: records the result as a ruling
//       "forfeit": true,                        // optional, with a reason: the loser forfeited. Left out, a
//                                               // ruling with a winner and no scoreboard counts as one
//       "startedAt": "2026-09-13T20:09:00Z", "endedAt": "2026-09-13T20:41:00Z",
//       "matchId": "svs-league-4v4-8", "matchUrl": "https://…", "replayUrl": "https://…",
//       "players": [{ "id": 221, "squad": "North", "metrics": { "kills": 4, "deaths": 2 } }]
//     }],
//     "playoffs": {
//       "bestOf": 3,
//       "firstRound": [["North", null], ["South", "East"]],   // top to bottom; null is a bye
//       "games": [{ "home": "South", "away": "East", "winner": "South", … }]   // in the order played
//     }
//   }
type Entry = Record<string, unknown>;
const isEntry = (value: unknown): value is Entry => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown, where: string) => {
  if (value === undefined || value === null) return undefined;
  need(typeof value === 'string' && Number.isFinite(Date.parse(value)), where + ': times are ISO dates such as 2026-09-13T20:09:00Z.');
  return new Date(value as string).toISOString();
};
const link = (value: unknown, where: string) => {
  if (value === undefined || value === null) return undefined;
  need(typeof value === 'string' && value.startsWith('https://') && value.length <= 500, where + ': links must start with https://.');
  return value as string;
};

export function importSeason(s: Season, input: string, actor: Actor) {
  need(
    !s.squads.length && !s.matches.length && !s.draft && !s.bracket.length,
    'Import into a season that has no squads, draft or schedule yet.',
  );
  let data: Entry;
  try {
    data = JSON.parse(input);
  } catch {
    need(false, 'Choose a valid JSON season export.');
  }
  need(isEntry(data!) && Array.isArray(data.matches), 'Supply players, squads and matches.');
  // Everything is built on a copy, so a file with a mistake in it changes nothing
  const next = structuredClone(s);
  importRosters(next, JSON.stringify({ players: data.players, squads: data.squads, picks: data.picks }));
  next.enlistedOpen = false;
  const now = new Date().toISOString();
  const squadId = (value: unknown, where: string) => {
    const squad = typeof value === 'string' ? next.squads.find((t) => t.name.toLowerCase() === value.trim().toLowerCase()) : undefined;
    need(squad, where + ': “' + String(value) + '” is not one of the squads.');
    return squad.id;
  };

  // Write one played result onto a match. `entry` may name the two squads either way round.
  function record(m: Match, entry: Entry, where: string) {
    const winner = entry.winner === 'draw' ? null : squadId(entry.winner, where + ' winner');
    need(winner === null || winner === m.home || winner === m.away, where + ': the winner must be one of the two squads.');
    const seen = new Set<number>();
    need(entry.players === undefined || Array.isArray(entry.players), where + ': players must be a list.');
    const players: PlayerStats[] = ((entry.players as unknown[]) ?? []).map((p) => {
      need(isEntry(p) && Number.isSafeInteger(p.id) && Object.hasOwn(next.players, p.id as number), where + ': every pilot in a scoreboard must be in the players list.');
      const id = p.id as number;
      need(!seen.has(id), where + ': pilot ' + id + ' appears twice.');
      seen.add(id);
      const squad = squadId(p.squad, where + ' pilot ' + id);
      need(squad === m.home || squad === m.away, where + ': pilot ' + id + ' is listed for a squad that did not play.');
      need(isEntry(p.metrics) && Object.values(p.metrics).every((v) => typeof v === 'number' && Number.isFinite(v)), where + ': pilot ' + id + ' needs numeric statistics.');
      need(Object.keys(p.metrics as Entry).every((k) => k.length > 0 && k.length <= 80), where + ': statistic names are 1–80 characters.');
      return { id, squad, metrics: { ...(p.metrics as Record<string, number>) } };
    });
    // The score is given home first for the squads as the file names them
    need(entry.score === undefined || (Array.isArray(entry.score) && entry.score.length === 2), where + ': a score is two numbers, home first.');
    const given = (entry.score as unknown[] | undefined) ?? [];
    const flipped = entry.home !== undefined && squadId(entry.home, where + ' home') === m.away;
    const [homeScore, awayScore] = flipped ? [given[1], given[0]] : given;
    let score;
    try {
      score = ruledScore(homeScore, awayScore, winner === null ? null : winner === m.home ? 0 : 1);
    } catch (error) {
      need(false, where + ': ' + (error as Error).message);
    }
    const startedAt = time(entry.startedAt, where),
      endedAt = time(entry.endedAt, where);
    need(!startedAt || !endedAt || startedAt <= endedAt, where + ': the match ends before it starts.');
    const matchUrl = link(entry.matchUrl, where),
      replayUrl = link(entry.replayUrl, where);
    need(entry.matchId === undefined || (typeof entry.matchId === 'string' && entry.matchId.length <= 120), where + ': matchId is the zone’s match ID.');
    need(entry.reason === undefined || (typeof entry.reason === 'string' && entry.reason.trim() && entry.reason.length <= 80), where + ': a ruling’s reason is up to 80 characters.');
    const reason = (entry.reason as string | undefined)?.trim();
    need(entry.forfeit === undefined || typeof entry.forfeit === 'boolean', where + ': forfeit is true or false.');
    need(!entry.forfeit || (reason && winner !== null), where + ': a forfeit is a ruling with a winner, so give its reason and the squad that won.');
    const forfeit = !!reason && winner !== null && ((entry.forfeit as boolean | undefined) ?? !players.length);
    const recordedAt = endedAt ?? startedAt ?? now;
    // A match that was actually played keeps a record of the fixture: who took part, when, and where to watch it
    if (players.length || entry.matchId || matchUrl || replayUrl || startedAt || endedAt) {
      const teams = [m.home, m.away].map((id) => {
        const squad = next.squads.find((t) => t.id === id)!;
        return { name: squad.name, captainProfileId: squad.captain, roster: players.filter((p) => p.squad === id).map((p) => ({ profileId: p.id })) };
      });
      const externalId = 'import-' + next.id + '-' + m.id;
      const attempt: Attempt = {
        externalId,
        state: 'complete',
        resolution: 'completed',
        booking: { externalId, opensAt: startedAt ?? recordedAt, startsBy: endedAt ?? recordedAt, teams, gameType: next.gameType },
        desiredTeams: teams,
        matchId: entry.matchId as string | undefined,
        matchUrl,
        replayUrl,
        startedAt,
        endedAt,
        mappedPlayers: players,
      };
      m.attempts.push(attempt);
    }
    if (reason) m.rulings.push({ by: actor.id, at: recordedAt, winner, reason, ...(score && { score }), forfeit });
    m.result = { winner, source: reason ? 'operator' : 'import', players, recordedAt, ...(score && { score }), ...(reason && { forfeit }) };
  }
  const played = (entry: Entry) => entry.winner !== undefined && entry.winner !== null;

  // The regular season, in round order
  const entries = (data.matches as unknown[]).map((entry, i) => {
    const where = 'Match ' + (i + 1);
    need(isEntry(entry) && Number.isSafeInteger(entry.round) && (entry.round as number) >= 1 && (entry.round as number) <= 999, where + ': give the round as a whole number.');
    const home = squadId(entry.home, where + ' home'),
      away = squadId(entry.away, where + ' away');
    need(home !== away, where + ': a squad cannot play itself.');
    return { entry, where, home, away, round: entry.round as number };
  });
  entries.sort((a, b) => a.round - b.round);
  let results = 0;
  for (const { entry, where, home, away, round } of entries) {
    const m = game(home, away, round);
    if (played(entry)) {
      record(m, entry, where);
      results++;
    }
    next.matches.push(m);
  }

  // The playoffs: a single-elimination bracket given by its first round, then each game in the order played
  let playoffGames = 0;
  if (data.playoffs !== undefined) {
    const p = data.playoffs;
    need(isEntry(p) && [1, 3, 5].includes(p.bestOf as number), 'Playoffs: bestOf is 1, 3 or 5.');
    const first = p.firstRound;
    need(Array.isArray(first) && first.length >= 1 && (first.length & (first.length - 1)) === 0, 'Playoffs: firstRound lists 1, 2, 4, 8… pairings, top to bottom.');
    const entered = new Set<string>();
    let refs: BracketRef[] = (first as unknown[]).flatMap((pair, i) => {
      const where = 'Playoffs pairing ' + (i + 1);
      need(Array.isArray(pair) && pair.length === 2 && pair.some((side) => side !== null), where + ': name two squads, or one squad and null for a bye.');
      return (pair as unknown[]).map((side) => {
        if (side === null) return { seed: null };
        const id = squadId(side, where);
        need(!entered.has(id), where + ': a squad enters the bracket once.');
        entered.add(id);
        return { seed: id };
      });
    });
    need(entered.size >= 2, 'Playoffs: at least two squads take part.');
    const nodes: Series[] = [];
    for (let round = 1; refs.length > 1; round++) {
      const winners: BracketRef[] = [];
      for (let i = 0; i < refs.length; i += 2) {
        const id = 'Upper-' + round + '-' + (i / 2 + 1);
        nodes.push({ id, stage: 'Upper', round, sources: refs.slice(i, i + 2) });
        winners.push({ node: id, take: 'winner' });
      }
      refs = winners;
    }
    next.format = 'single';
    next.bestOf = p.bestOf as number;
    next.playoffSpots = Math.min(128, entered.size);
    next.bracket = nodes;
    need(p.games === undefined || Array.isArray(p.games), 'Playoffs: games must be a list.');
    const pairing = (a: string, b: string) => [a, b].sort().join('\n');
    const waiting = new Map<string, { entry: Entry; where: string }[]>();
    ((p.games as unknown[]) ?? []).forEach((entry, i) => {
      const where = 'Playoff game ' + (i + 1);
      need(isEntry(entry), where + ': give the two squads and the result.');
      if (!played(entry)) return;
      const key = pairing(squadId(entry.home, where + ' home'), squadId(entry.away, where + ' away'));
      waiting.set(key, [...(waiting.get(key) ?? []), { entry, where }]);
    });
    // Each pass opens the games the bracket now calls for, and the file supplies their results
    for (;;) {
      advance(next);
      let filled = false;
      for (const m of next.matches) {
        if (!m.series || m.result) continue;
        const game = waiting.get(pairing(m.home, m.away))?.shift();
        if (!game) continue;
        record(m, game.entry, game.where);
        playoffGames++;
        filled = true;
      }
      if (!filled) break;
    }
    const stray = [...waiting.values()].flat()[0];
    need(!stray, (stray?.where ?? '') + ': this game does not fit the bracket. Either the two squads never meet, or their series was already decided.');
  }
  Object.assign(s, next);
  return { squads: s.squads.length, pilots: Object.keys(s.players).length, matches: s.matches.filter((m) => !m.series).length, results, playoffGames };
}
