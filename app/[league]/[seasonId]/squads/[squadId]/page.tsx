import Link from 'next/link';
import { seasonMetadata } from '@/app/seo';
import { notFound } from 'next/navigation';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { Panel, Section, Command, Select, seriesLabel, squad } from '@/components/league';
import { LocalTime } from '@/components/interactive';
import { checkInTime } from '@/components/match-card';
import { Icon } from '@/components/symbols';
import { formatStat, seasonStats, stats, statValue, type Counters } from '@/src/stats';
export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, 'squads', ({ squad }) => squad?.name ?? 'Squad', ({ season: s, squad }) =>
    (squad?.name ?? 'A squad') + ' in ' + s.name + ' (' + s.leagueName + ' Subspace league): roster' + (squad ? ' of ' + squad.roster.length + ' pilots, captained by ' + s.players[squad.captain] : '') + ', results and fixtures.');
export default async function Squad(props: LeaguePage) {
  const { season: s, actor, squad: t } = await loadLeaguePage(props, 'squads');
  if (!t) notFound();
  // Each pilot's line counts only the matches they played for this squad
  const own = { ...s, matches: s.matches.map((m) => (m.result ? { ...m, result: { ...m.result, players: m.result.players.filter((p) => p.squad === t.id) } } : m)) };
  const totals = seasonStats(own);
  const line = new Map(totals.pilots.map((row) => [Number(row.id), row.counters]));
  const side = seasonStats(s).squads.find((row) => row.id === t.id)?.counters ?? ({ games: 0, wins: 0 } as Counters);
  // A rostered pilot who has not played has no games, rather than no record
  const none: Counters = { games: 0, wins: 0 };
  // The roster, then anyone who played for the squad and has since left it
  const former = [...line.keys()].filter((id) => !t.roster.includes(id));
  const pilots = [...t.roster, ...former];
  const pick = (...keys: string[]) => keys.map((key) => stats.get(key)!);
  // Beside the matches there is room for a short line; a pilot's full line is on their page
  const columns = pick('games', 'kills', 'deaths', 'kd').filter((stat) => pilots.some((id) => statValue(stat, line.get(id) ?? none) !== null));
  const summary = pick('kills', 'deaths', 'kd', 'damage10', 'gunAccuracy').filter((stat) => statValue(stat, side) !== null);
  // Newest first, with what is still to come at the top
  const played = (m: (typeof s.matches)[number]) => m.attempts.at(-1)?.endedAt ?? m.result?.recordedAt ?? '';
  const games = s.matches.filter((m) => m.home === t.id || m.away === t.id).sort((a, b) => Number(!!a.result) - Number(!!b.result) || played(b).localeCompare(played(a)) || b.number - a.number);
  const standing = s.standings.findIndex((row) => row.id === t.id);
  const record = s.standings[standing];
  return (
    <>
      <h1>{t.name}</h1>
      {record && record.played > 0 && (
        <dl className="squad-line">
          <div><dt>Standing</dt><dd>{standing + 1}<small> of {s.standings.length}</small></dd></div>
          <div><dt>Record</dt><dd>{[record.wins, record.losses, ...(record.draws ? [record.draws] : [])].join('–')}</dd></div>
          {summary.map((stat) => (
            <div key={stat.key} title={stat.title}><dt>{stat.name ?? stat.label}</dt><dd>{formatStat(stat, statValue(stat, side))}</dd></div>
          ))}
        </dl>
      )}
      <div className="panel-pair">
        <Panel framed title={<>Roster<small>{t.roster.length} pilots</small></>}>
          <div className="table-wrap">
            <table className="stats-table dense">
              <thead>
                <tr>
                  <th scope="col">Pilot</th>
                  <th scope="col" className="number">Salary</th>
                  {columns.map((stat) => <th key={stat.key} scope="col" className="number" title={stat.title} aria-label={stat.title}>{stat.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {pilots.map((id) => (
                  <tr key={id} className={t.roster.includes(id) ? undefined : 'unranked'}>
                    <th scope="row">
                      <Link href={'/' + s.leagueSlug + '/pilots/' + id}>{s.players[id]}</Link>
                      {id === t.captain ? <small>Captain</small> : !t.roster.includes(id) && <small>Former</small>}
                    </th>
                    <td className="number">{s.salaries[id] ?? '–'}</td>
                    {columns.map((stat) => <td key={stat.key} className="number">{formatStat(stat, statValue(stat, line.get(id) ?? none))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel framed title={<>Matches<small>{games.filter((m) => m.result).length} played</small></>} action={<Link href={s.base + '/schedule?view=all'}>Full schedule <Icon name="arrow" /></Link>}>
          {games.length ? (
            <div className="table-wrap">
              <table className="stats-table dense">
                <thead>
                  <tr>
                    <th scope="col">Match</th>
                    <th scope="col">Opponent</th>
                    <th scope="col">Result</th>
                    <th scope="col" className="number">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((m) => {
                    const home = m.home === t.id;
                    const score = m.score && (home ? m.score : [m.score[1], m.score[0]]);
                    const when = m.attempts.at(-1)?.endedAt ?? m.result?.recordedAt ?? checkInTime(m);
                    return (
                      <tr key={m.id}>
                        <th scope="row"><Link href={s.base + '/matches/' + m.number}>{m.series ? seriesLabel(m.series, s) + ', game ' + m.round : 'Round ' + m.round}</Link></th>
                        <td><Link href={s.base + '/squads/' + squad(s, home ? m.away : m.home).slug}>{squad(s, home ? m.away : m.home).name}</Link></td>
                        <td>
                          {m.result ? (
                            <>
                              <span className={m.result.winner === t.id ? 'won' : m.result.winner ? 'lost' : undefined}>{m.result.winner === t.id ? 'W' : m.result.winner ? 'L' : 'D'}</span>
                              {score && ' ' + score[0] + '–' + score[1]}
                              {m.forfeit && <span className="muted"> · {m.forfeit === t.id ? 'forfeited' : 'by forfeit'}</span>}
                            </>
                          ) : <span className="muted">{when ? 'To be played' : 'Awaiting scheduling'}</span>}
                        </td>
                        <td className="number">{when ? <LocalTime iso={when} dateOnly={!!m.result} /> : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">No matches yet.</p>}
        </Panel>
      </div>
      {actor?.operator && t.roster.length > 1 && (
        <Section title="Squad captain">
          <Command s={s} command="reassignCaptain" fields={{ squad: t.id }} label="Assign captain">
            <Select
              name="player"
              label="New captain"
              items={t.roster.filter((id) => id !== t.captain).map((id) => [id, s.players[id]])}
            />
          </Command>
        </Section>
      )}
    </>
  );
}
