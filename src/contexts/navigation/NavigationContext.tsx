import { createContext, useContext, type ReactNode, useState, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

interface NavigationState {
  isLoading: boolean
  currentPath: string
  previousPath: string | null
  navigationHistory: string[]
  isNavigating: boolean
}

interface NavigationContextType {
  navigationState: NavigationState
  setLoading: (loading: boolean) => void
  navigateTo: (path: string, options?: { replace?: boolean; state?: any }) => void
  goBack: () => void
  canGoBack: () => boolean
  clearHistory: () => void
  resetNavigationState: () => void
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  
  const [navigationState, setNavigationState] = useState<NavigationState>({
    isLoading: false,
    currentPath: location.pathname,
    previousPath: null,
    navigationHistory: [location.pathname],
    isNavigating: false
  })

  // Track location changes
  useEffect(() => {
    setNavigationState(prev => {
      const newPath = location.pathname
      const isNewPath = newPath !== prev.currentPath
      
      if (isNewPath) {
        return {
          ...prev,
          currentPath: newPath,
          previousPath: prev.currentPath,
          navigationHistory: [...prev.navigationHistory, newPath].slice(-10), // Keep last 10
          isNavigating: false,
          isLoading: false
        }
      }
      
      return {
        ...prev,
        isNavigating: false,
        isLoading: false
      }
    })
  }, [location.pathname])

  const setLoading = (loading: boolean) => {
    setNavigationState(prev => ({
      ...prev,
      isLoading: loading,
      isNavigating: loading
    }))
  }

  const navigateTo = (path: string, options: { replace?: boolean; state?: any } = {}) => {
    // Allow navigation if we're going to a different path or if not currently navigating
    const isDifferentPath = path !== navigationState.currentPath
    const canNavigate = !navigationState.isNavigating || isDifferentPath
    
    if (!canNavigate) {
      console.warn('Navigation already in progress, ignoring request')
      return
    }

    // If navigating to the same path, just return without doing anything
    if (!isDifferentPath) {
      return
    }

    setNavigationState(prev => ({
      ...prev,
      isNavigating: true,
      isLoading: true
    }))

    // Add a small delay to prevent rapid navigation
    setTimeout(() => {
      navigate(path, options)
    }, 100)
  }

  const goBack = () => {
    if (navigationState.navigationHistory.length > 1) {
      const previousPath = navigationState.navigationHistory[navigationState.navigationHistory.length - 2]
      navigateTo(previousPath, { replace: true })
    } else {
      navigateTo('/', { replace: true })
    }
  }

  const canGoBack = () => {
    return navigationState.navigationHistory.length > 1
  }

  const clearHistory = () => {
    setNavigationState(prev => ({
      ...prev,
      navigationHistory: [prev.currentPath],
      previousPath: null
    }))
  }

  const resetNavigationState = () => {
    setNavigationState(prev => ({
      ...prev,
      isLoading: false,
      isNavigating: false
    }))
  }

  // Auto-clear loading state after timeout
  useEffect(() => {
    if (navigationState.isLoading) {
      const timeout = setTimeout(() => {
        setNavigationState(prev => ({
          ...prev,
          isLoading: false,
          isNavigating: false
        }))
      }, 5000) // 5 second timeout

      return () => clearTimeout(timeout)
    }
  }, [navigationState.isLoading])

  // Reset navigation state if it gets stuck
  useEffect(() => {
    if (navigationState.isNavigating) {
      const timeout = setTimeout(() => {
        console.warn('Navigation state reset due to timeout')
        setNavigationState(prev => ({
          ...prev,
          isLoading: false,
          isNavigating: false
        }))
      }, 3000) // 3 second timeout for navigation state

      return () => clearTimeout(timeout)
    }
  }, [navigationState.isNavigating])

  const contextValue: NavigationContextType = useMemo(() => ({
    navigationState,
    setLoading,
    navigateTo,
    goBack,
    canGoBack,
    clearHistory,
    resetNavigationState
  }), [
    navigationState,
    setLoading,
    navigateTo,
    goBack,
    canGoBack,
    clearHistory,
    resetNavigationState
  ])

  return (
    <NavigationContext.Provider value={contextValue}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider')
  }
  return context
}

// Hook for components that need to show loading state during navigation
export function useNavigationLoading() {
  const { navigationState, setLoading } = useNavigation()
  
  return {
    isLoading: navigationState.isLoading,
    isNavigating: navigationState.isNavigating,
    setLoading
  }
}