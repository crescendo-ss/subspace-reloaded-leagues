import type { MetadataRoute } from 'next';
import { configuration } from '@/src/runtime';

export const dynamic = 'force-dynamic';
// Public pages are open to search engines. Sign-in, the API and the management pages are not for them.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/auth/', '/account', '/webhooks/', '/leagues/new', '/*/manage', '/*/seasons/new'] },
    sitemap: configuration().origin + '/sitemap.xml',
  };
}
