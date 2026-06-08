import { supabase } from '../../lib/database/supabase'

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '')

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>
}

/**
 * Executes a fetch request with auto-injected Supabase Auth JWT token
 * and standardized environment-based base URL.
 * Returns the raw Fetch Response.
 */
export async function apiFetchRaw(endpoint: string, options: RequestOptions = {}): Promise<Response> {
  // Retrieve token from current session
  let token: string | null = null
  try {
    const { data: { session } } = await supabase.auth.getSession()
    token = session?.access_token || null
  } catch (err) {
    console.warn('Failed to retrieve Supabase session for auth token:', err)
  }

  // Construct standard endpoint URL
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  let url = `${API_BASE}${path}`

  // Append query parameters if provided
  if (options.params) {
    const queryParams = new URLSearchParams()
    Object.entries(options.params).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        queryParams.append(key, String(val))
      }
    })
    const queryStr = queryParams.toString()
    if (queryStr) {
      url += (url.includes('?') ? '&' : '?') + queryStr
    }
  }

  // Set up request headers
  const headers = new Headers(options.headers)
  
  // Set JSON content-type if not already specified and not sending FormData
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  // Auto-inject JWT Bearer token if session exists
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(url, {
    ...options,
    headers
  })
}

/**
 * Standard API request wrapper. Performs status code verification,
 * safe error parsing, and automatically parses JSON response payloads.
 */
export async function apiFetch<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const response = await apiFetchRaw(endpoint, options)

  if (!response.ok) {
    let errorMessage = `API Request failed with status ${response.status}`
    try {
      const errorData = await response.json()
      errorMessage = errorData.error || errorData.message || errorMessage
    } catch {
      // Non-JSON fallback (e.g. server returned an HTML error stacktrace)
      try {
        const text = await response.text()
        if (text && text.length < 200) {
          errorMessage = text
        }
      } catch {}
    }
    throw new Error(errorMessage)
  }

  // 204 No Content
  if (response.status === 204) {
    return null as any
  }

  return response.json()
}

/**
 * Client interface for making HTTP requests (GET, POST, PUT, DELETE)
 */
export const apiClient = {
  get: <T = any>(endpoint: string, options?: RequestOptions): Promise<T> =>
    apiFetch<T>(endpoint, { method: 'GET', ...options }),

  post: <T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> =>
    apiFetch<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
      ...options
    }),

  put: <T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> =>
    apiFetch<T>(endpoint, {
      method: 'PUT',
      body: body !== undefined ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
      ...options
    }),

  delete: <T = any>(endpoint: string, options?: RequestOptions): Promise<T> =>
    apiFetch<T>(endpoint, { method: 'DELETE', ...options })
}
