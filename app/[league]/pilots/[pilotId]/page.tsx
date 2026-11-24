import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadLeagueHome } from '@/app/data';
import { database, configuration } from '@/src/runtime';
import { publicSeason } from '@/src/service';
import { Disclosure, Panel, seriesLabel, squad } from '@/components/league';
import { LocalTime } from '@/components/interactive';
import { formatStat, seasonGroups, seasonStats, stats, statValue, sumCounters, type Counters } from '@/src/stats';

type Props = { params: Promise<{ league: string; pilotId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
// A pilot's record in one league: every season they were part of, newest first
const load = cache(async (leagueKey: string, pilotId: string) => {
  const id = Number(pilotId);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== pilotId) notFound();
  const { league } = await loadLeagueHome(Promise.resolve({ league: leagueKey }));
  const store = await database();
  const seasons = (await Promise.all((await store.listSeasonNames(league.id)).map(async (entry) => publicSeason(await store.read(entry.id), league))))
    .filter((s) => Object.hasOwn(s.players, id));
  if (!seasons.length) notFound();
  // Their matches in the site's other leagues count toward a career line
  const elsewhere = (await store.pilotMatches(id)).filter((row) => row.league !== league.id);
  return { id, league, seasons, name: seasons[0].players[id], elsewhere };
});
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { league, pilotId } = await params;
  const { name, league: l, seasons } = await load(league, pilotId);
  return {
    title: name + ' · ' + l.name,
    description: name + '’s record in the ' + l.name + ' Subspace league on ' + configuration().name + ': ' + seasons.length + (seasons.length === 1 ? ' season' : ' seasons') + ', statistics and match log.',
    alternates: { canonical: '/' + l.slug + '/pilots/' + pilotId },
  };
}
export default async function Pilot({ params, searchParams }: Props) {
  const { league: leagueKey, pilotId } = await params;
  const { id, league, seasons, name, elsewhere } = await load(leagueKey, pilotId);
  const chosen = [(await searchParams).group].flat()[0];
  const group = seasonGroups.find((g) => g.key === chosen) ?? seasonGroups[0];
  const lines = seasons.map((s) => {
    const row = seasonStats(s).pilots.find((r) => r.id === String(id));
    const rostered = s.squads.find((t) => t.roster.includes(id));
    // Every squad they played for that season, the one they are rostered with first
    const played = [...new Set(s.matches.flatMap((m) => m.result?.players.filter((p) => p.id === id).map((p) => p.squad) ?? []))];
    const squads = [...new Set([...(rostered ? [rostered.id] : []), ...played])].filter((t) => s.squads.some((x) => x.id === t));
    const pick = s.picks.findIndex((p) => p.player === id);
    return { s, counters: row?.counters ?? ({ games: 0, wins: 0 } as Counters), rostered, squads, pick };
  });
  const total = sumCounters(lines.map((line) => line.counters));
  const away = elsewhere.length
    ? sumCounters([{ games: elsewhere.length, wins: elsewhere.filter((row) => row.won).length }, ...elsewhere.map((row) => row.metrics)])
    : null;
  const columns = group.stats.filter((stat) => statValue(stat, total) !== null);
  const latest = lines[0];
  const logStats = ['kills', 'deaths', 'assists', 'time'].map((key) => stats.get(key)!);
  const log = (s: (typeof seasons)[number]) =>
    s.matches
      .filter((m) => m.result?.players.some((p) => p.id === id))
      .map((m) => {
        const mine = m.result!.players.find((p) => p.id === id)!;
        const home = mine.squad === m.home;
        return { m, mine, opponent: home ? m.away : m.home, score: m.score && (home ? m.score : [m.score[1], m.score[0]]), when: m.attempts.at(-1)?.endedAt ?? m.result!.recordedAt };
      })
      .sort((a, b) => b.when.localeCompare(a.when));
  const matches = (s: (typeof seasons)[number]) => {
    // A figure no match of the season reported has no column
    const essentials = logStats.filter((stat) => log(s).some(({ mine }) => statValue(stat, mine.metrics) !== null));
    return (
    <div className="table-wrap">
      <table className="stats-table dense">
        <thead>
          <tr>
            <th scope="col">Match</th>
            <th scope="col">Opponent</th>
            <th scope="col">Result</th>
            {essentials.map((stat) => <th key={stat.key} scope="col" className="number" title={stat.title} aria-label={stat.title}>{stat.label}</th>)}
            <th scope="col" className="number">Played</th>
          </tr>
        </thead>
        <tbody>
          {log(s).map(({ m, mine, opponent, score, when }) => (
            <tr key={m.id}>
              <th scope="row"><Link href={s.base + '/matches/' + m.number}>{m.series ? seriesLabel(m.series, s) + ', game ' + m.round : 'Round ' + m.round}</Link></th>
              <td><Link href={s.base + '/squads/' + squad(s, opponent).slug}>{squad(s, opponent).name}</Link></td>
              <td>
                <span className={m.result!.winner === mine.squad ? 'won' : m.result!.winner ? 'lost' : undefined}>{m.result!.winner === mine.squad ? 'W' : m.result!.winner ? 'L' : 'D'}</span>
                {score && ' ' + score[0] + '–' + score[1]}
              </td>
              {essentials.map((stat) => <td key={stat.key} className="number">{formatStat(stat, statValue(stat, mine.metrics))}</td>)}
              <td className="number"><LocalTime iso={when} dateOnly /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    );
  };
  return (
    <div className="season-page">
      <header className="page-head">
        <h1>{name}</h1>
        <p>{latest.s.name}</p>
      </header>
      {/* Who the pilot is this season, as figures */}
      <dl className="squad-line">
        <div><dt>Squad</dt><dd>{latest.rostered ? <Link href={latest.s.base + '/squads/' + latest.rostered.slug}>{latest.rostered.name}</Link> : 'None'}</dd></div>
        <div><dt>Role</dt><dd>{latest.rostered?.captain === id ? 'Captain' : 'Pilot'}</dd></div>
        {Number.isFinite(latest.s.salaries[id]) && <div><dt>Salary</dt><dd>{latest.s.salaries[id]}</dd></div>}
        {latest.pick >= 0 && <div><dt>Draft pick</dt><dd>{latest.pick + 1}</dd></div>}
        {total.games > 0 && <div><dt>Record</dt><dd>{total.wins}–{total.games - total.wins}</dd></div>}
      </dl>
      <Panel
        framed
        title={<>Seasons<small>{league.name}</small></>}
        action={total.games ? (
          <nav className="filters" aria-label="Statistics shown">
            {seasonGroups.map((g) => (
              <Link key={g.key} href={g === seasonGroups[0] ? '/' + league.slug + '/pilots/' + id : '?group=' + g.key} aria-current={g === group ? 'true' : undefined} scroll={false}>{g.label}</Link>
            ))}
          </nav>
        ) : undefined}
      >
        {total.games ? (
          <>
            <div className="table-wrap box-score">
              <table className="stats-table dense">
                <thead>
                  <tr>
                    <th scope="col">Season</th>
                    <th scope="col">Squad</th>
                    {columns.map((stat) => <th key={stat.key} scope="col" className="number" title={stat.title} aria-label={stat.title}>{stat.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lines.map(({ s, counters, squads }) => (
                    <tr key={s.id}>
                      <th scope="row"><Link href={s.base + '/stats'}>{s.name}</Link></th>
                      <td>{squads.map((t) => squad(s, t).name).join(', ') || '–'}</td>
                      {columns.map((stat) => <td key={stat.key} className="number">{formatStat(stat, statValue(stat, counters))}</td>)}
                    </tr>
                  ))}
                </tbody>
                {(lines.length > 1 || away) && (
                  <tfoot>
                    {lines.length > 1 && (
                      <tr>
                        <th scope="row">{league.name}</th>
                        <td />
                        {columns.map((stat) => <td key={stat.key} className="number">{formatStat(stat, statValue(stat, total))}</td>)}
                      </tr>
                    )}
                    {away && (
                      <tr>
                        <th scope="row">All leagues</th>
                        <td />
                        {columns.map((stat) => <td key={stat.key} className="number">{formatStat(stat, statValue(stat, sumCounters([total, away])))}</td>)}
                      </tr>
                    )}
                  </tfoot>
                )}
              </table>
            </div>
          </>
        ) : (
          <p className="muted">{name} has not played a match in this league yet.</p>
        )}
      </Panel>
      {lines.filter((line) => line.counters.games > 0).map(({ s }, i) => (
        i === 0 ? (
          <Panel framed key={s.id} title={<>Matches<small>{s.name}</small></>}>
            {matches(s)}
          </Panel>
        ) : (
          <Disclosure key={s.id} title={'Matches · ' + s.name}>{matches(s)}</Disclosure>
        )
      ))}
    </div>
  );
}
