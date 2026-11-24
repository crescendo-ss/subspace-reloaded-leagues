import { titleSeries } from '@/src/bracket-layout';
import Link from 'next/link';
import { Icon } from '@/components/symbols';
import { leagueMetadata } from '@/app/seo';
import { loadLeague, loadLeagueHome } from '@/app/data';
import { LocalTime } from '@/components/interactive';

export const generateMetadata = ({ params }: { params: Promise<{ league: string }> }) =>
  leagueMetadata(params, 'champions', 'Champions', ({ league }) =>
    'Champions of the ' + league.name + ' Subspace league: the reigning champion and the winner of every earlier season.');

// The league's roll of honour: the reigning champion, then the winner of every earlier season.
export default async function Champions({ params }: { params: Promise<{ league: string }> }) {
  const { league, seasons: entries } = await loadLeagueHome(params);
  const seasons = await Promise.all(
    entries.map(async (entry) => (await loadLeague(entry.slug, league.slug)).season!),
  );
  const honours = seasons.map((s) => {
    const squad = (id?: string | null) => s.squads.find((t) => t.id === id);
    // The series that settled the title: the last one in the bracket that was actually played
    const final = titleSeries(s.bracket);
    const runnerUp = final?.sides?.find((id) => id && id !== s.champion);
    const wins = final?.sides?.map((id, i) => [id, final.score?.[i] ?? 0] as const) ?? [];
    const decided = s.matches
      .filter((m) => m.result)
      .map((m) => m.attempts.at(-1)?.endedAt ?? m.result!.recordedAt)
      .sort()
      .at(-1);
    return {
      s,
      champion: squad(s.champion),
      runnerUp: squad(runnerUp),
      score: s.champion && final ? [wins.find(([id]) => id === s.champion)?.[1], wins.find(([id]) => id !== s.champion)?.[1]].join('–') : undefined,
      decided,
      record: s.standings.find((row) => row.id === s.champion),
    };
  });
  const [reigning, ...earlier] = honours.filter((h) => h.champion);
  const current = honours.find((h) => !h.s.over);
  const closed = honours.filter((h) => h.s.closed);
  return (
    <div className="season-page">
      <header className="page-head">
        <h1>Champions</h1>
        <p>{league.name}</p>
      </header>
      {reigning ? (
        <section className="reigning" aria-label="Reigning champion">
          <p className="eyebrow">Reigning champion · {reigning.s.name}</p>
          <h2>
            <Link href={reigning.s.base + '/squads/' + reigning.champion!.slug}>{reigning.champion!.name}</Link>
          </h2>
          <p className="reigning-line">
            {reigning.runnerUp && <>Beat {reigning.runnerUp.name}{reigning.score && ' ' + reigning.score} in the final</>}
            {reigning.record && <> · {[reigning.record.wins, reigning.record.losses, reigning.record.draws].join('–')} in the regular season</>}
            {reigning.decided && <> · <LocalTime iso={reigning.decided} dateOnly /></>}
          </p>
          <ul className="reigning-roster">
            {[reigning.champion!.captain, ...reigning.champion!.roster.filter((id) => id !== reigning.champion!.captain)].map((id) => (
              <li key={id}>
                <Link href={'/' + league.slug + '/pilots/' + id}>{reigning.s.players[id]}</Link>
                {id === reigning.champion!.captain && <small>Captain</small>}
              </li>
            ))}
          </ul>
          <Link className="arrow-link" href={reigning.s.base + '/playoffs'}>See the bracket <Icon name="arrow" /></Link>
        </section>
      ) : (
        <p className="empty-box">No season has crowned a champion yet.</p>
      )}
      {current && (
        <p className="between-seasons">
          {current.s.name} is in progress. <Link href={current.s.base}>Follow the season</Link>
        </p>
      )}
      {earlier.length > 0 && (
        <section className="panel framed">
          <div className="panel-head"><h2>Previous champions</h2></div>
          <div className="panel-body"><div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Champion</th>
                  <th scope="col">Runner-up</th>
                  <th scope="col" className="number">Final</th>
                  <th scope="col" className="number">Decided</th>
                </tr>
              </thead>
              <tbody>
                {earlier.map((h) => (
                  <tr key={h.s.id}>
                    <td><Link href={h.s.base} className="plain-link">{h.s.name}</Link></td>
                    <td><Link href={h.s.base + '/squads/' + h.champion!.slug} className="plain-link">{h.champion!.name}</Link></td>
                    <td>{h.runnerUp?.name ?? '–'}</td>
                    <td className="number">{h.score ?? '–'}</td>
                    <td className="number">{h.decided ? <LocalTime iso={h.decided} dateOnly /> : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </section>
      )}
      {closed.length > 0 && (
        <p className="directory-foot">
          Ended without a champion: {closed.map((h, i) => (
            <span key={h.s.id}>{i > 0 && ', '}<Link href={h.s.base}>{h.s.name}</Link></span>
          ))}
        </p>
      )}
    </div>
  );
}
