import { supabase } from '../../lib/database/supabase'

export class EpisodeStatusService {
  /**
   * Check if an anime has episodes available for watching
   */
  static async hasEpisodes(animeId: string): Promise<boolean> {
    try {
      // Check if anime has total_episodes > 0 or actual episodes in database
      const { data: anime, error: animeError } = await supabase
        .from('anime')
        .select('total_episodes')
        .eq('id', animeId)
        .single()

      if (animeError) {
        console.error('Error fetching anime:', animeError)
        return false
      }

      // Check if anime has episodes in episodes table
      const { data: episodes, error: episodesError } = await supabase
        .from('episodes')
        .select('id')
        .eq('anime_id', animeId)
        .limit(1)

      if (episodesError) {
        console.error('Error fetching episodes:', episodesError)
        return false
      }

      // Return true if anime has total_episodes > 0 OR has episodes in database
      return (anime?.total_episodes && anime.total_episodes > 0) || (episodes && episodes.length > 0)
    } catch (error) {
      console.error('Error checking episodes:', error)
      return false
    }
  }

  /**
   * Update anime status based on episode availability
   */
  static async updateAnimeStatus(animeId: string): Promise<boolean> {
    try {
      const hasEpisodes = await this.hasEpisodes(animeId)
      
      if (hasEpisodes) {
        // Update anime status to 'ongoing' if it was 'upcoming'
        const { error } = await supabase
          .from('anime')
          .update({ 
            status: 'ongoing',
            updated_at: new Date().toISOString()
          })
          .eq('id', animeId)
          .eq('status', 'upcoming') // Only update if currently upcoming

        if (error) {
          console.error('Error updating anime status:', error)
          return false
        }

        console.log(`✅ Updated anime ${animeId} from upcoming to ongoing`)
        return true
      }

      return false
    } catch (error) {
      console.error('Error updating anime status:', error)
      return false
    }
  }

  /**
   * Batch update multiple anime statuses
   */
  static async batchUpdateAnimeStatuses(animeIds: string[]): Promise<{ updated: number; errors: number }> {
    let updated = 0
    let errors = 0

    for (const animeId of animeIds) {
      try {
        const success = await this.updateAnimeStatus(animeId)
        if (success) {
          updated++
        }
      } catch (error) {
        console.error(`Error updating anime ${animeId}:`, error)
        errors++
      }
    }

    return { updated, errors }
  }

  /**
   * Get all upcoming anime that might need status updates
   */
  static async getUpcomingAnime(): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('anime')
        .select('id, title, status, total_episodes')
        .eq('status', 'upcoming')

      if (error) {
        console.error('Error fetching upcoming anime:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error fetching upcoming anime:', error)
      return []
    }
  }

  /**
   * Auto-update all upcoming anime that now have episodes
   */
  static async autoUpdateUpcomingAnime(): Promise<{ updated: number; errors: number }> {
    try {
      const upcomingAnime = await this.getUpcomingAnime()
      const animeIds = upcomingAnime.map(anime => anime.id)
      
      if (animeIds.length === 0) {
        console.log('No upcoming anime to check')
        return { updated: 0, errors: 0 }
      }

      console.log(`Checking ${animeIds.length} upcoming anime for episode availability...`)
      return await this.batchUpdateAnimeStatuses(animeIds)
    } catch (error) {
      console.error('Error in auto-update:', error)
      return { updated: 0, errors: 1 }
    }
  }
}
