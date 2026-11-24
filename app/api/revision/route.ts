import { route } from '@/src/http';
import { database } from '@/src/runtime';
import { need } from '@/src/league';
// A season's revision and nothing else: what a page watching a live draft asks for every second or so
export const GET = route(async (req) => {
  const row = (await (await database()).query('SELECT revision FROM seasons WHERE id=$1', [req.nextUrl.searchParams.get('season') ?? ''])).rows[0];
  need(row, 'Season not found.', 404);
  return Response.json({ revision: Number(row.revision) });
});
