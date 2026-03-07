import { useState, useEffect } from 'react'
import { AuthService } from '../../services/auth'
import { UserService } from '../../services/user'
import { supabase, isSupabaseConfigured } from '../../lib/database/supabase'
import type { Tables } from '../../lib/database/supabase'

type User = Tables<'users'>

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Check if Supabase is configured
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured, running in demo mode')
      setLoading(false)
      setError(null)
      setUser(null)
      return
    }

    let isMounted = true

    // Get initial session with timeout
    const getInitialSession = async () => {
      try {
        const session = await AuthService.getCurrentSession()
        
        if (!isMounted) return
        
        if (session?.user) {
          const userProfile = await UserService.getCurrentUser()
          if (isMounted) {
            setUser(userProfile)
          }
        }
      } catch (err) {
        console.warn('Error getting initial session:', err)
        if (isMounted) {
          setUser(null)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    // Set timeout for initialization
    const initTimeout = setTimeout(() => {
      if (isMounted) {
        setLoading(false)
      }
    }, 3000)

    getInitialSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!isMounted) return
        
        try {
          if (session?.user) {
            const userProfile = await UserService.getCurrentUser()
            if (isMounted) {
              setUser(userProfile)
            }
          } else {
            if (isMounted) {
              setUser(null)
            }
          }
        } catch (err) {
          console.warn('Error handling auth state change:', err)
          if (isMounted) {
            setError(err instanceof Error ? err.message : 'Authentication error')
          }
        } finally {
          if (isMounted) {
            setLoading(false)
          }
        }
      }
    )

    return () => {
      isMounted = false
      clearTimeout(initTimeout)
      subscription.unsubscribe()
    }
  }, [])

  const signUp = async (email: string, password: string, username?: string) => {
    try {
      setError(null)
      setLoading(true)
      await AuthService.signUp(email, password, username)
      // User will be set automatically via auth state change
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed')
      throw err
    } finally {
      setLoading(false)
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      setError(null)
      setLoading(true)
      await AuthService.signIn(email, password)
      // User will be set automatically via auth state change
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
      throw err
    } finally {
      setLoading(false)
    }
  }

  const signInWithGoogle = async () => {
    try {
      setError(null)
      await AuthService.signInWithGoogle()
      // User will be set automatically via auth state change
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign in failed')
      throw err
    }
  }

  const signInWithGitHub = async () => {
    try {
      setError(null)
      await AuthService.signInWithGitHub()
      // User will be set automatically via auth state change
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub sign in failed')
      throw err
    }
  }

  const signOut = async () => {
    try {
      setError(null)
      await AuthService.signOut()
      setUser(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed')
      throw err
    }
  }

  const resetPassword = async (email: string) => {
    try {
      setError(null)
      await AuthService.resetPassword(email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed')
      throw err
    }
  }

  const updatePassword = async (newPassword: string) => {
    try {
      setError(null)
      await AuthService.updatePassword(newPassword)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password update failed')
      throw err
    }
  }

  return {
    user,
    loading,
    error,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithGitHub,
    signOut,
    resetPassword,
    updatePassword
  }
}
