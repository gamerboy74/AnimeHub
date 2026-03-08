/**
 * Utility to convert external image URLs into proxied URLs via our backend.
 * Uses relative URLs so Vite's dev proxy and production reverse-proxy both work.
 * 
 * @param url The original image URL (e.g., from Anilist)
 * @returns The proxied URL, or the original if no valid URL is provided
 */
export function getProxiedImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  
  // If it's already a relative URL (hosted on our domain), no need to proxy
  if (url.startsWith('/')) {
    return url;
  }

  // If it's an external URL, route it through our API proxy using a relative path.
  // In dev, Vite's proxy config forwards /api → http://localhost:3001.
  // In prod, VITE_API_URL can override to an absolute backend URL if needed.
  if (url.startsWith('http')) {
    const API_URL = import.meta.env.VITE_API_URL;
    
    if (API_URL) {
      const cleanApiUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
      return `${cleanApiUrl}/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
    
    // Use relative URL — works with Vite proxy in dev and reverse-proxy in prod
    return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  }

  return url;
}

/**
 * Returns the original (direct CDN) URL from a proxied URL, for use as a fallback.
 */
export function getDirectImageUrl(proxiedUrl: string): string | null {
  try {
    const urlObj = new URL(proxiedUrl, window.location.origin);
    const original = urlObj.searchParams.get('url');
    return original ? decodeURIComponent(original) : null;
  } catch {
    return null;
  }
}
