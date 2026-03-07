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