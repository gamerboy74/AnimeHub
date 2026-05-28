import { useState, useEffect, createContext, useContext, Suspense } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useCurrentUser } from '../../hooks/auth/selectors'
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
  <div className="h-[60vh] flex items-center justify-center w-full">
    <div className="text-center">
      <SparkleLoadingSpinner size="lg" text="Loading admin content..." />
    </div>
  </div>
)

export default function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const { isAdmin, loading: adminLoading } = useAdmin()
  
  // State management
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isLoading, setIsLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Update active tab based on current route
  useEffect(() => {
    const path = location.pathname
    if (path.includes('/admin/anime')) {
      setActiveTab('anime')
    } else if (path.includes('/admin/users')) {
      setActiveTab('users')
    } else if (path.includes('/admin/requests')) {
      setActiveTab('requests')
    } else if (path.includes('/admin/settings')) {
      setActiveTab('settings')
    } else {
      setActiveTab('dashboard')
    }
  }, [location.pathname])

  // Simple loading check in case AuthContext is still initializing
  if (adminLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <SparkleLoadingSpinner size="xl" text="Verifying admin access..." />
      </div>
    )
  }

  // Redirect if not authenticated or not admin (safety fallback, although ProtectedRoute handles this)
  if (!user || !isAdmin) {
    navigate('/', { replace: true })
    return null
  }

  // Refresh data function (no-op mock for compatibility)
  const refreshData = () => {
    setIsLoading(true)
    setTimeout(() => setIsLoading(false), 300)
  }

  const contextValue: AdminContextType = {
    activeTab,
    setActiveTab,
    isLoading,
    setIsLoading,
    refreshData,
    sessionValid: true,
    refreshSession: () => {}
  }

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
