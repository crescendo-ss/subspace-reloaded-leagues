import { route, actorFor } from '@/src/http';
import { leagueData } from '@/src/service';
export const GET = route(async (req) =>
  Response.json(
    await leagueData(await actorFor(req), req.nextUrl.searchParams.get('season'), req.nextUrl.searchParams.get('league')),
  ),
);
