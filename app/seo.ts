import type { Metadata } from 'next';
import { loadLeagueHome, loadLeaguePage, type LeaguePage } from './data';
import { configuration } from '@/src/runtime';

// What search engines and link previews are told about a page: its title, a sentence about it, and its one
// permanent address.
function page(title: string, description: string, canonical: string, shared = title): Metadata {
  const { name } = configuration();
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', siteName: name, title: shared, description, url: canonical, images: ['/images/hero.webp'] },
  };
}
type SeasonData = Awaited<ReturnType<typeof loadLeaguePage>>;
type LeagueData = Awaited<ReturnType<typeof loadLeagueHome>>;
const text = <T,>(value: string | ((data: T) => string), data: T) => (typeof value === 'function' ? value(data) : value);

export async function seasonMetadata(
  props: LeaguePage,
  section: string,
  title: string | ((data: SeasonData) => string),
  describe: (data: SeasonData) => string,
): Promise<Metadata> {
  const data = await loadLeaguePage(props, section);
  const { season: s, squad, match } = data;
  const path = [s.base, section, squad?.slug, match?.number].filter((part) => part !== undefined && part !== '').join('/');
  const heading = text(title, data);
  return page(heading, describe(data), path, heading + ' · ' + s.name);
}
export async function leagueMetadata(
  params: Promise<{ league: string }>,
  section: string,
  title: string | ((data: LeagueData) => string),
  describe: (data: LeagueData) => string,
): Promise<Metadata> {
  const data = await loadLeagueHome(params);
  const heading = text(title, data);
  return page(heading, describe(data), '/' + data.league.slug + (section ? '/' + section : ''), heading === data.league.name ? heading : heading + ' · ' + data.league.name);
}
// Pages for signed-in work, which have nothing for a search result to show
export const noIndex: Metadata = { robots: { index: false, follow: false } };
// Structured data, written so that nothing in it can close the script element early
export const jsonLd = (data: object) => ({ __html: JSON.stringify(data).replace(/</g, '\\u003c') });
