import { useEffect, useMemo } from 'react';
import { useLocation, useRoutes } from 'react-router-dom';
import routes from './config';
import serviceWorkerManager, { backgroundPrefetch } from '../utils/cache/serviceWorker';
import { updateDocumentTitle, updateMetaTags } from './utils/documentTitle';
import { navigationAnalytics } from './analytics';
import { NavigationTransition } from './components/NavigationTransition';
import { log } from '../utils/logging';

export function AppRoutes() {
  const element = useRoutes(routes);
  const location = useLocation();

  // Register SW once on initial mount
  useEffect(() => {
    serviceWorkerManager.register();
  }, []);

  // Update document title and meta tags on route change
  useEffect(() => {
    const params = location.pathname.match(/\/[^/]+/g)?.reduce((acc, segment, index, arr) => {
      // Extract dynamic params (simplified - would need route matching for full support)
      return acc;
    }, {} as Record<string, string>) || {};

    updateDocumentTitle(location.pathname, params, location.state as Record<string, unknown>);
    updateMetaTags(location.pathname, params, location.state as Record<string, unknown>);
  }, [location.pathname, location.state]);

  // Track navigation analytics
  useEffect(() => {
    const previousPath = navigationAnalytics.getMetrics().slice(-1)[0]?.path;
    navigationAnalytics.startNavigation(location.pathname, 'push', previousPath);

    // Mark navigation as complete after initial render (don't wait for all data)
    // This gives better metrics - tracks when page is interactive, not when all data loads
    // Use requestAnimationFrame to complete after first paint
    const completeTimer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        navigationAnalytics.completeNavigation(location.pathname, true);
      });
    });

    return () => {
      cancelAnimationFrame(completeTimer);
    };
  }, [location.pathname]);

  // Smart scroll restoration
  useEffect(() => {
    const path = location.pathname;
    
    // Routes that should always scroll to top
    const scrollToTopRoutes = [
      '/',
      '/anime',
      '/player',
      '/watchlist',
      '/favorites',
      '/profile',
      '/settings',
      '/admin'
    ];
    
    // Check if current route should scroll to top
    const shouldScrollToTop = scrollToTopRoutes.some(route => path.startsWith(route));
    
    // For player routes specifically, scroll immediately
    if (path.startsWith('/player/')) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    
    // For other routes that should scroll to top, use smooth scroll
    if (shouldScrollToTop) {
      // Small delay to ensure content is rendered
      const timeoutId = setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
    
    // For other routes (like anime detail), preserve scroll or restore if needed
    // This is handled by browser's default scroll restoration for back/forward
  }, [location.pathname, location.key]);

  // Background prefetch for next-likely routes and some images
  const nextLikelyUrls = useMemo(() => {
    const path = location.pathname;
    const core = ['/', '/anime'];
    if (path !== '/watchlist') core.push('/watchlist');
    if (path !== '/favorites') core.push('/favorites');
    if (path !== '/profile') core.push('/profile');
    return core;
  }, [location.pathname]);

  useEffect(() => {
    // Collect a few on-screen images to warm cache (only same-origin)
    const currentOrigin = window.location.origin;
    const imgs = Array.from(document.querySelectorAll('img'))
      .slice(0, 8)
      .map((img) => img.currentSrc || img.src)
      .filter((src) => {
        try {
          const url = new URL(src, window.location.href);
          // Only prefetch same-origin images to avoid CORS issues
          return url.origin === currentOrigin;
        } catch {
          return false;
        }
      });
    backgroundPrefetch([...nextLikelyUrls, ...imgs]);
  }, [nextLikelyUrls]);

  // Error boundary for navigation errors
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error && event.error.message?.includes('navigation')) {
        navigationAnalytics.trackNavigationError(location.pathname, event.error);
      }
    };

    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, [location.pathname]);

  return (
    <NavigationTransition>
      {element}
    </NavigationTransition>
  );
}
