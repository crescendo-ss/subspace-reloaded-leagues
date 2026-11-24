import Link from 'next/link';
import { seasonMetadata } from '@/app/seo';
import { MatchCard } from '@/components/match-card';
import { notFound } from 'next/navigation';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
import {
  Panel,
  Section,
  Setting,
  Disclosure,
  seriesLabel,
  Field,
  Select,
  Command,
  Table,
  SignInPrompt,
  squad,
} from '@/components/league';
import { LocalTime, CheckInTime } from '@/components/interactive';
import { formatStat, matchGroups, statValue } from '@/src/stats';
export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(
    props,
    'matches',
    ({ season, match }) => (match ? squad(season, match.home).name + ' vs ' + squad(season, match.away).name + ' · Match ' + match.number : 'Match'),
    ({ season: s, match: m }) => {
      if (!m) return 'A match in ' + s.name + '.';
      const home = squad(s, m.home).name,
        away = squad(s, m.away).name;
      const where = (m.series ? 'the playoffs' : 'round ' + m.round) + ' of ' + s.name + ' (' + s.leagueName + ' Subspace league)';
      if (!m.result) return home + ' play ' + away + ' in ' + where + '. Check-in time, squads and records.';
      if (!m.result.winner) return home + ' and ' + away + ' drew in ' + where + '. Scoreboard and pilot statistics.';
      const won = m.result.winner === m.home;
      const score = m.score ? ' ' + (won ? m.score[0] + '–' + m.score[1] : m.score[1] + '–' + m.score[0]) : '';
      return (won ? home : away) + ' beat ' + (won ? away : home) + score + ' in ' + where + '. Scoreboard and pilot statistics.';
    },
  );
