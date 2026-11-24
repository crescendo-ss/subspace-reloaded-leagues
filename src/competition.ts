import type { Season, Match, Series, BracketRef } from './types.ts';
import { randomUUID } from 'node:crypto';
import { seedOrder } from './bracket-layout.ts';

export function game(home: string, away: string, round: number, series: string | null = null): Match {
  return {
    id: randomUUID(),
    home,
    away,
    round,
    series,
    attempts: [],
    proposal: null,
    result: null,
    rulings: [],
  };
}

export function roundRobin(ids: string[]) {
  const ring: (string | null)[] = [...ids];
  if (ring.length % 2) ring.push(null);
  const matches = [];
  for (let round = 1; round < ring.length; round++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const pair = [ring[i], ring[ring.length - 1 - i]];
      if (pair.every(Boolean)) {
        if (round % 2 === 0) pair.reverse();
        matches.push(game(pair[0]!, pair[1]!, round));
      }
    }
    ring.splice(1, 0, ring.pop()!);
  }
  return matches;
}

type Level = { wins: number; losses: number };
// Squads are ordered on their win–loss record: most wins, then fewest losses. A draw is neither. Squads
// with the same record are separated by the matches between them: most wins in those matches first.
// Whoever that still leaves level is compared again among themselves alone. Each returned group is a set
// of squads the results cannot separate, in finishing order.
export function tiers<T extends Level>(rows: T[], versus: (a: T, b: T) => number): T[][] {
  const out: T[][] = [];
  const sorted = [...rows].sort((a, b) => b.wins - a.wins || a.losses - b.losses);
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].wins === sorted[i].wins && sorted[j].losses === sorted[i].losses) j++;
    out.push(...headToHead(sorted.slice(i, j), versus));
    i = j;
  }
  return out;
}
function headToHead<T>(group: T[], versus: (a: T, b: T) => number): T[][] {
  if (group.length < 2) return [group];
  const taken = new Map(group.map((a) => [a, group.reduce((n, b) => (a === b ? n : n + versus(a, b)), 0)]));
  const sorted = [...group].sort((a, b) => taken.get(b)! - taken.get(a)!);
  if (taken.get(sorted[0]) === taken.get(sorted.at(-1)!)) return [group];
  const out: T[][] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && taken.get(sorted[j]) === taken.get(sorted[i])) j++;
    out.push(...headToHead(sorted.slice(i, j), versus));
    i = j;
  }
  return out;
}
// The full order: win–loss record, head-to-head, then kill differential, then name.
export function rank<T extends Level & { name: string; killDiff?: number }>(rows: T[], versus: (a: T, b: T) => number): T[] {
  return tiers(rows, versus).flatMap((tier) =>
    tier.sort((a, b) => (b.killDiff ?? 0) - (a.killDiff ?? 0) || a.name.localeCompare(b.name)),
  );
}
// How many times each squad has beaten each other squad in the regular season. A draw counts for neither.
export function headToHeadWins(matches: { home: string; away: string; series: string | null; result: { winner: string | null } | null }[]) {
  const taken = new Map<string, number>();
  for (const m of matches) {
    if (m.series || !m.result || m.result.winner === null) continue;
    const key = m.result.winner + '\n' + (m.result.winner === m.home ? m.away : m.home);
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  return (a: string, b: string) => taken.get(a + '\n' + b) ?? 0;
}
export function standings(
  season: Pick<Season, 'squads'> & { matches: Pick<Match, 'home' | 'away' | 'result' | 'series'>[] },
) {
  const rows = new Map(
    season.squads.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        // Kills scored minus kills conceded across the regular season
        killDiff: 0,
      },
    ]),
  );
  for (const m of season.matches) {
    if (m.series || !m.result) continue;
    for (const id of [m.home, m.away]) {
      const row = rows.get(id)!;
      row.played++;
      if (m.result.winner === null) {
        row.draws++;
      } else if (m.result.winner === id) row.wins++;
      else row.losses++;
    }
    // A score recorded with the result is the margin, whether or not there is a scoreboard: it covers a
    // forfeit, and lives conceded that no one was credited with. Otherwise the pilots' kills are counted.
    if (m.result.score) {
      rows.get(m.home)!.killDiff += m.result.score[0] - m.result.score[1];
      rows.get(m.away)!.killDiff += m.result.score[1] - m.result.score[0];
      continue;
    }
    for (const p of m.result.players) {
      const kills = p.metrics.kills;
      if (!Number.isFinite(kills) || (p.squad !== m.home && p.squad !== m.away)) continue;
      rows.get(p.squad)!.killDiff += kills;
      rows.get(p.squad === m.home ? m.away : m.home)!.killDiff -= kills;
    }
  }
  const versus = headToHeadWins(season.matches);
  return rank([...rows.values()], (a, b) => versus(a.id, b.id));
}

