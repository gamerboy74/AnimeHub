/**
 * Query Parameter Utilities
 * Standardized parsing, validation, and sanitization of URL query parameters
 */

import { useSearchParams as useRouterSearchParams } from 'react-router-dom';

export interface QueryParams {
  [key: string]: string | string[] | undefined;
}

/**
 * Parse and sanitize query parameters
 */
export function parseQueryParams(searchParams: URLSearchParams): QueryParams {
  const params: QueryParams = {};
  
  for (const [key, value] of searchParams.entries()) {
    // Sanitize key and value
    const sanitizedKey = sanitizeParam(key);
    const sanitizedValue = sanitizeParam(value);
    
    // Handle multiple values for same key
    if (params[sanitizedKey]) {
      const existing = params[sanitizedKey];
      if (Array.isArray(existing)) {
        existing.push(sanitizedValue);
      } else {
        params[sanitizedKey] = [existing as string, sanitizedValue];
      }
    } else {
      params[sanitizedKey] = sanitizedValue;
    }
  }
  
  return params;
}

/**
 * Sanitize query parameter value
 */
function sanitizeParam(value: string): string {
  return value
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .substring(0, 500); // Limit length
}

/**
 * Enhanced useSearchParams hook with validation
 */
export function useSearchParams<T extends Record<string, string>>(
  schema?: Record<keyof T, (value: string) => boolean>
): [URLSearchParams, (params: T, options?: { replace?: boolean }) => void] {
  const [searchParams, setSearchParams] = useRouterSearchParams();

  const setParams = (params: T, options: { replace?: boolean } = {}) => {
    const newParams = new URLSearchParams();
    
    // Copy existing params if not replacing
    if (!options.replace) {
      searchParams.forEach((value, key) => {
        newParams.set(key, value);
      });
    }
    
    // Add/update new params
    Object.entries(params).forEach(([key, value]) => {
      // Validate if schema provided
      if (schema && schema[key as keyof T]) {
        const validator = schema[key as keyof T];
        if (value && validator(value)) {
          newParams.set(key, value);
        }
      } else {
        if (value) {
          newParams.set(key, value);
        } else {
          newParams.delete(key);
        }
      }
    });
    
    setSearchParams(newParams, { replace: options.replace ?? false });
  };

  return [searchParams, setParams];
}

/**
 * Get query parameter with type conversion
 */
export function getQueryParam<T = string>(
  searchParams: URLSearchParams,
  key: string,
  defaultValue?: T,
  transform?: (value: string) => T
): T | undefined {
  const value = searchParams.get(key);
  
  if (!value) return defaultValue;
  
  if (transform) {
    try {
      return transform(value);
    } catch {
      return defaultValue;
    }
  }
  
  return value as T;
}

/**
 * Build shareable deep link URL
 */
export function buildDeepLink(
  path: string,
  params?: Record<string, string | number | boolean>,
  query?: Record<string, string | number | boolean>
): string {
  let url = path;
  
  // Add query parameters
  if (query && Object.keys(query).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    });
    url += `?${searchParams.toString()}`;
  }
  
  return url;
}

