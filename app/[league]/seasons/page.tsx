import Link from 'next/link';
import { leagueMetadata } from '@/app/seo';
import { loadLeague, loadLeagueHome } from '@/app/data';
import { Icon } from '@/components/symbols';
import { seasonStages } from '@/components/season-timeline';

export const generateMetadata = ({ params }: { params: Promise<{ league: string }> }) =>
  leagueMetadata(params, 'seasons', 'Seasons', ({ league, seasons }) =>
    'Every season of the ' + league.name + ' Subspace league: ' + seasons.map((s) => s.name).join(', ') + '.');

const shortcuts = [
  ['standings', 'Standings'],
  ['playoffs', 'Playoffs'],
] as const;

// The league's season in progress, then the finished ones it keeps as history
export default async function Seasons({ params }: { params: Promise<{ league: string }> }) {
  const { league, seasons: entries, actor } = await loadLeagueHome(params);
  const seasons = await Promise.all(
    entries.map(async (entry) => ({ ...entry, view: (await loadLeague(entry.slug, league.slug)).season! })),
  );
  seasons.sort((a, b) => Number(a.over) - Number(b.over));
  const active = seasons.find((s) => !s.over);
  return (
    <div className="season-page">
      <header className="page-head">
        <h1>Seasons</h1>
        <p>{league.name}</p>
      </header>
      {seasons.length ? <div className="season-directory">
        {seasons.map(({ view, ...s }) => {
          const stages = seasonStages(view);
          const stage = stages.find((x) => x.state === 'current') ?? stages.at(-1)!;
          return (
            <article className="season-card" key={s.id}>
              <img src={s.over ? '/images/season.webp' : '/images/hero.webp'} alt="" loading="lazy" />
              <div className="season-card-body">
                <p className="eyebrow">{!s.over ? 'Active season' : view.champion ? 'Completed season' : 'Closed season'}</p>
                <h2><Link href={view.base}>{s.name}<Icon name="arrow" /></Link></h2>
                <p className="season-progress">
                  {view.champion ? 'Champion · ' + stage.detail : view.closed ? 'Ended without a champion' : stage.label + ' · ' + stage.detail.split(' · ')[0]}
                </p>
                <nav aria-label={s.name}>
                  <Link href={view.base + '/schedule'}>{s.over ? 'Results' : 'Schedule'}</Link>
                  {shortcuts.map(([path, label]) => (
                    <Link key={path} href={view.base + '/' + path}>{label}</Link>
                  ))}
                </nav>
              </div>
            </article>
          );
        })}
      </div> : <p className="empty-box">No seasons yet.</p>}
      {actor?.operator && (
        <p className="directory-foot">
          {active ? (
            <>A league runs one season at a time. Finish or close {active.name} before starting the next.</>
          ) : (
            <Link className="button primary" href={'/' + league.slug + '/seasons/new'}>Start a new season</Link>
          )}
        </p>
      )}
    </div>
  );
}
