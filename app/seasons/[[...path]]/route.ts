import { database } from '@/src/runtime';
import { route } from '@/src/http';

// Season pages used to live at /seasons/<season>/<page>. Send those links, including the older ID-based
// ones, straight to the page's permanent address under its league.
export const GET = route(async (req) => {
  const [key, section, detail, ...rest] = req.nextUrl.pathname.split('/').slice(2).map(decodeURIComponent);
  let target = '/';
  if (key && key !== 'new') {
    const store = await database();
    const season = await store.read(key);
    const parts = ['', (await store.league(season.league!)).slug, season.slug];
    if (section) parts.push(section);
    if (detail) {
      const match = section === 'matches' && season.matches.find((m) => String(m.number) === detail || m.id === detail);
      const squad = section === 'squads' && season.squads.find((t) => t.slug === detail || t.id === detail);
      parts.push(match ? String(match.number) : squad ? squad.slug! : detail, ...rest);
    }
    target = parts.map(encodeURIComponent).join('/');
  }
  return new Response(null, { status: 308, headers: { location: target + req.nextUrl.search } });
});
