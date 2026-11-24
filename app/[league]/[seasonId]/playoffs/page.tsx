import { methodOf } from '@/src/formation';
import type { Formation } from '@/src/types';
import { playoffPicture, trials } from '@/src/projection';
import { seasonMetadata } from '@/app/seo';
import Link from 'next/link';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { ClinchTag, CutoffLabel, Difference, Disclosure, LeagueRuleRows, Panel, Table, differenceHint, squad } from '@/components/league';
import { playoffStatus } from '@/src/clinch';
import { Bracket } from '@/components/bracket';
import { bracket } from '@/src/competition';
import { seedOrder } from '@/src/bracket-layout';
export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, 'playoffs', 'Playoffs', ({ season: s }) =>
    'Playoffs for ' + s.name + ' in the ' + s.leagueName + ' Subspace league: the race for the top ' + s.playoffSpots + ', qualification odds, the bracket and the qualification rules.');
export default async function Playoffs(props: LeaguePage) {
  const { season: s } = await loadLeaguePage(props, 'playoffs');
  const picture = playoffPicture(s);
  // Before seeding, draw the bracket the current standings would produce
  const series = s.bracket.length
    ? s.bracket
    : s.squads.length >= 2
      ? bracket(picture.table.slice(0, s.playoffSpots).map((t) => t.id), s.format)
      : [];
  // The race for the last place: the squad holding it and the first one outside
  const lastIn = picture.table.length > s.playoffSpots ? picture.table[s.playoffSpots - 1] : undefined;
  const firstOut = picture.table[s.playoffSpots];
  const settled = playoffStatus(picture.table, s.matches, s.playoffSpots);
  // The simulation can land on 100% or 0% for a squad whose place is not yet certain; say so only when it is
  const odds = (id: string) => {
    const chance = picture.chances.get(id)!;
    const status = settled.get(id)?.kind;
    if (chance >= 0.9995 && status !== 'seed' && status !== 'in') return '>99.9%';
    if (chance < 0.0005 && status !== 'out') return '<0.1%';
    return (100 * chance).toFixed(1) + '%';
  };
  // Seed numbers come from the opening round, whose slots run in seeded bracket order
  const opening = series.filter((n) => n.stage === 'Upper' && n.round === 1).flatMap((n) => n.sources);
  const order = seedOrder(opening.length);
  const seeding = new Map(opening.flatMap((ref, i) => ('seed' in ref && ref.seed ? [[ref.seed, order[i]] as const] : [])));
  const format = (s.format === 'double' ? 'Double' : 'Single') + ' elimination · Best of ' + s.bestOf;
  // With a field that is not a power of two, the top seeds skip the first round
  const byes = 2 ** Math.ceil(Math.log2(Math.max(2, s.playoffSpots))) - s.playoffSpots;
  return (
    <>
      <header className="page-head">
        <h1>Playoffs</h1>
        <p>
          {format}
          {s.champion && <span className="champion"> · Champion: {squad(s, s.champion).name}</span>}
        </p>
      </header>
      {!s.bracket.length && s.squads.length >= 2 && (
        <Panel framed title="Playoff race">
          {lastIn && firstOut && s.matches.length > 0 && (
            <p className="race-lead">
              {lastIn.name} holds the final playoff spot at {odds(lastIn.id)} to qualify, with {firstOut.name} next
              in line at {odds(firstOut.id)}.
            </p>
          )}
          <Table
            numericFrom={2}
            columnClass={(i) => (i === 0 ? 'rank' : i === 4 ? 'odds-col' : undefined)}
            rowClass={(i) => (i === s.playoffSpots - 1 && i < picture.table.length - 1 ? 'cutoff' : i >= s.playoffSpots ? 'outside' : undefined)}
            headers={['Seed', 'Squad', 'W–L–D', '+/−', 'Playoff odds']}
            hints={{
              Seed: 'Seeds follow win–loss record, then head-to-head results, then kill differential',
              'W–L–D': 'Wins, losses, draws',
              '+/−': differenceHint,
              'Playoff odds':
                'Chance of qualifying across ' +
                trials.toLocaleString('en-US') +
                ' simulated finishes, using regular-season records and the remaining schedule. Small samples are pulled toward even odds.',
            }}
            rows={picture.table.map((t, i) => [
              i + 1,
              <>
                <Link href={s.base + '/squads/' + squad(s, t.id).slug} className="plain-link">
                  {t.name}
                </Link>
                <ClinchTag status={settled.get(t.id)} />
              </>,
              [t.wins, t.losses, t.draws].join('–'),
              <Difference value={t.killDiff} />,
              <>
                {s.matches.length ? (
                  <span className="odds">
                    <i style={{ width: 100 * picture.chances.get(t.id)! + '%', ['--p' as string]: 100 * picture.chances.get(t.id)! + '%' }} />
                    {odds(t.id)}
                  </span>
                ) : (
                  'Awaiting schedule'
                )}
                {i === s.playoffSpots - 1 && i < picture.table.length - 1 && <CutoffLabel spots={s.playoffSpots} />}
              </>,
            ])}
          />
        </Panel>
      )}
      {!s.bracket.length && s.squads.length < 2 && <p>Seedings appear once two squads are entered.</p>}
      {series.length > 0 && (
        <Panel title={s.bracket.length ? 'Bracket' : 'Projected bracket'}>
          {!s.bracket.length && (
            <p>
              If the season ended today. The top {s.playoffSpots} squads in the standings qualify, and the bracket is
              set once every regular-season match has a result.
            </p>
          )}
          <Bracket
            series={series}
            bestOf={s.bestOf}
            champion={s.champion}
            seed={(id) => seeding.get(id)}
            name={(id) => <Link href={s.base + '/squads/' + squad(s, id).slug}>{squad(s, id).name}</Link>}
            games={(id) => {
              const games = s.matches.filter((m) => m.series === id);
              return games.length
                ? games.map((m) => (
                    <Link key={m.id} className="chip" href={s.base + '/matches/' + m.number}>
                      Game {m.round}
                    </Link>
                  ))
                : null;
            }}
          />
        </Panel>
      )}
      {/* Before a bracket exists the rules are the page; once it does they fold away under it */}
      {s.bracket.length ? (
        <Disclosure title="Season rules"><Rules s={s} byes={byes} /></Disclosure>
      ) : (
        <Panel framed title="Season rules"><Rules s={s} byes={byes} /></Panel>
      )}

    </>
  );
}

