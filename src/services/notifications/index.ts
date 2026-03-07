import { supabase } from '../../lib/database/supabase'

export interface NotificationRecord {
  id: string
  user_id: string
  type: 'new_episode' | 'recommendation' | 'system' | 'achievement'
  title: string
  message: string
  data: Record<string, any>
  read: boolean
  action_url: string | null
  created_at: string
}

export class NotificationService {
  static async getNotifications(userId: string): Promise<NotificationRecord[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Failed to fetch notifications:', error)
      return []
    }
    return data || []
  }

  static async markAsRead(notificationId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)

    if (error) console.error('Failed to mark notification as read:', error)
  }

  static async markAllAsRead(userId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)

    if (error) console.error('Failed to mark all notifications as read:', error)
  }

  static async deleteNotification(notificationId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)

    if (error) console.error('Failed to delete notification:', error)
  }
}
