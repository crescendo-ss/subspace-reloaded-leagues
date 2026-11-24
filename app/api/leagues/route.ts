import { route, actorFor, jsonInput } from '@/src/http';
import { deleteLeague, newLeague } from '@/src/service';
export const POST = route(async (req) =>
  Response.json(await newLeague(await actorFor(req), await jsonInput(req)), { status: 201 }),
);
// Deleting names the league by ID or address and repeats its name as confirmation.
export const DELETE = route(async (req) => {
  const input = await jsonInput(req);
  return Response.json(await deleteLeague(await actorFor(req), String(input.league ?? ''), input.confirm));
});
