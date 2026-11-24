import { seasonSections } from '@/src/sections';
import type { MetadataRoute } from 'next';
import { configuration, database } from '@/src/runtime';

export const dynamic = 'force-dynamic';
// Every public page: the front page, each league's own pages, and each season's pages, squads and matches.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const store = await database(),
    origin = configuration().origin;
  const pages: MetadataRoute.Sitemap = [{ url: origin + '/', changeFrequency: 'daily', priority: 1 }];
  for (const league of await store.leagues()) {
    const home = origin + '/' + league.slug;
    pages.push({ url: home, changeFrequency: 'daily', priority: 0.9 });
    for (const section of ['seasons', 'champions']) pages.push({ url: home + '/' + section, changeFrequency: 'weekly' });
    for (const entry of await store.listSeasonNames(league.id)) {
      const season = await store.read(entry.id);
      const base = home + '/' + season.slug;
      // A finished season no longer changes
      const changeFrequency = entry.over ? 'yearly' : 'daily';
      pages.push({ url: base, changeFrequency });
      for (const section of seasonSections) if (section.sitemap) pages.push({ url: base + '/' + section.route, changeFrequency });
      for (const squad of season.squads) pages.push({ url: base + '/squads/' + squad.slug, changeFrequency });
      for (const match of season.matches)
        pages.push({
          url: base + '/matches/' + match.number,
          changeFrequency: match.result ? 'yearly' : changeFrequency,
          lastModified: match.result?.recordedAt,
        });
    }
  }
  return pages;
}
