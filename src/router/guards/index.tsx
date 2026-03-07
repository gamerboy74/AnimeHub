/**
 * Navigation Guards
 * Route-level permission checks and navigation protection
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/auth/selectors';
import { useAdmin } from '../../hooks/admin';
import { getRouteMetadata } from '../metadata';

export interface NavigationGuard {
  canActivate: (path: string, params?: Record<string, string>) => Promise<boolean> | boolean;
  redirectTo?: string;
  message?: string;
}

/**
 * Authentication guard - checks if user is authenticated
 */
export function useAuthGuard(path: string): { canAccess: boolean; redirect?: JSX.Element } {
  const user = useCurrentUser();
  const metadata = getRouteMetadata(path);
  const location = useLocation();

  if (metadata?.requiresAuth && !user) {
    // Store intended destination for redirect after login
    const returnUrl = encodeURIComponent(`${location.pathname}${location.search}`);
    return {
      canAccess: false,
      redirect: <Navigate to={`/?redirect=${returnUrl}`} replace />,
    };
  }

  return { canAccess: true };
}

/**
 * Admin guard - checks if user is admin
 */
export function useAdminGuard(path: string): { canAccess: boolean; redirect?: JSX.Element } {
  const user = useCurrentUser();
  const { isAdmin, loading } = useAdmin();
  const metadata = getRouteMetadata(path);
  const location = useLocation();

  if (loading) {
    // Still checking admin status
    return { canAccess: true };
  }

  if (metadata?.requiresAdmin && (!user || !isAdmin)) {
    return {
      canAccess: false,
      redirect: <Navigate to="/" replace state={{ from: location, message: 'Admin access required' }} />,
    };
  }

  return { canAccess: true };
}

/**
 * Combined guard hook
 */
export function useRouteGuard(path: string, params?: Record<string, string>) {
  const authGuard = useAuthGuard(path);
  const adminGuard = useAdminGuard(path);

  if (!authGuard.canAccess && authGuard.redirect) {
    return { canAccess: false, redirect: authGuard.redirect };
  }

  if (!adminGuard.canAccess && adminGuard.redirect) {
    return { canAccess: false, redirect: adminGuard.redirect };
  }

  return { canAccess: true };
}
