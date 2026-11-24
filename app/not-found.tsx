import Link from 'next/link';
import { database } from '@/src/runtime';
import { Icon } from '@/components/symbols';

export const metadata = { title: 'Page not found' };
// The site's own "not found", on its black ground whatever the visitor's system theme, with ways on
export default async function NotFound() {
  const leagues = await (await database()).leagues().catch(() => []);
  return (
    <div className="form-page not-found">
      <p className="eyebrow">404</p>
      <h1>This page is not here</h1>
      <p>The address may be mistyped, or the league, season or match it pointed to may have been removed.</p>
      <ul className="link-list">
        <li><Link className="arrow-link" href="/">All leagues <Icon name="arrow" /></Link></li>
        {leagues.slice(0, 5).map((league) => (
          <li key={league.id}><Link className="arrow-link" href={'/' + league.slug}>{league.name} <Icon name="arrow" /></Link></li>
        ))}
      </ul>
    </div>
  );
}
