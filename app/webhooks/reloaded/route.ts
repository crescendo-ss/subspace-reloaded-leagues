import { configuration, database } from '@/src/runtime';
import { deliver, verifyEvent } from '@/src/reloaded';
import { need } from '@/src/league';
import { rawBody, route } from '@/src/http';
export const POST = route(async (req) => {
  const config = configuration();
  need(!config.demo, 'Live callbacks are disabled in the demo.', 404);
  const event = verifyEvent(Object.fromEntries(req.headers), await rawBody(req), config.webhookSecret);
  await deliver(await database(), event);
  return Response.json({ ok: true });
});
