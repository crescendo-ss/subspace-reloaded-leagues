import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { seasonMetadata } from '@/app/seo';
import Link from 'next/link';
import { Panel, Rankings } from '@/components/league';
import { Icon } from '@/components/symbols';
export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, 'standings', 'Standings', ({ season: s }) =>
    'Standings for ' + s.name + ' in the ' + s.leagueName + ' Subspace league: wins, losses, kill differential, recent form and the playoff line.');
export default async function Standings(props: LeaguePage) {
  const { season: s } = await loadLeaguePage(props, 'standings');
  const played = s.matches.filter((m) => !m.series && m.result).length,
    regular = s.matches.filter((m) => !m.series).length;
  return (
    <>
      <h1>Standings</h1>
      {s.squads.length ? (
        <Panel framed title={<>Regular season{regular > 0 && <small>{played} of {regular} matches played</small>}</>} action={<Link href={s.base + '/playoffs#rules'}>Season rules <Icon name="arrow" /></Link>}>
          {/* A phone has room for four columns: the wide table's would run off its edge */}
          <div className="wide-only"><Rankings s={s} /></div>
          <div className="narrow-only"><Rankings s={s} compact formBelow /></div>
        </Panel>
      ) : (
        <p className="empty-box">No squads have been formed yet.</p>
      )}
    </>
  );
}
