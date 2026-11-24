import { NextResponse } from 'next/server';
import { route, jsonInput } from '@/src/http';
import { cookieOptions, demoSession, sessionCookie } from '@/src/auth';
export const POST = route(async (req) => {
  const { id } = await jsonInput(req);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie, await demoSession(Number(id)), cookieOptions(7 * 86400));
  return response;
});
