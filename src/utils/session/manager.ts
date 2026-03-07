import { supabase, isSupabaseConfigured } from '../../lib/database/supabase'
import { UserService } from '../../services/user'
import type { Tables } from '../../lib/database/supabase'

type User = Tables<'users'>

interface SessionState {
  user: User | null
  loading: boolean
  error: string | null
  lastChecked: number
  isInitialized: boolean
}

class SessionManager {
  private static instance: SessionManager
  private state: SessionState = {
    user: null,
    loading: true,
    error: null,
    lastChecked: 0,
    isInitialized: false
  }
  
  private listeners: Set<(state: SessionState) => void> = new Set()
  private refreshTimeout: NodeJS.Timeout | null = null
  // private readonly REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes - disabled
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes

  private constructor() {
    this.initialize()
    
    // Add a timeout to prevent infinite loading
    setTimeout(() => {
      if (this.state.loading && this.state.isInitialized) {
        console.warn('SessionManager: Loading timeout reached, forcing loading to false')
        this.state.loading = false
        this.notifyListeners()
      }
    }, 10000) // 10 second timeout
  }

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager()
    }
    return SessionManager.instance
  }

  private async initialize() {
    try {
      console.log('SessionManager: Initializing...')
      
      // Check if Supabase is configured
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, running in demo mode')
        this.state.loading = false
        this.state.error = null
        this.state.user = null
        this.state.isInitialized = true
        this.state.lastChecked = Date.now()
        this.notifyListeners()
        return
      }

      console.log('Supabase is configured, checking for stored session...')

      // Check for existing session in localStorage
      const storedSession = this.getStoredSession()
      if (storedSession) {
        console.log('Found stored session:', storedSession.user ? 'user exists' : 'no user')
        this.state.user = storedSession.user
        this.state.lastChecked = storedSession.lastChecked
        this.state.isInitialized = true
        
        // Verify session is still valid
        if (Date.now() - storedSession.lastChecked < this.SESSION_TIMEOUT) {
          console.log('Stored session is still valid, setting loading to false')
          this.state.loading = false
          this.state.isInitialized = true
          this.notifyListeners()
          // this.startRefreshTimer() // Disabled to prevent loading issues
          return
        } else {
          console.log('Stored session expired, refreshing...')
        }
      }

      // Get fresh session from Supabase
      console.log('Getting fresh session from Supabase...')
      await this.refreshSession()
    } catch (error) {
      console.error('Session initialization failed:', error)
      this.state.error = error instanceof Error ? error.message : 'Session initialization failed'
      this.state.loading = false
      this.state.isInitialized = true
      this.state.lastChecked = Date.now()
      this.notifyListeners()
    }
  }

  private async refreshSession() {
    try {
      console.log('SessionManager: Refreshing session...')
      this.state.loading = true
      this.state.error = null
      this.notifyListeners()

      // Check if Supabase is configured
      if (!isSupabaseConfigured) {
        console.log('Supabase not configured, setting user to null')
        this.state.user = null
        this.state.lastChecked = Date.now()
        this.state.loading = false
        this.state.isInitialized = true
        this.notifyListeners()
        return
      }

      const session = await supabase.auth.getSession()
      console.log('SessionManager: Got session from Supabase:', session.data.session ? 'session exists' : 'no session')
      
      if (session.data.session?.user) {
        console.log('SessionManager: Getting user profile...')
        const userProfile = await UserService.getCurrentUser()
        console.log('SessionManager: Got user profile:', userProfile ? 'profile exists' : 'no profile')
        this.state.user = userProfile
        this.state.lastChecked = Date.now()
        this.storeSession()
      } else {
        console.log('SessionManager: No session, clearing user')
        this.state.user = null
        this.state.lastChecked = Date.now()
        this.clearStoredSession()
      }
    } catch (error) {
      console.error('Session refresh failed:', error)
      this.state.error = error instanceof Error ? error.message : 'Session refresh failed'
      this.state.user = null
    } finally {
      console.log('SessionManager: Setting loading to false')
      this.state.loading = false
      this.state.isInitialized = true
      this.notifyListeners()
    }
  }

  private startRefreshTimer() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
    }
    
    // Disable automatic refresh for now to prevent loading issues
    console.log('SessionManager: Auto-refresh disabled to prevent loading issues')
    // this.refreshTimeout = setTimeout(() => {
    //   this.refreshSession()
    //   this.startRefreshTimer()
    // }, this.REFRESH_INTERVAL)
  }

  private storeSession() {
    try {
      const sessionData = {
        user: this.state.user,
        lastChecked: this.state.lastChecked
      }
      localStorage.setItem('animehub_session', JSON.stringify(sessionData))
    } catch (error) {
      console.warn('Failed to store session:', error)
    }
  }

  private getStoredSession(): { user: User | null; lastChecked: number } | null {
    try {
      const stored = localStorage.getItem('animehub_session')
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.warn('Failed to parse stored session:', error)
    }
    return null
  }

  private clearStoredSession() {
    try {
      localStorage.removeItem('animehub_session')
    } catch (error) {
      console.warn('Failed to clear stored session:', error)
    }
  }

  private notifyListeners() {
    // Only log when loading state changes to reduce noise
    if (this.state.loading === false) {
      console.log('SessionManager: Loading complete, notifying listeners')
    }
    this.listeners.forEach(listener => listener({ ...this.state }))
  }

  // Public methods
  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener)
    
    // Immediately notify with current state
    listener({ ...this.state })
    
    return () => {
      this.listeners.delete(listener)
    }
  }

  async signIn(email: string, password: string) {
    try {
      this.state.loading = true
      this.state.error = null
      this.notifyListeners()

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) throw error

      await this.refreshSession()
      // this.startRefreshTimer() // Disabled to prevent loading issues
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Sign in failed'
      throw error
    } finally {
      this.state.loading = false
      this.notifyListeners()
    }
  }

  async signUp(email: string, password: string, username?: string) {
    try {
      this.state.loading = true
      this.state.error = null
      this.notifyListeners()

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username || email.split('@')[0]
          }
        }
      })

      if (error) throw error

      await this.refreshSession()
      // this.startRefreshTimer() // Disabled to prevent loading issues
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Sign up failed'
      throw error
    } finally {
      this.state.loading = false
      this.notifyListeners()
    }
  }

  async signInWithGoogle() {
    try {
      this.state.loading = true
      this.state.error = null
      this.notifyListeners()

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) throw error
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Google sign in failed'
      throw error
    } finally {
      this.state.loading = false
      this.notifyListeners()
    }
  }

  async signInWithGitHub() {
    try {
      this.state.loading = true
      this.state.error = null
      this.notifyListeners()

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) throw error
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'GitHub sign in failed'
      throw error
    } finally {
      this.state.loading = false
      this.notifyListeners()
    }
  }

  async signOut() {
    try {
      this.state.loading = true
      this.state.error = null
      this.notifyListeners()

      const { error } = await supabase.auth.signOut()
      if (error) throw error

      this.state.user = null
      this.state.lastChecked = Date.now()
      this.clearStoredSession()
      
      if (this.refreshTimeout) {
        clearTimeout(this.refreshTimeout)
        this.refreshTimeout = null
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Sign out failed'
      throw error
    } finally {
      this.state.loading = false
      this.notifyListeners()
    }
  }

  async resetPassword(email: string) {
    try {
      this.state.error = null
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`
      })

      if (error) throw error
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Password reset failed'
      throw error
    }
  }

  async updatePassword(newPassword: string) {
    try {
      this.state.error = null
      
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Password update failed'
      throw error
    }
  }

  getCurrentState(): SessionState {
    return { ...this.state }
  }

  isSessionValid(): boolean {
    if (!this.state.user) return false
    return Date.now() - this.state.lastChecked < this.SESSION_TIMEOUT
  }

  // Force refresh session (useful for admin panel)
  async forceRefresh() {
    await this.refreshSession()
    this.startRefreshTimer()
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance()

// Export types
export type { SessionState }
