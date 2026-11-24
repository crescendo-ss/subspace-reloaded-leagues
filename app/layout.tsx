import { methodOf } from '@/src/formation';
import Link from 'next/link';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { viewer } from './data';
import { configuration, database } from '@/src/runtime';
import { publicSeason } from '@/src/service';
import { AccountLink, LeagueNav, SectionTabs } from '@/components/interactive';
import { Ticker } from '@/components/ticker';
import { tickerItems } from '@/components/ticker-items';
import { inLeague } from '@/src/auth';
import { waitingOn } from '@/src/waiting';
import './globals.css';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  const { name, tagline, description, origin } = configuration();
  return {
    metadataBase: new URL(origin),
    title: { default: tagline + ' · ' + name, template: '%s · ' + name },
    description,
    applicationName: name,
    openGraph: { type: 'website', siteName: name, title: tagline + ' · ' + name, description, url: '/', images: ['/images/hero.webp'] },
    twitter: { card: 'summary_large_image' },
  };
}
export const viewport: Viewport = { themeColor: '#000000', colorScheme: 'dark' };
export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await viewer(),
    config = configuration();
  const useLeagueLogo = /^(?:ssrl(?:\.gg)?|subspace reloaded leagues)$/i.test(config.name.trim());
  const wordmark = config.name.match(/^(.+?)(\.[a-z]{2,})$/i) ?? config.name.match(/^(.+)(\s+league)$/i);
  const store = await database();
  // Each league's current season feeds the navigation's links and the activity ticker
  const leagues = await Promise.all(
    (await store.leagues()).map(async (league) => {
      const current = await store.currentSeasonSlug(league.id);
      const season = current ? await store.read(current, league.id) : null;
      const scoped = inLeague(actor, league);
      return {
        slug: league.slug,
        name: league.name,
        current,
        over: !!season && (!!season.champion || !!season.closed),
        // What the signed-in person is in this league's current season, for their own links
        tools: (scoped?.operator ? 'manage' : season?.squads.some((t) => t.captain === actor?.id) ? 'captain' : undefined) as 'manage' | 'captain' | undefined,
        waiting: season ? waitingOn(season, scoped).length : 0,
        me: actor && season && Object.hasOwn(season.players, actor.id) ? { squad: season.squads.find((t) => t.roster.includes(actor.id))?.slug } : undefined,
        // Squads were placed by hand and the schedule made: there was no draft to show
        // A season that forms its squads without a draft has no draft room to visit
        draftless: !!season && methodOf(season).kind !== 'live' && !season.picks.length && !season.draft,
        // Site admins and the league's own operators have a League settings tab
        settings: !!actor && (!!actor.admin || league.operators.includes(actor.id)),
        items: season ? tickerItems(publicSeason(season, league)) : [],
      };
    }),
  );
  const nav = leagues.map(({ items: _items, ...league }) => league);
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <Ticker feeds={leagues.map(({ slug, name, items }) => ({ slug, name, items }))} />
        <div className="league-shell">
          <header className="site-header">
            <div className="site-header-inner">
              <Link className="brand" href="/" aria-label={config.name + ', ' + config.tagline}>
                {useLeagueLogo ? (
                  <img className="brand-logo" src="/images/ssrl-letters.png" width="442" height="108" alt="" />
                ) : (
                  <span className="wordmark">
                    {wordmark?.[1] ?? config.name}
                    {wordmark && <small>{wordmark[2]}</small>}
                  </span>
                )}
              </Link>
              <LeagueNav leagues={nav} />
              <div className="account">
                <AccountLink name={actor?.name} id={actor?.id} demo={config.demo} leagues={nav} />
              </div>
            </div>
          </header>
          <SectionTabs leagues={nav} />
          <main className="shell" id="content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
