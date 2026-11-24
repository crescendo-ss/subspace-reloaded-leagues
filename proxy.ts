import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  if (process.env.LEAGUE_DEMO === '1') {
    const port = process.env.PORT || '3000';
    if (!['127.0.0.1:' + port, 'localhost:' + port].includes(request.headers.get('host') ?? ''))
      return new Response('Use the loopback demo address.', { status: 403 });
  }
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const dev = process.env.NODE_ENV === 'development';
  const policy =
    "default-src 'self'; script-src 'self' 'nonce-" +
    nonce +
    "'" +
    (dev ? " 'unsafe-eval'" : '') +
    "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', policy);
  res.headers.set('referrer-policy', 'same-origin');
  res.headers.set('x-content-type-options', 'nosniff');
  return res;
}
