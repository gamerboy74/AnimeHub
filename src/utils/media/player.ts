/**
 * Utility functions for player navigation and progress handling
 */

/**
 * Generate a player URL with progress parameter for continue watching
 */
export function generatePlayerUrl(
  animeId: string, 
  episodeNumber: number, 
  progressSeconds?: number
): string {
  const baseUrl = `/player/${animeId}/${episodeNumber}`;
  
  if (progressSeconds && progressSeconds > 0) {
    return `${baseUrl}?progress=${Math.floor(progressSeconds)}&continue=true`;
  }
  
  return baseUrl;
}

/**
 * Format time duration for display
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

/**
 * Format progress percentage
 */
export function formatProgress(current: number, total: number): string {
  if (total === 0) return '0%';
  const percentage = Math.round((current / total) * 100);
  return `${percentage}%`;
}

/**
 * Choose the best video quality based on network conditions
 */
export function chooseBestQuality(available: string[]): string {
  // Try to use Network Information API when available
  const nav = navigator as any;
  const effectiveType: string | undefined = nav?.connection?.effectiveType;
  const downlink: number | undefined = nav?.connection?.downlink;

  const prefer = (quality: string) => available.includes(quality);

  if (effectiveType) {
    // Map connection quality to video quality tiers
    if (effectiveType.includes('2g')) return prefer('360p') ? '360p' : available[0];
    if (effectiveType.includes('3g')) return prefer('480p') ? '480p' : available[0];
    if (effectiveType.includes('4g')) return prefer('720p') ? '720p' : (prefer('480p') ? '480p' : available[0]);
  }

  if (downlink !== undefined) {
    if (downlink < 1.5) return prefer('360p') ? '360p' : available[0];
    if (downlink < 3) return prefer('480p') ? '480p' : available[0];
    if (downlink < 6) return prefer('720p') ? '720p' : available[0];
  }

  // Default to highest reasonable tier
  return prefer('1080p') ? '1080p' : prefer('720p') ? '720p' : available[available.length - 1];
}