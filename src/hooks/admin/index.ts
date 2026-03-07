import { useState, useEffect, useCallback, useRef } from 'react'
import { AdminService, type AdminStats, type UserManagement, type SystemHealth } from '../../services/admin'

// Global cache to prevent refetching on every mount
const adminCache = {
  stats: null as AdminStats | null,
  health: null as SystemHealth | null,
  activities: null as any[] | null,
  adminStatus: null as boolean | null,
  lastFetch: {
    stats: 0,
    health: 0,
    activities: 0,
    adminStatus: 0
  }
}

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
const ADMIN_CACHE_DURATION = 10 * 60 * 1000 // 10 minutes for admin status

export function useAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean>(adminCache.adminStatus || false)
  const [loading, setLoading] = useState(adminCache.adminStatus === null)
  const [error, setError] = useState<string | null>(null)

  const checkAdminStatus = useCallback(async (forceRefresh = false) => {
    const now = Date.now()
    const isExpired = now - adminCache.lastFetch.adminStatus > ADMIN_CACHE_DURATION
    
    // Use cache if available and not expired, unless force refresh
    if (adminCache.adminStatus !== null && !isExpired && !forceRefresh) {
      setIsAdmin(adminCache.adminStatus)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const adminStatus = await AdminService.isAdmin()
      
      // Update cache
      adminCache.adminStatus = adminStatus
      adminCache.lastFetch.adminStatus = now
      
      setIsAdmin(adminStatus)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check admin status')
      setIsAdmin(false)
      adminCache.adminStatus = false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAdminStatus()
  }, []) // Remove checkAdminStatus dependency to prevent re-running

  return {
    isAdmin,
    loading,
    error,
    refetch: () => checkAdminStatus(true)
  }
}

export function useAdminStats() {
  const [stats, setStats] = useState<AdminStats | null>(adminCache.stats)
  const [loading, setLoading] = useState(!adminCache.stats)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async (forceRefresh = false) => {
    const now = Date.now()
    const isExpired = now - adminCache.lastFetch.stats > CACHE_DURATION
    
    // Use cache if available and not expired, unless force refresh
    if (adminCache.stats && !isExpired && !forceRefresh) {
      setStats(adminCache.stats)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 10000)
      )
      
      const dataPromise = AdminService.getAdminStats()
      const data = await Promise.race([dataPromise, timeoutPromise]) as AdminStats
      
      // Update cache
      adminCache.stats = data
      adminCache.lastFetch.stats = now
      
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch admin stats')
      // Set fallback data to prevent infinite loading
      const fallbackData = {
        totalUsers: 0,
        totalAnime: 0,
        totalEpisodes: 0,
        totalReviews: 0,
        recentUsers: 0,
        activeUsers: 0,
        premiumUsers: 0,
        totalWatchTime: '0 hours'
      }
      setStats(fallbackData)
      adminCache.stats = fallbackData
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, []) // Remove fetchStats dependency to prevent re-running

  return {
    stats,
    loading,
    error,
    refetch: () => fetchStats(true)
  }
}

export function useUserManagement(page: number = 1, limit: number = 20) {
  const [users, setUsers] = useState<UserManagement[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await AdminService.getAllUsers(page, limit)
      setUsers(data.users)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }, [page, limit])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const updateUser = useCallback(async (userId: string, updates: Partial<UserManagement>) => {
    try {
      setError(null)
      await AdminService.updateUser(userId, updates)
      await fetchUsers() // Refresh the list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
      throw err
    }
  }, [fetchUsers])

  const deleteUser = useCallback(async (userId: string) => {
    try {
      setError(null)
      await AdminService.deleteUser(userId)
      await fetchUsers() // Refresh the list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user')
      throw err
    }
  }, [fetchUsers])

  return {
    users,
    total,
    loading,
    error,
    updateUser,
    deleteUser,
    refetch: fetchUsers
  }
}

export function useSystemHealth() {
  const [health, setHealth] = useState<SystemHealth | null>(adminCache.health)
  const [loading, setLoading] = useState(!adminCache.health)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async (forceRefresh = false) => {
    const now = Date.now()
    const isExpired = now - adminCache.lastFetch.health > CACHE_DURATION
    
    // Use cache if available and not expired, unless force refresh
    if (adminCache.health && !isExpired && !forceRefresh) {
      setHealth(adminCache.health)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 8000)
      )
      
      const dataPromise = AdminService.getSystemHealth()
      const data = await Promise.race([dataPromise, timeoutPromise]) as SystemHealth
      
      // Update cache
      adminCache.health = data
      adminCache.lastFetch.health = now
      
      setHealth(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch system health')
      // Set fallback data
      const fallbackData = {
        database_status: 'error',
        api_response_time: 0,
        storage_usage: 0,
        active_connections: 0,
        error_rate: 100
      }
      setHealth(fallbackData)
      adminCache.health = fallbackData
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchHealth(true), 30000)
    return () => clearInterval(interval)
  }, []) // Remove fetchHealth dependency to prevent re-running

  return {
    health,
    loading,
    error,
    refetch: () => fetchHealth(true)
  }
}

export function useRecentActivity(limit: number = 10) {
  const [activities, setActivities] = useState<any[]>(adminCache.activities || [])
  const [loading, setLoading] = useState(!adminCache.activities)
  const [error, setError] = useState<string | null>(null)

  const fetchActivities = useCallback(async (forceRefresh = false) => {
    const now = Date.now()
    const isExpired = now - adminCache.lastFetch.activities > CACHE_DURATION
    
    // Use cache if available and not expired, unless force refresh
    if (adminCache.activities && !isExpired && !forceRefresh) {
      setActivities(adminCache.activities)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 8000)
      )
      
      const dataPromise = AdminService.getRecentActivity(limit)
      const data = await Promise.race([dataPromise, timeoutPromise]) as any[]
      
      // Update cache
      adminCache.activities = data
      adminCache.lastFetch.activities = now
      
      setActivities(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch recent activity')
      // Set fallback data
      setActivities([])
      adminCache.activities = []
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    fetchActivities()
    
    // Auto-refresh every 60 seconds
    const interval = setInterval(() => fetchActivities(true), 60000)
    return () => clearInterval(interval)
  }, []) // Remove fetchActivities dependency to prevent re-running

  return {
    activities,
    loading,
    error,
    refetch: () => fetchActivities(true)
  }
}

export function useAdminActions() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createAdminUser = useCallback(async (email: string, password: string, username: string) => {
    try {
      setLoading(true)
      setError(null)
      await AdminService.createAdminUser(email, password, username)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create admin user')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    createAdminUser,
    loading,
    error
  }
}
