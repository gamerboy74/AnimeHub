import { supabase, isSupabaseConfigured } from '../../lib/database/supabase'
import { DatabaseHealth } from '../../utils/database/health'

export interface AuthUser {
  id: string
  email: string
  username?: string
  avatar_url?: string
  subscription_type: 'free' | 'premium' | 'vip'
}

export class AuthService {
  // Sign up with email and password
  static async signUp(email: string, password: string, username?: string) {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase not configured. Please check your environment variables.')
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username || email.split('@')[0]
        }
      }
    })

    if (error) {
      throw new Error(`Sign up failed: ${error.message}`)
    }

    return data
  }

  // Sign in with email and password
  static async signIn(email: string, password: string) {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase not configured. Please check your environment variables.')
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      throw new Error(`Sign in failed: ${error.message}`)
    }

    return data
  }

  // Sign in with Google
  static async signInWithGoogle() {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase not configured. Please check your environment variables.')
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    })

    if (error) {
      throw new Error(`Google sign in failed: ${error.message}`)
    }

    return data
  }

  // Sign in with GitHub
  static async signInWithGitHub() {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase not configured. Please check your environment variables.')
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    })

    if (error) {
      throw new Error(`GitHub sign in failed: ${error.message}`)
    }

    return data
  }

  // Sign out
  static async signOut() {
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured, sign out skipped')
      return true
    }

    const { error } = await supabase.auth.signOut()

    if (error) {
      throw new Error(`Sign out failed: ${error.message}`)
    }

    return true
  }

  // Reset password
  static async resetPassword(email: string) {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase not configured. Please check your environment variables.')
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`
    })

    if (error) {
      throw new Error(`Password reset failed: ${error.message}`)
    }

    return true
  }

  // Update password
  static async updatePassword(newPassword: string) {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase not configured. Please check your environment variables.')
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (error) {
      throw new Error(`Password update failed: ${error.message}`)
    }

    return true
  }

  // Check if user is authenticated
  static async isAuthenticated(): Promise<boolean> {
    if (!isSupabaseConfigured) {
      return false
    }

    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  }

  // Get current session
  static async getCurrentSession() {
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured, returning null session')
      return null
    }

    try {
      // Check database health first
      const isHealthy = await DatabaseHealth.checkHealth()
      if (!isHealthy) {
        console.warn('Database not healthy, skipping session check')
        return null
      }

      // Add timeout to prevent hanging
      const sessionPromise = supabase.auth.getSession()
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Session request timeout')), 10000) // Increased to 10 seconds
      )

      const { data: { session }, error } = await Promise.race([
        sessionPromise,
        timeoutPromise
      ]) as any

      if (error) {
        console.warn('Session error:', error.message)
        return null
      }

      return session
    } catch (err) {
      console.warn('Session request failed:', err)
      return null // Return null instead of throwing to prevent app crash
    }
  }

  // Listen to auth state changes
  static onAuthStateChange(callback: (event: string, session: any) => void) {
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured, returning dummy subscription')
      return {
        data: { subscription: { unsubscribe: () => {} } }
      }
    }

    return supabase.auth.onAuthStateChange(callback)
  }

  // Get current user
  static async getCurrentUser() {
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured, returning null user')
      return null
    }

    const { data: { user }, error } = await supabase.auth.getUser()

    if (error) {
      throw new Error(`Failed to get current user: ${error.message}`)
    }

    return user
  }
}
