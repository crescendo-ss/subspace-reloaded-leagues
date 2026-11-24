import Link from 'next/link';
import { seasonMetadata } from '@/app/seo';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { Panel, squad } from '@/components/league';
import { Icon } from '@/components/symbols';
import { StatsTable } from '@/components/stats-table';
import { formatStat, leaderStats, qualifyingGames, rankBy, seasonGroups, seasonStats, statValue, type Stage, type StatRow } from '@/src/stats';

export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, 'stats', 'Statistics', ({ season: s }) =>
    'Pilot and squad statistics for ' + s.name + ' in the ' + s.leagueName + ' Subspace league: leaders in kills, damage and accuracy, and every pilot’s season line.');
const stages: [Stage, string][] = [['all', 'All matches'], ['regular', 'Regular season'], ['playoffs', 'Playoffs']];
export default async function Statistics(props: LeaguePage) {
  const { season: s } = await loadLeaguePage(props, 'stats');
  const query = await props.searchParams;
  const one = (key: string) => [query[key]].flat()[0];
  const squads = one('view') === 'squads';
  const hasPlayoffs = s.matches.some((m) => m.series && m.result);
  const stage = (hasPlayoffs && stages.find(([key]) => key === one('stage'))?.[0]) || 'all';
  const group = seasonGroups.find((g) => g.key === one('group')) ?? seasonGroups[0];
  // Links keep the other choices; a default is left out of the address
  const href = (change: Record<string, string>) => {
    const next = { view: squads ? 'squads' : '', stage: stage === 'all' ? '' : stage, group: group === seasonGroups[0] ? '' : group.key, sort: '', ...change };
    const text = new URLSearchParams(Object.entries(next).filter(([, value]) => value)).toString();
    return s.base + '/stats' + (text ? '?' + text : '');
  };
  const totals = seasonStats(s, stage);
  // Pilots who have signed up and not yet played are listed too, so anyone in the season can be found here
  const played = new Set(totals.pilots.map((row) => row.id));
  const waiting = Object.entries(s.players)
    .filter(([id]) => !played.has(id))
    .map(([id, name]) => ({ id, name, squad: s.squads.find((t) => t.roster.includes(Number(id)))?.id, counters: { games: 0, wins: 0 } }));
  const rows = squads ? totals.squads.filter((row) => row.counters.games > 0) : [...totals.pilots, ...waiting];
  // A leader card opens the full ranking on its own statistic
  const groupOf = (key: string) => seasonGroups.find((g) => g.stats.some((stat) => stat.key === key && key !== 'games')) ?? seasonGroups[0];
  const qualified = (row: StatRow) => squads || row.counters.games >= qualifyingGames;
  const shortfall = 'Fewer than ' + qualifyingGames + ' games: not ranked on rates';
  const squadName = (id?: string) => (id && s.squads.some((t) => t.id === id) ? squad(s, id).name : undefined);
  // A leaderboard needs its statistic to have been reported, and a rate needs pilots who qualify
  const leaders = squads ? [] : leaderStats.flatMap((stat) => {
    const top = rankBy(rows.filter((row) => statValue(stat, row.counters) !== null && (!stat.rate || qualified(row))), stat).slice(0, 3);
    return top.length ? [{ stat, top }] : [];
  });
  // A column is shown once any row has the figure, so a season imported with a few counters stays tidy
  const columns = group.stats.filter((stat) => rows.some((row) => statValue(stat, row.counters) !== null));
  const pills = (label: string, items: [string, string, boolean][]) => (
    <nav className="filters" aria-label={label}>
      {items.map(([text, to, on]) => <Link key={text} href={to} aria-current={on ? 'true' : undefined} scroll={false}>{text}</Link>)}
    </nav>
  );
  return (
    <>
      <h1>Statistics</h1>
      {/* What the whole page counts: who, and over which matches */}
      <div className="toolbar">
        {pills('Statistics by participant', [['Pilots', href({ view: '' }), !squads], ['Squads', href({ view: 'squads' }), squads]])}
        {hasPlayoffs && pills('Matches counted', stages.map(([key, label]) => [label, href({ stage: key === 'all' ? '' : key }), stage === key]))}
      </div>
      {!rows.length ? (
        <p className="empty-box">{s.matches.some((m) => m.result) ? 'No statistics were recorded for these matches.' : 'Statistics appear once the first match has been played.'}</p>
      ) : (
        <>
          {leaders.length > 0 && (
            <Panel title="Leaders">
              <ul className="leaders">
                {leaders.map(({ stat, top }) => (
                  <li key={stat.key} title={stat.title + (stat.rate ? '. Pilots with at least ' + qualifyingGames + ' games.' : '')}>
                    <p className="card-meta"><Link href={href({ group: groupOf(stat.key) === seasonGroups[0] ? '' : groupOf(stat.key).key, sort: stat.key }) + '#ranking'}>{stat.name ?? stat.label}</Link><Icon name="arrow" /></p>
                    <ol>
                      {top.map((row) => (
                        <li key={row.id}>
                          <span><Link href={'/' + s.leagueSlug + '/pilots/' + row.id}>{row.name}</Link><small>{squadName(row.squad)}</small></span>
                          <b>{formatStat(stat, statValue(stat, row.counters))}</b>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <div id="ranking" className="anchor" />
          <Panel
            framed
            title={squads ? 'Squads' : 'All pilots'}
            action={pills('Statistics shown', seasonGroups.map((g) => [g.label, href({ group: g === seasonGroups[0] ? '' : g.key }), g === group]))}
          >
            {columns.length > 1 ? (
              <>
                <StatsTable
                  key={group.key + stage + squads + (one('sort') ?? '')}
                  search={!squads}
                  subject={squads ? 'Squad' : 'Pilot'}
                  shortfall={shortfall}
                  initial={columns.find((c) => c.key === one('sort'))?.key ?? columns.find((c) => c.key !== 'games' && c.key !== 'wins')?.key ?? columns[0].key}
                  columns={columns.map(({ key, label, title, rate, lowIsBetter }) => ({ key, label, title, rate, lowIsBetter }))}
                  rows={rows.map((row) => {
                    const values = columns.map((stat) => statValue(stat, row.counters));
                    return {
                      id: row.id,
                      name: row.name,
                      href: squads ? s.base + '/squads/' + squad(s, row.id).slug : '/' + s.leagueSlug + '/pilots/' + row.id,
                      note: squads ? undefined : squadName(row.squad),
                      qualified: qualified(row),
                      values,
                      text: values.map((value, i) => formatStat(columns[i], value)),
                    };
                  })}
                />
                {/* A phone has no hover, so the headings are spelled out under the table */}
                <dl className="stat-key">
                  {columns.map((stat) => <div key={stat.key}><dt>{stat.label}</dt><dd>{stat.title}</dd></div>)}
                </dl>
              </>
            ) : (
              <p className="muted">These figures were not recorded for this season’s matches.</p>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
