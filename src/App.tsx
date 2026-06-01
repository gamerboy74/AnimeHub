import { BrowserRouter } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AppRoutes } from './router/index'
import { AuthProvider } from './contexts/auth/AuthContext'
import { NavigationProvider } from './contexts/navigation/NavigationContext'
import { SparkleLoadingSpinner } from './components/base/LoadingSpinner'

// Lazy load PerformanceMonitor to improve initial FCP
const PerformanceMonitor = lazy(() => import('./components/common/PerformanceMonitor'))

// Loading fallback component for Suspense
const LoadingFallback = () => (
  <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50 flex items-center justify-center">
    <div className="text-center">
      <SparkleLoadingSpinner size="xl" text="Loading page..." />
    </div>
  </div>
)

function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL || '/'}>
        <NavigationProvider>
          <Suspense fallback={<LoadingFallback />}>
            <AppRoutes />
          </Suspense>
          {/* Performance Monitor - lazy loaded to improve FCP */}
          <Suspense fallback={null}>
            <PerformanceMonitor 
              enabled={true}
              showBadge={import.meta.env.DEV}
            />
          </Suspense>
        </NavigationProvider>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App