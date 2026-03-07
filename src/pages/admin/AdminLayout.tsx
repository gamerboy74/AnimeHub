import { useState, useEffect, createContext, useContext, Suspense } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useCurrentUser, useSignOut } from '../../hooks/auth/selectors'
import { sessionManager } from '../../utils/session/manager'
import { useAdmin } from '../../hooks/admin'
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner'
import AdminNavbar from './components/AdminNavbar'

// Admin context for state management
interface AdminContextType {
  activeTab: string
  setActiveTab: (tab: string) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  refreshData: () => void
  sessionValid: boolean
  refreshSession: () => void
}

const AdminContext = createContext<AdminContextType | undefined>(undefined)

export const useAdminContext = () => {
  const context = useContext(AdminContext)
  if (!context) {
    // Return default values instead of throwing error
    return {
      activeTab: 'dashboard',
      setActiveTab: () => {},
      isLoading: false,
      setIsLoading: () => {},
      refreshData: () => {},
      sessionValid: true,
      refreshSession: () => {}
    }
  }
  return context
}

// Admin loading fallback component
const AdminLoadingFallback = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
    <div className="text-center">
      <SparkleLoadingSpinner size="xl" text="Loading admin panel..." />
    </div>
  </div>
)

export default function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const signOut = useSignOut()
  const { isAdmin, loading: adminLoading, error: adminError, refetch: refreshAdminStatus } = useAdmin()
  
  // State management
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isLoading, setIsLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [initialLoadComplete, setInitialLoadComplete] = useState(false)
  const [adminVerified, setAdminVerified] = useState(() => {
    // Check if admin was verified in this session
    return localStorage.getItem('adminVerified') === 'true'
  })

  // Update active tab based on current route
  useEffect(() => {
    const path = location.pathname
    if (path.includes('/admin/anime')) {
      setActiveTab('anime')
    } else if (path.includes('/admin/users')) {
      setActiveTab('users')
    } else if (path.includes('/admin/settings')) {
      setActiveTab('settings')
    } else {
      setActiveTab('dashboard')
    }
  }, [location.pathname])

  // Clear admin verification when user logs out
  useEffect(() => {
    if (!user) {
      localStorage.removeItem('adminVerified')
      setAdminVerified(false)
      setInitialLoadComplete(false)
    }
  }, [user])

  // Handle session validation with improved logic - only run once
  useEffect(() => {
    const checkSession = async () => {
      if (!user) {
        setInitialLoadComplete(true)
        return
      }

      // If admin is already verified in this session, skip the check
      if (adminVerified && localStorage.getItem('adminVerified') === 'true') {
        setInitialLoadComplete(true)
        return
      }

      // Check if session is valid
      if (!sessionManager.isSessionValid()) {
        console.log('Session expired, refreshing...')
        try {
          await sessionManager.forceRefresh()
        } catch (error) {
          console.error('Failed to refresh session:', error)
          await signOut()
          navigate('/', { replace: true })
          return
        }
      }

      // Check admin status
      if (adminError || (!adminLoading && !isAdmin)) {
        console.log('User is not admin, redirecting...')
        localStorage.removeItem('adminVerified')
        navigate('/', { replace: true })
        return
      }

      // Mark admin as verified and store in localStorage
      if (isAdmin && !adminLoading) {
        setAdminVerified(true)
        localStorage.setItem('adminVerified', 'true')
        setInitialLoadComplete(true)
      }
    }

    // Only run once on mount, not on every dependency change
    if (!initialLoadComplete) {
      checkSession()
    }
  }, [user, initialLoadComplete, adminVerified, isAdmin, adminLoading]) // Added necessary dependencies

  // Refresh data function
  const refreshData = () => {
    setIsLoading(true)
    // This will be called by child components to refresh their data
    setTimeout(() => setIsLoading(false), 500) // Simulate refresh
  }

  // Refresh session function
  const refreshSessionHandler = async () => {
    try {
      await refreshSession()
      await refreshAdminStatus()
    } catch (error) {
      console.error('Failed to refresh session:', error)
      await signOut()
      navigate('/', { replace: true })
    }
  }

  const contextValue: AdminContextType = {
    activeTab,
    setActiveTab,
    isLoading,
    setIsLoading,
    refreshData,
    sessionValid: !adminError && isAdmin,
    refreshSession: refreshSessionHandler
  }

  // Show loading while checking admin status or session - only on first load
  if (!initialLoadComplete || (!user && !adminVerified)) {
    console.log('AdminLayout: Showing loading spinner', { initialLoadComplete, user: !!user, adminVerified })
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <SparkleLoadingSpinner size="xl" text="Verifying admin access..." />
      </div>
    )
  }

  // Redirect if not admin (only after initial verification)
  if (user && !isAdmin && !adminLoading && !adminError) {
    console.log('AdminLayout: Redirecting non-admin user')
    navigate('/', { replace: true })
    return null
  }

  console.log('AdminLayout: Rendering admin panel', { adminVerified, isAdmin, adminLoading })

  return (
    <AdminContext.Provider value={contextValue}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <AdminNavbar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(c => !c)} />
        
        <main className={`transition-all duration-300 pt-16 lg:pt-0 ${sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[260px]'}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Suspense fallback={<AdminLoadingFallback />}>
                <Outlet />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </AdminContext.Provider>
  )
}
