import { NextResponse } from 'next/server';
import { route, jsonInput } from '@/src/http';
import { endSession, cookieOptions, sessionCookie } from '@/src/auth';
export const POST = route(async (req) => {
  await jsonInput(req);
  await endSession(req.cookies.get(sessionCookie)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie, '', cookieOptions(0));
  return res;
});
