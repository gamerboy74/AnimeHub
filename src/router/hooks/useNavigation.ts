/**
 * Navigation Utilities Hook
 * Provides navigation helpers and state management
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { useCallback, useRef } from 'react';
import { navigationAnalytics } from '../analytics';
import { log } from '../../utils/logging';

interface NavigationOptions {
  replace?: boolean;
  state?: Record<string, unknown>;
  preserveQuery?: boolean;
}

/**
 * Enhanced navigation hook with analytics and utilities
 * Note: This is different from useNavigation in NavigationContext
 * Use this for advanced navigation features
 */
export function useNavigationUtils() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationStateRef = useRef<Record<string, unknown>>({});

  /**
   * Navigate to a path with options
   */
  const navigateTo = useCallback((
    path: string,
    options: NavigationOptions = {}
  ) => {
    const { replace = false, state, preserveQuery = false } = options;
    
    // Preserve query params if needed
    let targetPath = path;
    if (preserveQuery && location.search) {
      targetPath += location.search;
    }

    // Track navigation
    navigationAnalytics.startNavigation(targetPath, replace ? 'replace' : 'push', location.pathname);
    
    navigate(targetPath, { replace, state });
    
    log.debug('Navigation triggered', { path: targetPath, replace, state });
  }, [navigate, location]);

  /**
   * Navigate back
   */
  const goBack = useCallback(() => {
    navigationAnalytics.startNavigation(location.pathname, 'pop');
    navigate(-1);
    log.debug('Navigation: back');
  }, [navigate, location]);

  /**
   * Navigate forward
   */
  const goForward = useCallback(() => {
    navigate(1);
    log.debug('Navigation: forward');
  }, [navigate]);

  /**
   * Replace current route
   */
  const replace = useCallback((
    path: string,
    state?: Record<string, unknown>
  ) => {
    navigateTo(path, { replace: true, state });
  }, [navigateTo]);

  /**
   * Get current route metadata
   */
  const getCurrentRouteMetadata = useCallback(() => {
    return location.pathname;
  }, [location]);

  /**
   * Set navigation state
   */
  const setNavigationState = useCallback((key: string, value: unknown) => {
    navigationStateRef.current[key] = value;
  }, []);

  /**
   * Get navigation state
   */
  const getNavigationState = useCallback((key: string) => {
    return navigationStateRef.current[key];
  }, []);

  return {
    navigate: navigateTo,
    goBack,
    goForward,
    replace,
    location,
    getCurrentRouteMetadata,
    setNavigationState,
    getNavigationState,
  };
}

