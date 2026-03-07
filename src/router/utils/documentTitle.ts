/**
 * Document Title Management
 * Dynamically updates document title based on current route
 */

import { getRouteMetadata } from '../metadata';

const DEFAULT_TITLE = 'AnimeHub - Your Magical Gateway to Anime';
const TITLE_SEPARATOR = ' | ';

/**
 * Update document title based on route
 */
export function updateDocumentTitle(
  path: string,
  params?: Record<string, string>,
  data?: Record<string, unknown>
): void {
  const metadata = getRouteMetadata(path, params, data);
  
  if (metadata?.title) {
    document.title = metadata.title.includes('AnimeHub')
      ? metadata.title
      : `${metadata.title}${TITLE_SEPARATOR}AnimeHub`;
  } else {
    document.title = DEFAULT_TITLE;
  }
}

/**
 * Update meta tags
 */
export function updateMetaTags(
  path: string,
  params?: Record<string, string>,
  data?: Record<string, unknown>
): void {
  const metadata = getRouteMetadata(path, params, data);
  
  if (!metadata) return;

  // Update description
  if (metadata.description) {
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.setAttribute('name', 'description');
      document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute('content', metadata.description);
  }

  // Update keywords
  if (metadata.keywords && metadata.keywords.length > 0) {
    let metaKeywords = document.querySelector('meta[name="keywords"]');
    if (!metaKeywords) {
      metaKeywords = document.createElement('meta');
      metaKeywords.setAttribute('name', 'keywords');
      document.head.appendChild(metaKeywords);
    }
    metaKeywords.setAttribute('content', metadata.keywords.join(', '));
  }

  // Update robots meta
  if (metadata.noIndex) {
    let metaRobots = document.querySelector('meta[name="robots"]');
    if (!metaRobots) {
      metaRobots = document.createElement('meta');
      metaRobots.setAttribute('name', 'robots');
      document.head.appendChild(metaRobots);
    }
    metaRobots.setAttribute('content', 'noindex, nofollow');
  }

  // Update OG tags
  if (metadata.ogImage) {
    let ogImage = document.querySelector('meta[property="og:image"]');
    if (!ogImage) {
      ogImage = document.createElement('meta');
      ogImage.setAttribute('property', 'og:image');
      document.head.appendChild(ogImage);
    }
    ogImage.setAttribute('content', metadata.ogImage);
  }

  // Update OG title
  if (metadata.title) {
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (!ogTitle) {
      ogTitle = document.createElement('meta');
      ogTitle.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitle);
    }
    ogTitle.setAttribute('content', metadata.title);
  }

  // Update OG description
  if (metadata.description) {
    let ogDescription = document.querySelector('meta[property="og:description"]');
    if (!ogDescription) {
      ogDescription = document.createElement('meta');
      ogDescription.setAttribute('property', 'og:description');
      document.head.appendChild(ogDescription);
    }
    ogDescription.setAttribute('content', metadata.description);
  }
}

/**
 * Reset to default title
 */
export function resetDocumentTitle(): void {
  document.title = DEFAULT_TITLE;
}

