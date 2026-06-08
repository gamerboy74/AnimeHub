import { supabase, isSupabaseConfigured } from '../../lib/database/supabase'
import { UserService } from '../../services/user'
import type { Tables } from '../../lib/database/supabase'
import type { Subscription } from '@supabase/supabase-js'

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
  private authChangeListeners: Set<(user: User | null) => void> = new Set()
  private refreshTimeout: NodeJS.Timeout | null = null
  private authSubscription: Subscription | null = null

  private constructor() {
    this.initialize()

    // Safety net: if initialize() hangs for any reason, unblock the UI after 10s
    setTimeout(() => {
      if (this.state.loading) {
        console.warn('SessionManager: Loading timeout reached, forcing loading to false')
        this.state.loading = false
        this.state.isInitialized = true
        this.notifyListeners()
      }
    }, 10000)
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

      // Trust Supabase's own session store. Supabase persists and auto-refreshes tokens itself.
      // We just ask for the current active session on startup.
      await this.refreshSession()

    } catch (error) {
      console.error('Session initialization failed:', error)
      // On init error, don't clear the user profile; they might still have a valid token
      // in Supabase's internal state. Let onAuthStateChange handle reconciliation.
      this.state.error = error instanceof Error ? error.message : 'Session initialization failed'
      this.state.loading = false
      this.state.isInitialized = true
      this.notifyListeners()
    }

    // listen for auth state changes on Supabase (login, logout, token refresh, OAuth callback)
    if (isSupabaseConfigured) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log('SessionManager: Auth state changed:', event)

        if (session?.user) {
          const currentId = this.state.user?.id
          const newId = session.user.id

          // Fetch profile if it's a new login, or profile isn't loaded, or details updated.
          // For INITIAL_SESSION or TOKEN_REFRESHED, if the user is already loaded, skip redundant fetching.
          if (!this.state.user || currentId !== newId || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
            try {
              const userProfile = await UserService.getCurrentUser()
              this.state.user = userProfile
              this.state.lastChecked = Date.now()
              this.state.loading = false
              this.state.error = null
              this.state.isInitialized = true
              this.notifyListeners()
              this.notifyAuthChangeListeners(userProfile)
            } catch (error) {
              console.error('SessionManager: Failed to fetch user profile on auth change:', error)
            }
          } else {
            // Already loaded the same user. Just refresh timestamp and ensure loading is complete.
            this.state.lastChecked = Date.now()
            this.state.loading = false
            this.state.isInitialized = true
            this.notifyListeners()
          }
        } else {
          // Logged out
          this.state.user = null
          this.state.lastChecked = Date.now()
          this.state.loading = false
          this.state.error = null
          this.clearUserData()
          this.notifyListeners()
          this.notifyAuthChangeListeners(null)
        }
      })
      this.authSubscription = data.subscription
    }
  }

  private async refreshSession() {
    try {
      console.log('SessionManager: Refreshing session...')
      this.state.loading = true
      this.state.error = null
      this.notifyListeners()

      if (!isSupabaseConfigured) {
        this.state.user = null
        this.state.lastChecked = Date.now()
        this.state.loading = false
        this.state.isInitialized = true
        this.notifyListeners()
        return
      }

      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        // Network/timeout error — don't log the user out. Their token is likely still valid.
        console.warn('SessionManager: getSession() error (keeping user logged in):', error.message)
        this.state.error = error.message
        return
      }

      if (session?.user) {
        console.log('SessionManager: Active session found, loading profile...')
        const userProfile = await UserService.getCurrentUser()
        this.state.user = userProfile
        this.state.lastChecked = Date.now()
      } else {
        // Supabase explicitly says: no session. This is a true logged-out state.
        console.log('SessionManager: No active session.')
        this.state.user = null
        this.state.lastChecked = Date.now()
      }
    } catch (error) {
      // Unexpected error (e.g. network down). Keep user state as-is — don't log out.
      console.error('Session refresh failed (keeping user logged in):', error)
      this.state.error = error instanceof Error ? error.message : 'Session refresh failed'
    } finally {
      this.state.loading = false
      this.state.isInitialized = true
      this.notifyListeners()
    }
  }

  private clearUserData() {
    try {
      localStorage.removeItem('watchlist')
      localStorage.removeItem('favorites')
      localStorage.removeItem('watchProgress')
    } catch (error) {
      console.warn('Failed to clear user data:', error)
    }
  }

  private notifyAuthChangeListeners(user: User | null) {
    this.authChangeListeners.forEach(listener => listener(user))
  }

  private notifyListeners() {
    if (this.state.loading === false) {
      console.log('SessionManager: Loading complete, notifying listeners')
    }
    this.listeners.forEach(listener => listener({ ...this.state }))
  }

  // Public methods (always bind context when passing as reference)
  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener)
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

      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      await this.refreshSession()
      this.notifyAuthChangeListeners(this.state.user)
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Sign in failed'
      this.state.loading = false
      this.notifyListeners()
      throw error
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
        options: { data: { username: username || email.split('@')[0] } }
      })
      if (error) throw error

      await this.refreshSession()
      this.notifyAuthChangeListeners(this.state.user)
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Sign up failed'
      this.state.loading = false
      this.notifyListeners()
      throw error
    }
  }

  async signInWithGoogle() {
    try {
      this.state.error = null
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` }
      })
      if (error) throw error
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Google sign in failed'
      this.notifyListeners()
      throw error
    }
  }

  async signInWithGitHub() {
    try {
      this.state.error = null
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: `${window.location.origin}/auth/callback` }
      })
      if (error) throw error
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'GitHub sign in failed'
      this.notifyListeners()
      throw error
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
      this.clearUserData()

      if (this.refreshTimeout) {
        clearTimeout(this.refreshTimeout)
        this.refreshTimeout = null
      }

      this.state.loading = false
      this.notifyListeners()
      this.notifyAuthChangeListeners(null)
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Sign out failed'
      this.state.loading = false
      this.notifyListeners()
      throw error
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
      const { error } = await supabase.auth.updateUser({ password: newPassword })
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
    // Session is valid as long as Supabase has an active session.
    // We no longer enforce a custom time window — Supabase manages expiry & refresh.
    return !!this.state.user
  }

  async forceRefresh() {
    await this.refreshSession()
  }

  /**
   * Clean up all listeners and timers.
   * Call this when the app is unmounting or the session manager is no longer needed.
   */
  destroy() {
    if (this.authSubscription) {
      this.authSubscription.unsubscribe()
      this.authSubscription = null
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout)
      this.refreshTimeout = null
    }
    this.listeners.clear()
    this.authChangeListeners.clear()
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance()

// Subscribe to auth user changes (login/logout/user switch)
// Returns unsubscribe function
export function onAuthUserChanged(listener: (user: User | null) => void): () => void {
  sessionManager['authChangeListeners'].add(listener)
  return () => { sessionManager['authChangeListeners'].delete(listener) }
}

// Export types
export type { SessionState }
