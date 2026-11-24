import { route, actorFor, jsonInput } from '@/src/http';
import { newSeason } from '@/src/service';
export const POST = route(async (req) =>
  Response.json(await newSeason(await actorFor(req), await jsonInput(req)), { status: 201 }),
);
