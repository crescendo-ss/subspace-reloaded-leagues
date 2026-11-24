import { NextRequest, NextResponse } from 'next/server';
import { need } from './league.ts';
import { configuration } from './runtime.ts';
import { lookupActor, sessionCookie } from './auth.ts';

export function route(handler: (req: NextRequest) => Promise<Response> | Response) {
  return async (req: NextRequest) => {
    try {
      const response = await handler(req);
      response.headers.set('cache-control', 'no-store');
      return response;
    } catch (error) {
      const status =
        error instanceof Error && 'status' in error ? Number(error.status) : 500;
      if (status === 500) console.error(error);
      return NextResponse.json(
        { error: status === 500 ? 'Internal server error.' : (error as Error).message },
        { status, headers: { 'cache-control': 'no-store' } },
      );
    }
  };
}
export const actorFor = (req: NextRequest) => lookupActor(req.cookies.get(sessionCookie)?.value);
export async function rawBody(req: Request) {
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          need(false, 'Request too large.', 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  return Buffer.concat(chunks);
}
export async function jsonInput(req: Request): Promise<Record<string, unknown>> {
  const c = configuration();
  const origins = c.demo ? [c.origin, 'http://localhost:' + c.port] : [c.origin];
  need(
    origins.includes(req.headers.get('origin') || '') &&
      req.headers.get('content-type')?.startsWith('application/json'),
    'Same-origin JSON request required.',
    403,
  );
  // Only what the client sent is the client's mistake; a parse error anywhere else is a fault here
  let data: unknown;
  try {
    data = JSON.parse((await rawBody(req)).toString());
  } catch {
    need(false, 'The request is not valid JSON.');
  }
  need(data && typeof data === 'object' && !Array.isArray(data), 'Expected a JSON object.');
  return data as Record<string, unknown>;
}