export default async function MatchPage(props: LeaguePage) {
  const { season: s, actor, demo, match: m } = await loadLeaguePage(props, 'matches');
  if (!m) notFound();
  const a = m.attempts.at(-1),
    mine = s.squads.find((t) => t.captain === actor?.id && [m.home, m.away].includes(t.id));
  const retry =
    a &&
    (['cancelled', 'no_show'].includes(a.state) || ['abandoned', 'cancelled'].includes(a.resolution ?? ''));
  const home = squad(s, m.home).name,
    away = squad(s, m.away).name,
    fields = { match: m.id };
  // The box score: one squad's pilots to a table, in the group of statistics chosen. A group is offered
  // only when the match reported its figures.
  const scored = m.result?.players ?? [];
  const groups = matchGroups
    .map((g) => ({ ...g, stats: g.stats.filter((stat) => scored.some((p) => statValue(stat, p.metrics) !== null)) }))
    .filter((g) => g.stats.length);
  const chosen = [(await props.searchParams).stats].flat()[0];
  const group = groups.find((g) => g.key === chosen) ?? groups[0];
  const sides = [m.home, m.away].map((id) => {
    const pilots = scored.filter((p) => p.squad === id).sort((x, y) => (y.metrics.kills ?? 0) - (x.metrics.kills ?? 0) || (x.metrics.deaths ?? 0) - (y.metrics.deaths ?? 0));
    const total: Record<string, number> = {};
    for (const p of pilots) for (const [key, value] of Object.entries(p.metrics)) if (Number.isFinite(value)) total[key] = (total[key] ?? 0) + value;
    return { id, name: squad(s, id).name, pilots, total };
  });
  // What the page says about the match beside its scoreboard
  const node = m.series ? s.bracket.find((n) => n.id === m.series) : undefined;
  const series = (() => {
    if (!node?.sides || !node.score) return null;
    const [x, y] = node.score;
    const lead = x === y ? null : squad(s, node.sides[x > y ? 0 : 1]!).name;
    const tally = Math.max(x, y) + '–' + Math.min(x, y);
    return node.winner ? squad(s, node.winner).name + ' won the series ' + tally : lead ? lead + ' lead ' + tally : x ? 'Level at ' + x + '–' + y : 'Best of ' + s.bestOf;
  })();
  const seconds = a?.endedAt && a.startedAt ? Math.round((Date.parse(a.endedAt) - Date.parse(a.startedAt)) / 1000) : null;
  const links = ([[a?.matchUrl, 'Scoreboard on Reloaded'], [a?.replayUrl, 'Watch the replay']] as const).filter(([url]) => url?.startsWith('https://'));
  const before = s.matches.find((x) => x.number === m.number - 1),
    after = s.matches.find((x) => x.number === m.number + 1);
  const pills = groups.length > 1 && (
    <nav className="filters" aria-label="Statistics shown">
      {groups.map((g) => (
        <Link key={g.key} href={g === groups[0] ? s.base + '/matches/' + m.number : '?stats=' + g.key} aria-current={g === group ? 'true' : undefined} scroll={false}>
          {g.label}
        </Link>
      ))}
    </nav>
  );
  return (
    <>
      <header className="page-head">
        <h1>
          <Link className="plain-link" href={s.base + '/squads/' + squad(s, m.home).slug}>{home}</Link> <span>vs</span>{' '}
          <Link className="plain-link" href={s.base + '/squads/' + squad(s, m.away).slug}>{away}</Link>
        </h1>
        <p>
          {m.series ? seriesLabel(m.series, s) + ' · Game ' + m.round : 'Round ' + m.round} · Match {m.number}
        </p>
      </header>
      <div className="match-top">
        <MatchCard season={s} match={m} variant="detail" context={m.result ? 'Scoreboard' : 'Fixture'} />
        <Panel framed title="Match">
          <dl className="facts">
            <div><dt>Stage</dt><dd>{m.series ? <Link href={s.base + '/playoffs'}>{seriesLabel(m.series, s)}, game {m.round}</Link> : <Link href={s.base + '/schedule?view=all#round-' + m.round}>Regular season, round {m.round}</Link>}</dd></div>
            {series && <div><dt>Series</dt><dd><Link href={s.base + '/playoffs'}>{series}</Link></dd></div>}
            {m.result ? (
              <div><dt>{a?.endedAt ? 'Played' : 'Recorded'}</dt><dd><LocalTime iso={a?.endedAt ?? m.result.recordedAt} /></dd></div>
            ) : a ? (
              <div><dt>Check-in</dt><dd><LocalTime iso={a.opensAt} /> – <LocalTime iso={a.startsBy} /></dd></div>
            ) : (
              <div><dt>Check-in</dt><dd>{m.proposal ? 'A time has been proposed' : 'The captains have yet to agree on a time'}</dd></div>
            )}
            {seconds !== null && seconds >= 0 && <div><dt>Duration</dt><dd>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</dd></div>}
            {m.forfeit ? (
              <div><dt>Decided</dt><dd>{squad(s, m.forfeit).name} forfeited{m.result!.players.length ? '' : '. No game was played'}</dd></div>
            ) : m.result?.source === 'operator' && !m.result.players.length && (
              <div><dt>Decided</dt><dd>By ruling, with no game played</dd></div>
            )}
          </dl>
          {links.length > 0 && (
            <ul className="link-list">
              {links.map(([url, title]) => (
                <li key={title}><a className="arrow-link external" href={url!} rel="noreferrer">{title}<span aria-hidden="true">↗</span></a></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {!actor && !m.result && (
        <SignInPrompt demo={demo} next={s.base + '/matches/' + m.number} title="Sign in to arrange this match">
          The captains of {home} and {away} propose and accept check-in times here once signed in.
        </SignInPrompt>
      )}
      {m.proposal && (
        <Section title="Proposed check-in">
          <p>
            {squad(s, m.proposal.by).name} proposed <LocalTime iso={m.proposal.opensAt} /> –{' '}
            <LocalTime iso={m.proposal.startsBy} />.
          </p>
          {mine && !m.result && mine.id !== m.proposal.by ? (
            <div className="actions">
              <Command
                s={s}
                command="decide"
                fields={{ ...fields, proposal: m.proposal.id, decision: 'accept' }}
                label="Accept time"
                weight="primary"
              />
              <Command
                s={s}
                command="decide"
                fields={{ ...fields, proposal: m.proposal.id, decision: 'decline' }}
                label="Decline time"
              />
            </div>
          ) : (
            <p className="muted">
              Waiting for {squad(s, m.proposal.by === m.home ? m.away : m.home).name} to respond.
            </p>
          )}
        </Section>
      )}
      {a?.error && <p className="notice error">{a.error}</p>}
      {a?.pendingWindow && <p className="notice">Updating the check-in time.</p>}
      {mine && !m.result && (
        <>
          {(!a || retry || ['booked', 'refused'].includes(a.state)) && !a?.pendingWindow && (
            <Disclosure
              open={!a && !m.proposal}
              title={
                retry
                  ? 'Schedule a retry'
                  : m.proposal || a
                    ? 'Propose a different time'
                    : 'Schedule this match'
              }
            >
              <p>
                Each squad needs at least {s.minPerTeam} {s.minPerTeam === 1 ? 'pilot' : 'pilots'} at
                check-in.
              </p>
              <Command s={s} command="propose" label="Propose time" fields={fields} weight="primary">
                <CheckInTime />
                <Field
                  type="number"
                  name="minutes"
                  label="Window length (minutes)"
                  min={1}
                  max={1440}
                  defaultValue={30}
                />
              </Command>
            </Disclosure>
          )}
        </>
      )}
      {m.result && m.result.players.length > 0 && (
        <>
          <div className="panel-head box-score-head">
            <h2>Box score</h2>
            {pills}
          </div>
          {/* Each squad is a panel of its own, with the same columns at the same widths */}
          <div className="panel-pair box-score">
            {sides.filter((side) => side.pilots.length).map((side) => (
              <Panel framed key={side.id} title={<><Link className="plain-link" href={s.base + '/squads/' + squad(s, side.id).slug}>{side.name}</Link>{m.result!.winner === side.id && <small className="won">Winner</small>}</>}>
                <div className="table-wrap">
                  <table className="stats-table dense">
                    <thead>
                      <tr>
                        <th scope="col">Pilot</th>
                        {group.stats.map((stat) => (
                          <th key={stat.key} scope="col" className="number" title={stat.title} aria-label={stat.title}>{stat.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {side.pilots.map((p) => (
                        <tr key={p.id}>
                          <th scope="row"><Link href={'/' + s.leagueSlug + '/pilots/' + p.id}>{s.players[p.id]}</Link></th>
                          {group.stats.map((stat) => (
                            <td key={stat.key} className="number">{formatStat(stat, statValue(stat, p.metrics))}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Squad total</th>
                        {group.stats.map((stat) => (
                          <td key={stat.key} className="number">{formatStat(stat, statValue(stat, side.total))}</td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}
      {!!m.rulings.length && (
        <Panel framed title="Rulings">
          <Table
            headers={['When', 'Outcome', 'Score', 'Reason']}
            rows={m.rulings.map((r) => [
              <LocalTime iso={r.at} dateOnly />,
              r.winner ? squad(s, r.winner).name + (r.forfeit ? ', by forfeit' : '') : 'Draw',
              r.score ? r.score.join('–') : '–',
              r.reason,
            ])}
          />
        </Panel>
      )}
      {!!m.statRulings?.length && (
        <Panel framed title="Statistics corrected">
          <Table
            headers={['When', 'Pilot', 'Statistic', 'Value', 'Reason']}
            rows={m.statRulings.map((r) => [<LocalTime iso={r.at} dateOnly />, s.players[r.id], r.metric, r.value, r.reason])}
          />
        </Panel>
      )}
      {/* What only an operator needs sits at the foot of the page, one task to a row */}
      {actor?.operator && (
        <>
          <p className="group-label">Operator</p>
          <Panel framed title="Operator controls">
            {a && a.state !== 'refused' && (
              <Setting name="Synchronize with the zone" note="Asks Reloaded again for this fixture’s state and result.">
                <Command s={s} command="sync" fields={fields} label="Synchronize" />
              </Setting>
            )}
            {a && !m.result && ['queued', 'booked', 'open'].includes(a.state) && (a.state === 'queued' || a.error) && (
              <Setting name="Abandon this booking" note="For a booking the zone will not take or no longer knows. The match is freed, so the captains can agree another time or you can rule on it. Whatever the zone later reports for this booking is ignored.">
                <Command s={s} command="abandon" fields={fields} label="Abandon booking" weight="danger" />
              </Setting>
            )}
            {(!a || ['complete', 'refused', 'cancelled', 'no_show'].includes(a.state)) && (
              <Setting name="Record a ruling" note="Sets the outcome, and the score if you give one. It replaces the result on record, and the standings and bracket follow. Tick the box for a forfeit and the losing squad is shown as having forfeited wherever the match appears.">
                <Command s={s} command="rule" fields={fields} label="Record ruling" weight="danger">
                  <Select
                    name="winner"
                    label="Outcome"
                    placeholder="Choose an outcome"
                    defaultValue={m.result ? (m.result.winner ?? 'draw') : undefined}
                    items={[
                      [m.home, home + ' wins'],
                      [m.away, away + ' wins'],
                      ['draw', 'Draw'],
                    ]}
                  />
                  <Field name="homeScore" label={home + ' score'} type="number" min={0} max={999} step={1} required={false}
                    defaultValue={m.result?.score?.[0]} title="Optional. Sets the score shown for this match; leave both empty to record only the outcome." />
                  <Field name="awayScore" label={away + ' score'} type="number" min={0} max={999} step={1} required={false}
                    defaultValue={m.result?.score?.[1]} title="Optional. Sets the score shown for this match; leave both empty to record only the outcome." />
                  <Field name="reason" label="Reason for ruling" maxLength={80} />
                  {/* Ticked to begin with when no game was played, which is nearly always a forfeit */}
                  <label className="check" key={String(m.result?.forfeit ?? 'new')}>
                    <input type="checkbox" name="forfeit" defaultChecked={m.result ? !!m.forfeit : !a?.startedAt} />
                    The losing squad forfeited
                  </label>
                </Command>
              </Setting>
            )}
            {m.result && m.resultRoster.length > 0 && (
              <Setting name="Correct a statistic" note="Changes one pilot’s figure for this match. The correction is kept on record and survives a later report from the zone.">
                <Command s={s} command="correctMetric" fields={fields} label="Correct statistic">
                  <Select
                    name="player"
                    label="Pilot"
                    items={m.resultRoster.map((p) => [p.id, s.players[p.id]])}
                  />
                  <Field name="metric" label="Statistic" maxLength={80} placeholder="kills" />
                  <Field name="value" label="Corrected value" type="number" step="any" />
                  <Field name="reason" label="Reason for correction" maxLength={80} />
                </Command>
              </Setting>
            )}
            {demo && a && ['booked', 'open', 'live'].includes(a.state) && (
              <Setting name="Simulate the zone" note="Demo only: stands in for the result Reloaded would send.">
                <Command s={s} command="demoOutcome" fields={fields} label="Simulate callback">
                  <Select
                    name="outcome"
                    label="Demo zone outcome"
                    items={[
                      ['home', 'Home squad wins'],
                      ['away', 'Away squad wins'],
                      ['no_show', 'No-show'],
                      ['cancelled', 'Cancelled'],
                    ]}
                  />
                </Command>
              </Setting>
            )}
          </Panel>
          {m.attempts.length > 0 && (
            <Disclosure title="Fixture attempts">
              <Table
                headers={['Attempt', 'Status', 'Check-in opens', 'Fixture']}
                rows={m.attempts.map((a, i) => [
                  i + 1,
                  [a.state, a.resolution].filter(Boolean).join(' · '),
                  <LocalTime iso={a.opensAt} />,
                  a.fixtureId ?? 'Pending',
                ])}
              />
            </Disclosure>
          )}
          {a?.reportedResult && (
            <Disclosure title="Original match report">
              <pre>{JSON.stringify(a.reportedResult, null, 2)}</pre>
            </Disclosure>
          )}
        </>
      )}
      {(before || after) && (
        <nav className="pager" aria-label="Other matches">
          {before ? <Link href={s.base + '/matches/' + before.number}>← Match {before.number}</Link> : <span />}
          <Link href={s.base + '/schedule?view=all'}>All matches</Link>
          {after ? <Link href={s.base + '/matches/' + after.number}>Match {after.number} →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