// The rules the site applies, in the order a season meets them
function Rules({ s, byes }: { s: { playoffSpots: number; format: string; bestOf: number; minPerTeam: number; reviewTrades: boolean; rules?: { id: string; title: string; body: string }[]; formation: Formation }; byes: number }) {
  return (
    <dl className="rules" id="rules">
      {/* The league's own rules come first: they are what a pilot has to meet before any of the rest applies */}
      <LeagueRuleRows rules={s.rules ?? []} />
      <div>
        <dt>Squads</dt>
        <dd>
          {methodOf(s).label}: {methodOf(s).summary.toLowerCase()}.
          {methodOf(s).draft?.format === 'auction' && ' Each squad has ' + (s.formation.credits ?? 100) + ' credits.'}
          {methodOf(s).kind === 'live' && !!s.formation.squadSize && ' Squads fill to ' + s.formation.squadSize + ' pilots.'}
          {methodOf(s).kind === 'live' && s.formation.salaries !== false && !!s.formation.cap && ' A squad’s first ' + s.formation.cap.picks + ' picks may total at most ' + s.formation.cap.salary + ' salary.'}
          {methodOf(s).kind === 'live' && !!s.formation.clock && ' A squad has ' + s.formation.clock + ' seconds to pick.'}
        </dd>
      </div>
      <div>
        <dt>Standings</dt>
        <dd>
          Squads are ranked on their regular-season win–loss record: most wins first, then fewest losses. A draw
          counts as neither. Playoff games do not count.
        </dd>
      </div>
      <div>
        <dt>Tie-breaks</dt>
        <dd>
          Squads with the same record are separated in this order:
          <ol>
            <li>Head-to-head: most wins in the matches between the squads that are level. Any still level are compared again on the matches between just those squads.</li>
            <li>Kill differential across the regular season</li>
            <li>Squad name, in alphabetical order</li>
          </ol>
        </dd>
      </div>
      <div>
        <dt>Who qualifies</dt>
        <dd>
          The top {s.playoffSpots} squads in the regular-season standings, once every regular-season match has
          a result.
        </dd>
      </div>
      <div>
        <dt>Seeding</dt>
        <dd>
          Seeds follow the final standings and are fixed when the bracket is set. The highest seed meets the
          lowest, so the top two can only meet in the final.
          {byes > 0 && <> With {s.playoffSpots} qualifiers, the top {byes === 1 ? 'seed skips' : byes + ' seeds skip'} the first round.</>}
        </dd>
      </div>
      <div>
        <dt>Format</dt>
        <dd>
          {s.format === 'double'
            ? 'Double elimination: a squad is out after losing two series. If the winner of the losers’ bracket beats the unbeaten finalist, a deciding series is played.'
            : 'Single elimination: losing a series ends a squad’s playoffs.'}{' '}
          {s.bestOf === 1
            ? 'Each series is a single game.'
            : 'Each series is best of ' + s.bestOf + ', won by the first squad to ' + (s.bestOf + 1) / 2 + ' wins.'}{' '}
          A drawn game counts for neither squad and the series plays on.
        </dd>
      </div>
      <div>
        <dt>Clinched and eliminated</dt>
        <dd>
          A squad is marked as clinched once no remaining result can drop it out of the top {s.playoffSpots},
          and eliminated once none can lift it in.
        </dd>
      </div>
      <div>
        <dt>Trades</dt>
        <dd>
          Trades are allowed, one pilot for one pilot. A captain offers one of their pilots for one of another
          squad’s, and the other captain accepts or declines.{' '}
          {s.reviewTrades
            ? 'An accepted trade takes effect once a league operator approves it.'
            : 'An accepted trade takes effect at once; operators do not review it.'}{' '}
          Captains cannot be traded, and no trade can be made while a draft is running.
        </dd>
      </div>
      <div>
        <dt>Releases</dt>
        <dd>
          A captain can release a pilot from their squad at any time outside a draft, as long as the squad keeps
          at least {s.minPerTeam} pilots for any match already booked.
        </dd>
      </div>
    </dl>
  );
}
