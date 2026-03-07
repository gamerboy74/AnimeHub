// Database Health Check Utility
import { supabase } from '../../lib/database/supabase'

export class DatabaseHealth {
  private static isHealthy = true
  private static lastCheck = 0
  private static checkInterval = 30000 // 30 seconds

  static async checkHealth(): Promise<boolean> {
    const now = Date.now()
    
    // Skip check if we checked recently and it was healthy
    if (this.isHealthy && (now - this.lastCheck) < this.checkInterval) {
      return this.isHealthy
    }

    try {
      // Simple query to test database connection
      const { error } = await supabase
        .from('users')
        .select('id')
        .limit(1)

      this.isHealthy = !error
      this.lastCheck = now
      
      if (error) {
        console.warn('Database health check failed:', error.message)
      }

      return this.isHealthy
    } catch (err) {
      console.warn('Database health check error:', err)
      this.isHealthy = false
      this.lastCheck = now
      return false
    }
  }

  static isDatabaseHealthy(): boolean {
    return this.isHealthy
  }

  static async waitForHealthy(timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeoutMs) {
      if (await this.checkHealth()) {
        return true
      }
      
      // Wait 500ms before next check
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    return false
  }
}
