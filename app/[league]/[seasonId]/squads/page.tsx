import Link from 'next/link';
import { seasonMetadata } from '@/app/seo';
import { loadLeaguePage, type LeaguePage } from '@/app/data';
export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, 'squads', 'Squads', ({ season: s }) =>
    'Squads and rosters for ' + s.name + ' in the ' + s.leagueName + ' Subspace league' + (s.squads.length ? ': ' + s.squads.map((t) => t.name).join(', ') + '.' : '.'));
export default async function Squads(props: LeaguePage) {
  const { season: s } = await loadLeaguePage(props, 'squads');
  // Once results are in, squads appear in standings order with their rank and record
  const ranked = s.matches.some((m) => m.result && !m.series);
  const rank = new Map(s.standings.map((row, i) => [row.id, i + 1]));
  const ordered = ranked ? [...s.squads].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!) : s.squads;
  const record = (id: string) => {
    const row = s.standings.find((r) => r.id === id)!;
    return {
      text: [row.wins, row.losses, ...(row.draws ? [row.draws] : [])].join('–'),
      label: row.wins + ' wins, ' + row.losses + ' losses, ' + row.draws + ' draws',
    };
  };
  return (
    <>
      <h1>Squads</h1>
      {s.squads.length ? (
        <ul className="squad-cards">
          {ordered.map((team) => (
            <li key={team.id}>
              <Link href={s.base + '/squads/' + team.slug}>
                {ranked && <span className="squad-rank" aria-label={'Rank ' + rank.get(team.id)}>{rank.get(team.id)}</span>}
                <strong className="result-name">{team.name}</strong>
                {ranked ? (
                  <span className="roster-count" aria-label={record(team.id).label}>{record(team.id).text}</span>
                ) : (
                  <span className="roster-count">{team.roster.length} pilots</span>
                )}
              </Link>
              {/* Short rosters are shown whole; a long one is named by its captain and counted */}
              {team.roster.length <= 6 ? (
                <ul className="squad-roster">
                  {[team.captain, ...team.roster.filter((id) => id !== team.captain)].map((id) => (
                    <li key={id}>
                      {s.players[id]}
                      {id === team.captain && <small>Captain</small>}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="squad-roster">
                  <li>{s.players[team.captain]}<small>Captain</small></li>
                  <li className="muted">and {team.roster.length - 1} pilots</li>
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-box">No squads have been formed yet.</p>
      )}
      {(s.draft || s.trades.length > 0) && (
        <Link href={s.base + '/manage'}>View draft and trade activity</Link>
      )}
    </>
  );
}
