import { StrictMode } from 'react';
import './i18n';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { serviceWorkerManager } from './utils/cache/serviceWorker';
import ErrorBoundary from './components/common/ErrorBoundary';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './utils/query';
// Error tracking is auto-initialized on module load
import './utils/monitoring/errorTracking';

// Global Fetch Interceptor to dynamically inject Supabase session JWT
const originalFetch = window.fetch;
window.fetch = async function (input, init) {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else if (input instanceof Request) {
    url = input.url;
  }

  const isProtectedApi =
    url.includes('/api/admin') ||
    url.includes('/api/scheduler') ||
    url.includes('/api/scrape') ||
    url.includes('/api/add-scraped-episode') ||
    url.includes('/api/start-large-scrape') ||
    url.includes('/api/scraping-progress');

  const isPublicProxy = url.includes('/api/image-proxy') || url.includes('/api/stream-proxy');

  if (isProtectedApi && !isPublicProxy) {
    try {
      const { supabase } = await import('./lib/database/supabase');
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.access_token) {
        if (input instanceof Request) {
          const newHeaders = new Headers(input.headers);
          if (!newHeaders.has('Authorization')) {
            newHeaders.set('Authorization', `Bearer ${session.access_token}`);
          }
          const newRequest = new Request(input, {
            headers: newHeaders
          });
          return originalFetch.call(window, newRequest, init);
        } else {
          init = init || {};
          const headers = new Headers(init.headers);
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${session.access_token}`);
          }
          init.headers = headers;
        }
      }
    } catch (err) {
      console.error('Failed to inject Auth token in fetch:', err);
    }
  }

  return originalFetch.call(window, input, init);
};

// Filter out browser extension errors (non-critical, safe to ignore)
function shouldIgnoreError(error: ErrorEvent | PromiseRejectionEvent): boolean {
  const message = error instanceof ErrorEvent 
    ? error.message 
    : String((error as PromiseRejectionEvent).reason);

  // Ignore browser extension errors
  const ignorePatterns = [
    /origins don't match.*megaplay\.buzz/i,
    /contentScript\.js/i,
    /injected\.js/i,
    /browser.*extension/i,
    // Ignore CORS errors from external domains (handled by Service Worker)
    /Access to fetch.*has been blocked by CORS/i,
  ];

  return ignorePatterns.some(pattern => pattern.test(message));
}

// Set up global error handlers to filter extension errors
if (typeof window !== 'undefined') {
  // Handle synchronous errors
  window.addEventListener('error', (event: ErrorEvent) => {
    if (shouldIgnoreError(event)) {
      event.preventDefault(); // Prevent error from showing in console
      event.stopPropagation();
      return false;
    }
    // Let other error handlers process legitimate errors
    return true;
  }, true); // Use capture phase to catch early

  // Handle promise rejections
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (shouldIgnoreError(event)) {
      event.preventDefault(); // Prevent error from showing in console
      return false;
    }
    return true;
  });
}

// QueryClient instance is provided by utils/queryClient

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Register service worker in production
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  serviceWorkerManager.register().then((registration) => {
    if (registration) {
      console.log('Service Worker registered successfully');
    }
  }).catch((error) => {
    console.error('Service Worker registration failed:', error);
  });
}