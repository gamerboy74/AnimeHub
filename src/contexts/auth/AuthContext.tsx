import React, { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { sessionManager } from '../../utils/session/manager'
import type { SessionState } from '../../utils/session/manager'
import type { Tables } from '../../lib/database/supabase'

type User = Tables<'users'>

interface AuthContextType {
  user: User | null
  loading: boolean
  error: string | null
  signUp: (email: string, password: string, username?: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInWithGitHub: () => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
  refreshSession: () => Promise<void>
  isSessionValid: () => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = React.useState<SessionState>({
    user: null,
    loading: true,
    error: null,
    lastChecked: 0,
    isInitialized: false
  })

  useEffect(() => {
    const unsubscribe = sessionManager.subscribe((newState) => {
      // Only log when loading completes to reduce noise
      if (newState.loading === false && newState.isInitialized) {
        console.log('AuthContext: Session ready - user:', newState.user ? 'exists' : 'null')
      }
      setState(newState)
    })
    return unsubscribe
  }, [])

  const signUp = async (email: string, password: string, username?: string) => {
    await sessionManager.signUp(email, password, username)
  }

  const signIn = async (email: string, password: string) => {
    await sessionManager.signIn(email, password)
  }

  const signInWithGoogle = async () => {
    await sessionManager.signInWithGoogle()
  }

  const signInWithGitHub = async () => {
    await sessionManager.signInWithGitHub()
  }

  const signOut = async () => {
    await sessionManager.signOut()
  }

  const resetPassword = async (email: string) => {
    await sessionManager.resetPassword(email)
  }

  const updatePassword = async (newPassword: string) => {
    await sessionManager.updatePassword(newPassword)
  }

  const refreshSession = async () => {
    await sessionManager.forceRefresh()
  }

  const isSessionValid = () => {
    return sessionManager.isSessionValid()
  }

  const contextValue: AuthContextType = useMemo(() => ({
    user: state.user,
    loading: state.loading,
    error: state.error,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithGitHub,
    signOut,
    resetPassword,
    updatePassword,
    refreshSession,
    isSessionValid
  }), [
    state.user,
    state.loading,
    state.error,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithGitHub,
    signOut,
    resetPassword,
    updatePassword,
    refreshSession,
    isSessionValid
  ])

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider')
  }
  return context
}
