import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { lookupActor, sessionCookie } from '@/src/auth';
import { database } from '@/src/runtime';
import { leagueData } from '@/src/service';

export const viewer = cache(async () => lookupActor((await cookies()).get(sessionCookie)?.value));
// One season in full, by league and season address. Without a season, the league's current one.
export const loadLeague = cache(async (season?: string, league?: string) => {
  try {
    return await leagueData(await viewer(), season, league);
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404) notFound();
    throw error;
  }
});
export async function loadSeason(params: Promise<{ league: string; seasonId: string }>) {
  const { league, seasonId } = await params;
  const data = await loadLeague(seasonId, league);
  if (!data.season || !data.league) notFound();
  return { ...data, season: data.season, league: data.league };
}
// A league's own pages: its home, its past seasons and its settings
export async function loadLeagueHome(params: Promise<{ league: string }>) {
  const data = await loadLeague(undefined, (await params).league);
  if (!data.league) notFound();
  return { ...data, league: data.league };
}
export type SeasonPage = { params: Promise<{ league: string; seasonId: string }> };

export type LeaguePage = {
  params: Promise<{ league: string; seasonId: string; squadId?: string; matchId?: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function loadLeaguePage({ params, searchParams }: LeaguePage, section = '') {
  const data = await loadSeason(params);
  const { season } = data;
  const { league, seasonId, squadId, matchId } = await params;
  const squad = squadId ? season.squads.find((t) => t.slug === squadId || t.id === squadId) : undefined;
  const match = matchId
    ? season.matches.find((m) => String(m.number) === matchId || m.id === matchId)
    : undefined;
  if ((squadId && !squad) || (matchId && !match)) notFound();
  if (
    league !== season.leagueSlug ||
    seasonId !== season.slug ||
    (squad && squadId !== squad.slug) ||
    (match && matchId !== String(match.number))
  ) {
    const parts = [season.base];
    if (section) parts.push(section);
    if (squad) parts.push(squad.slug);
    if (match) parts.push(String(match.number));
    const query = new URLSearchParams();
    for (const [key, values] of Object.entries(await searchParams)) {
      if (values !== undefined) for (const value of [values].flat()) query.append(key, value);
    }
    permanentRedirect(parts.join('/') + (query.size ? '?' + query : ''));
  }
  return { ...data, squad, match };
}
