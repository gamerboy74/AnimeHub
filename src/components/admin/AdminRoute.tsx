import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAdmin } from '../../hooks/admin'
import { SparkleLoadingSpinner } from '../base/LoadingSpinner'

interface AdminRouteProps {
  children: React.ReactNode
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const { isAdmin, loading, error } = useAdmin()
  const location = useLocation()
  const [showAccessDenied, setShowAccessDenied] = useState(false)

  useEffect(() => {
    if (!loading && !isAdmin && !error) {
      // Show access denied message briefly before redirecting
      setShowAccessDenied(true)
      const timer = setTimeout(() => {
        setShowAccessDenied(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [isAdmin, loading, error])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center">
        <div className="text-center">
          <SparkleLoadingSpinner size="xl" text="Verifying admin access..." />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center">
        <div className="text-center">
          <i className="ri-error-warning-line text-6xl text-red-500 mb-4"></i>
          <h2 className="text-2xl font-bold text-white mb-2">Authentication Error</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    if (showAccessDenied) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="text-center"
          >
            <i className="ri-shield-cross-line text-6xl text-red-500 mb-4"></i>
            <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
            <p className="text-gray-400 mb-6">
              You don't have admin privileges to access this page.
            </p>
            <p className="text-sm text-gray-500">
              Redirecting to home page...
            </p>
          </motion.div>
        </div>
      )
    }

    // Redirect to home page
    return <Navigate to="/" state={{ from: location }} replace />
  }

  // User is admin, render the protected content
  return <>{children}</>
}