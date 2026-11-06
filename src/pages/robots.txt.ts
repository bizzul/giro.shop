import type { APIRoute } from 'astro';
import { robotsTxt } from '../core/seo.ts';
import { siteOrigin } from '../lib/notify.ts';

export const GET: APIRoute = ({ url }) =>
  new Response(robotsTxt(siteOrigin(url.origin)), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
