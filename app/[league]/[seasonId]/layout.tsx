import type { ReactNode } from 'react';
import { loadSeason, type SeasonPage } from '@/app/data';
import { SeasonNav } from '@/components/interactive';
import { configuration } from '@/src/runtime';
export async function generateMetadata({ params }: SeasonPage) {
  const { season } = await loadSeason(params);
  const site = configuration().name;
  return { title: { default: season.name + ' · ' + site, template: '%s · ' + season.name + ' · ' + site } };
}
export default async function SeasonLayout({ params, children }: SeasonPage & { children: ReactNode }) {
  const { season, seasons, league } = await loadSeason(params);
  return (
    <div className="season-page">
      <header className="season-toolbar">
        <SeasonNav
          league={{ slug: league.slug, name: league.name }}
          slug={season.slug}
          seasons={seasons}
          past={season.over}
        />
      </header>
      {children}
    </div>
  );
}
