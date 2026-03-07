/**
 * Route Wrapper Component
 * Wraps routes with error boundaries, loading states, and metadata management
 */

import { Suspense, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import ErrorBoundary from '../../components/common/ErrorBoundary';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import { updateDocumentTitle, updateMetaTags } from '../utils/documentTitle';
import { navigationAnalytics } from '../analytics';
import { useRouteGuard } from '../guards';

interface RouteWrapperProps {
  children: React.ReactNode;
  path: string;
}

export function RouteWrapper({ children, path }: RouteWrapperProps) {
  const location = useLocation();
  const params = useParams<Record<string, string>>();
  
  // Check route guards
  const guard = useRouteGuard(location.pathname, params);

  // Update document title and meta tags
  useEffect(() => {
    // Get route data from location state if available
    const routeData = location.state as Record<string, unknown> | undefined;
    
    updateDocumentTitle(location.pathname, params, routeData);
    updateMetaTags(location.pathname, params, routeData);
    
    // Track navigation
    navigationAnalytics.startNavigation(
      location.pathname,
      location.key ? 'push' : 'initial',
      navigationAnalytics.getMetrics().slice(-1)[0]?.path
    );
    
    return () => {
      navigationAnalytics.completeNavigation(location.pathname, true);
    };
  }, [location.pathname, location.key, location.state, params]);

  // Track route visit
  useEffect(() => {
    navigationAnalytics.trackRouteVisit(location.pathname);
  }, [location.pathname]);

  // Handle guard redirect
  if (!guard.canAccess && guard.redirect) {
    return guard.redirect;
  }

  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50 flex items-center justify-center">
          <div className="text-center">
            <i className="ri-error-warning-line text-6xl text-red-500 mb-4"></i>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Page Error</h2>
            <p className="text-gray-600 mb-4">This page encountered an error. Please try refreshing.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50 flex items-center justify-center">
            <div className="text-center">
              <SparkleLoadingSpinner size="xl" text="Loading page..." />
            </div>
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

