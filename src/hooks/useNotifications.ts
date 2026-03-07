import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { NotificationService } from '../services/notifications'
import type { NotificationRecord } from '../services/notifications'
import { useCurrentUser } from './auth/selectors'
import { supabase } from '../lib/database/supabase'

const NOTIF_KEY = 'notifications'

export function useNotifications() {
  const user = useCurrentUser()
  const queryClient = useQueryClient()

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: [NOTIF_KEY, user?.id],
    queryFn: () => NotificationService.getNotifications(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  })

  // Realtime subscription: auto-insert new notifications
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          queryClient.setQueryData<NotificationRecord[]>(
            [NOTIF_KEY, user.id],
            (old = []) => [payload.new as NotificationRecord, ...old]
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, queryClient])

  const markAsReadMutation = useMutation({
    mutationFn: (id: string) => NotificationService.markAsRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [NOTIF_KEY, user?.id] })
      queryClient.setQueryData<NotificationRecord[]>(
        [NOTIF_KEY, user?.id],
        (old = []) => old.map((n) => (n.id === id ? { ...n, read: true } : n))
      )
    },
  })

  const markAllAsReadMutation = useMutation({
    mutationFn: () => NotificationService.markAllAsRead(user!.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: [NOTIF_KEY, user?.id] })
      queryClient.setQueryData<NotificationRecord[]>(
        [NOTIF_KEY, user?.id],
        (old = []) => old.map((n) => ({ ...n, read: true }))
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => NotificationService.deleteNotification(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [NOTIF_KEY, user?.id] })
      queryClient.setQueryData<NotificationRecord[]>(
        [NOTIF_KEY, user?.id],
        (old = []) => old.filter((n) => n.id !== id)
      )
    },
  })

  const unreadCount = notifications.filter((n) => !n.read).length

  return {
    notifications,
    isLoading,
    unreadCount,
    markAsRead: (id: string) => markAsReadMutation.mutate(id),
    markAllAsRead: () => markAllAsReadMutation.mutate(),
    deleteNotification: (id: string) => deleteMutation.mutate(id),
  }
}
