import { route, actorFor, jsonInput } from '@/src/http';
import { need } from '@/src/league';
import { execute } from '@/src/service';
export const POST = route(async (req) => {
  const { id, revision, command, params = {} } = await jsonInput(req);
  need(
    typeof id === 'string' &&
      typeof command === 'string' &&
      typeof revision === 'number' &&
      params &&
      typeof params === 'object' &&
      !Array.isArray(params),
    'Invalid season command.',
  );
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    need(typeof value === 'string' || typeof value === 'number', 'Invalid command field.');
    fields[key] = String(value);
  }
  await execute(await actorFor(req), id, revision, command, fields);
  return Response.json({ ok: true });
});