export function performance(season: Season) {
  const players = new Map(
    Object.entries(season.players).map(([id, name]) => [
      +id,
      { id: +id, name, played: 0, wins: 0, metrics: Object.create(null) as Record<string, number> },
    ]),
  );
  const squads = new Map(
    season.squads.map((s) => [
      s.id,
      { id: s.id, name: s.name, played: 0, wins: 0, metrics: Object.create(null) as Record<string, number> },
    ]),
  );
  function add(
    row: { played: number; wins: number; metrics: Record<string, number> },
    win: boolean,
    metrics: Record<string, number>,
    count: boolean,
  ) {
    if (count) {
      row.played++;
      if (win) row.wins++;
    }
    for (const [k, v] of Object.entries(metrics)) {
      if (Number.isFinite(v)) row.metrics[k] = (row.metrics[k] ?? 0) + v;
    }
  }
  for (const m of season.matches) {
    if (!m.result) continue;
    for (const id of [m.home, m.away]) add(squads.get(id)!, m.result.winner === id, {}, true);
    for (const p of m.result.players) {
      if (players.has(p.id)) add(players.get(p.id)!, p.squad === m.result.winner, p.metrics, true);
      add(squads.get(p.squad)!, false, p.metrics, false);
    }
  }
  return { players: [...players.values()], squads: [...squads.values()] };
}

// Each series consumes seeds or a prior series' winner/loser. Byes flow through
// the graph exactly like results, without manufacturing a played game.
export function bracket(seeds: string[], format: Season['format']) {
  const order = seedOrder(seeds.length);
  const nodes: Series[] = [];
  function pair(stage: string, round: number, sources: BracketRef[]) {
    const result: Extract<BracketRef, { node: string }>[] = [];
    for (let i = 0; i < sources.length; i += 2) {
      const id = stage + '-' + round + '-' + (i / 2 + 1);
      nodes.push({ id, stage, round, sources: sources.slice(i, i + 2) });
      result.push({ node: id, take: 'winner' });
    }
    return result;
  }
  const losers = (refs: Extract<BracketRef, { node: string }>[]) =>
    refs.map((r) => ({ ...r, take: 'loser' as const }));
  let upper = pair(
    'Upper',
    1,
    order.map((n) => ({ seed: seeds[n - 1] ?? null })),
  );
  let lower: typeof upper = losers(upper);
  let lowerRound = 0;
  let upperRound = 1;
  while (upper.length > 1) {
    if (format === 'double') lower = pair('Lower', ++lowerRound, lower);
    upper = pair('Upper', ++upperRound, upper);
    if (format === 'double') {
      const drops = losers(upper).reverse();
      lower = pair(
        'Lower',
        ++lowerRound,
        lower.flatMap((r, i) => [r, drops[i]]),
      );
    }
  }
  if (format === 'double') {
    const final = pair('Final', 1, [upper[0], lower[0]]);
    pair('Reset', 1, [final[0], ...losers(final)]);
  }
  return nodes;
}

export function advance(season: Season) {
  if (!season.bracket.length) return;
  const outcomes = new Map<string, { winner: string | null; loser: string | null }>();
  const retained = new Set();
  let champion = null;
  for (const node of season.bracket) {
    const sides = node.sources.map((ref) => ('seed' in ref ? ref.seed : outcomes.get(ref.node)?.[ref.take]));
    node.sides = sides.map((v) => v ?? null);
    node.winner = null;
    node.score = [0, 0];
    if (node.stage === 'Reset') {
      const final = season.bracket.at(-2)!;
      if (final.winner && final.winner === final.sides?.[0]) {
        node.skipped = true;
        champion = final.winner;
        continue;
      }
      node.skipped = false;
    }
    if (sides.includes(undefined)) continue;
    let winner;
    if (sides.includes(null)) winner = sides.find(Boolean) ?? null;
    else {
      const target = (season.bestOf + 1) / 2;
      const games = season.matches.filter(
        (m) => m.series === node.id && m.home === sides[0] && m.away === sides[1],
      );
      for (const m of games) {
        if (Math.max(...node.score) === target) break;
        retained.add(m.id);
        if (m.result?.winner) node.score[sides.indexOf(m.result.winner)]++;
      }
      if (Math.max(...node.score) < target) {
        if (!games.some((m) => !m.result)) {
          const m = game(sides[0]!, sides[1]!, games.length + 1, node.id);
          season.matches.push(m);
          retained.add(m.id);
        }
        continue;
      }
      winner = sides[node.score.indexOf(target)]!;
    }
    node.winner = winner;
    outcomes.set(node.id, { winner, loser: sides.find((id) => id !== winner) ?? null });
    if (node === season.bracket.at(-1)) champion = winner;
  }
  const obsolete = season.matches.filter((m) => m.series && !retained.has(m.id));
  if (obsolete.some((m) => m.attempts.length || m.result)) {
    throw Object.assign(new Error('This ruling would invalidate a playoff game already booked or played.'), {
      status: 409,
    });
  }
  season.matches = season.matches.filter((m) => !m.series || retained.has(m.id));
  season.champion = champion;
}
