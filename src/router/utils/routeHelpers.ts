/**
 * Route Helper Utilities
 * Validation, state persistence, and navigation helpers
 */

import { buildDeepLink, parseQueryParams } from './queryParams';

/**
 * Validate route path
 */
export function isValidRoute(path: string): boolean {
  // Basic validation - check if path starts with /
  return typeof path === 'string' && path.startsWith('/') && path.length > 0;
}

/**
 * Normalize route path
 */
export function normalizeRoute(path: string): string {
  // Remove trailing slashes except for root
  if (path === '/') return '/';
  return path.replace(/\/+$/, '');
}

/**
 * Extract route parameters from path
 */
export function extractRouteParams(
  path: string,
  pattern: string
): Record<string, string> | null {
  const patternRegex = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
  const match = path.match(patternRegex);
  
  if (!match) return null;
  
  const paramNames = pattern.match(/:[^/]+/g)?.map(name => name.slice(1)) || [];
  const params: Record<string, string> = {};
  
  paramNames.forEach((name, index) => {
    params[name] = match[index + 1];
  });
  
  return params;
}

/**
 * Build route path with parameters
 */
export function buildRoutePath(
  pattern: string,
  params: Record<string, string | number>
): string {
  let path = pattern;
  
  Object.entries(params).forEach(([key, value]) => {
    path = path.replace(`:${key}`, String(value));
  });
  
  return path;
}

/**
 * Check if two routes match
 */
export function routesMatch(path1: string, path2: string): boolean {
  return normalizeRoute(path1) === normalizeRoute(path2);
}

/**
 * Get route hierarchy level
 */
export function getRouteLevel(path: string): number {
  return path.split('/').filter(Boolean).length;
}

/**
 * Check if route is child of parent route
 */
export function isChildRoute(child: string, parent: string): boolean {
  const normalizedChild = normalizeRoute(child);
  const normalizedParent = normalizeRoute(parent);
  
  if (normalizedParent === '/') return child !== '/';
  
  return normalizedChild.startsWith(normalizedParent + '/');
}

/**
 * Create shareable link
 */
export function createShareableLink(
  path: string,
  params?: Record<string, string | number | boolean>,
  query?: Record<string, string | number | boolean>
): string {
  const baseUrl = typeof window !== 'undefined' 
    ? window.location.origin 
    : '';
  
  const routePath = params ? buildRoutePath(path, params as Record<string, string | number>) : path;
  
  return baseUrl + buildDeepLink(routePath, undefined, query);
}

