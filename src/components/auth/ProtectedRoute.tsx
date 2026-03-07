import { Navigate, useLocation } from 'react-router-dom'
import { useCurrentUser, useAuthLoading as useAuthLoadingSelector } from '../../hooks/auth/selectors'
import { useAdmin } from '../../hooks/admin'
import { SparkleLoadingSpinner } from '../base/LoadingSpinner'
import { log } from '../../utils/logging'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireAdmin?: boolean
  returnUrl?: string
}

export default function ProtectedRoute({ 
  children, 
  requireAdmin = false,
  returnUrl 
}: ProtectedRouteProps) {
  const user = useCurrentUser()
  const loading = useAuthLoadingSelector()
  const { isAdmin, loading: adminLoading } = useAdmin()
  const location = useLocation()

  // Determine redirect URL - use returnUrl prop, location state, or current path
  const redirectTo = returnUrl || (location.state as { returnUrl?: string })?.returnUrl || location.pathname + location.search

  if (loading || (requireAdmin && adminLoading)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <SparkleLoadingSpinner size="xl" text={loading ? "Checking authentication..." : "Checking admin status..."} />
        </div>
      </div>
    )
  }

  if (!user) {
    log.warn('Protected route accessed without authentication', { path: location.pathname })
    // Store return URL for redirect after login
    const loginUrl = redirectTo ? `/?redirect=${encodeURIComponent(redirectTo)}` : '/'
    return <Navigate to={loginUrl} replace state={{ from: location, message: 'Please log in to access this page' }} />
  }

  if (requireAdmin && !isAdmin) {
    log.warn('Admin route accessed without admin privileges', { path: location.pathname, userId: user.id })
    return <Navigate to="/" replace state={{ from: location, message: 'Admin access required' }} />
  }

  log.debug('Protected route access granted', { path: location.pathname, requireAdmin })
  return <>{children}</>
}
