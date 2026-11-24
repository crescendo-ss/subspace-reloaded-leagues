// Try a season export without saving anything: node scripts/check-import.ts season.json
// It runs the same import the site does, on a season held in memory, and prints what the site would show.
import { readFileSync } from 'node:fs';
import { apply, season } from '../src/league.ts';
import { performance, standings } from '../src/competition.ts';
import { matchScore } from '../src/match-score.ts';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/check-import.ts <season.json>');
  process.exit(2);
}
const s = season({ name: 'Import check' });
try {
  apply(s, { id: 1, name: 'Import check', operator: true }, 'importSeason', { data: readFileSync(path, 'utf8') });
} catch (error) {
  console.error('Not accepted: ' + (error as Error).message);
  process.exit(1);
}
const squad = (id: string | null | undefined) => s.squads.find((t) => t.id === id)?.name ?? '—';
const regular = s.matches.filter((m) => !m.series);
console.log(
  `${s.squads.length} squads, ${Object.keys(s.players).length} pilots, ${s.picks.length} draft picks, ` +
    `${regular.filter((m) => m.result).length} of ${regular.length} regular-season matches played, ` +
    `${s.matches.filter((m) => m.series && m.result).length} playoff games`,
);
console.log('\nStandings');
standings(s).forEach((row, i) =>
  console.log(`${String(i + 1).padStart(2)}  ${row.name.padEnd(24)} ${row.wins}-${row.losses}-${row.draws}  ${row.killDiff > 0 ? '+' : ''}${row.killDiff}`),
);
const noScore = s.matches.filter((m) => m.result && !matchScore(m, s.gameType));
if (noScore.length) console.log(`\n${noScore.length} played matches have no score to show: ` + noScore.map((m) => `${squad(m.home)} v ${squad(m.away)} (round ${m.round})`).join(', '));
if (s.bracket.length) {
  console.log('\nPlayoffs, best of ' + s.bestOf);
  for (const node of s.bracket) {
    const sides = (node.sides ?? []).map(squad);
    console.log(`  ${node.id.padEnd(10)} ${sides[0]} v ${sides[1]}  ${node.score?.join('–') ?? ''}  ${node.winner ? 'winner ' + squad(node.winner) : 'undecided'}`);
  }
  console.log('  Champion: ' + squad(s.champion));
}
const leaders = performance(s).players.filter((p) => p.played).sort((a, b) => (b.metrics.kills ?? 0) - (a.metrics.kills ?? 0));
console.log('\nMost kills');
for (const p of leaders.slice(0, 10)) console.log(`  ${p.name.padEnd(24)} ${p.metrics.kills ?? 0} kills, ${p.metrics.deaths ?? 0} deaths, ${p.played} games`);
const metrics = new Set(leaders.flatMap((p) => Object.keys(p.metrics)));
console.log('\nStatistics kept: ' + [...metrics].sort().join(', '));
