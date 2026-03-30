// api/stream-proxy.ts
// Place this file in the ROOT of your AnimeHub web repo (not in src/)
// Vercel auto-detects api/ folder and deploys it as a serverless function.
// Live at: https://anime-hub-puce.vercel.app/api/stream-proxy

export const config = {
  runtime: 'edge',
};

const ALLOWED_HOSTS = [
  'megacloud.tv',
  'megaplay.buzz',
  'megacloud.bloggy.click',
  'rapidcloud.cc',
  'streamsb.net',
  'streamtape.com',
  'hianime.to',
];

const SPOOF_HEADERS: Record<string, string> = {
  'Referer': 'https://hianime.to/',
  'Origin': 'https://hianime.to',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
};

export default async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight (needed for mobile app requests)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');

  // ── Validate ────────────────────────────────────────────────────────────────
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'url param required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(decodeURIComponent(targetUrl));
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Security: only proxy known stream hosts ─────────────────────────────────
  const isAllowed = ALLOWED_HOSTS.some(host => parsedUrl.hostname.includes(host));
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: `Host not allowed: ${parsedUrl.hostname}` }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Fetch from upstream with spoofed headers ────────────────────────────────
  let upstream: Response;
  try {
    upstream = await fetch(parsedUrl.toString(), {
      headers: SPOOF_HEADERS,
      redirect: 'follow',
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Upstream fetch failed', detail: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream returned ${upstream.status}` }),
      { status: upstream.status, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const contentType = upstream.headers.get('content-type') || '';
  const isM3U8 =
    parsedUrl.pathname.includes('.m3u8') ||
    contentType.includes('mpegurl') ||
    contentType.includes('x-mpegURL');

  // ── HLS Manifest (.m3u8) — rewrite segment URLs to also go through proxy ───
  if (isM3U8) {
    const text = await upstream.text();
    const baseUrl = parsedUrl.toString().substring(0, parsedUrl.toString().lastIndexOf('/') + 1);
    const proxyBase = `https://anime-hub-puce.vercel.app/api/stream-proxy?url=`;

    const rewritten = text
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed === '') return line;

        // Absolute URL
        if (trimmed.startsWith('http')) {
          return `${proxyBase}${encodeURIComponent(trimmed)}`;
        }

        // Relative URL → make absolute then proxy
        return `${proxyBase}${encodeURIComponent(baseUrl + trimmed)}`;
      })
      .join('\n');

    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // ── TS Segments — pipe binary directly ──────────────────────────────────────
  const buffer = await upstream.arrayBuffer();
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'video/mp2t',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}