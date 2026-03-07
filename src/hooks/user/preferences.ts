import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPreferencesService } from '../../services/user/preferences'
import { useCurrentUser } from '../auth/selectors'

const PREFS_KEY = 'user-preferences'

export function usePreferences() {
  const user = useCurrentUser()
  const queryClient = useQueryClient()

  const { data: preferences, isLoading } = useQuery({
    queryKey: [PREFS_KEY, user?.id],
    queryFn: () => UserPreferencesService.getUserPreferences(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  })

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, any>) =>
      UserPreferencesService.updateUserPreferences(user!.id, updates),
    onSuccess: (data) => {
      queryClient.setQueryData([PREFS_KEY, user?.id], data)
    },
  })

  const updatePreferences = (updates: Record<string, any>) => {
    if (!user?.id) return
    updateMutation.mutate(updates)
  }

  return {
    preferences,
    isLoading,
    isSaving: updateMutation.isPending,
    saveError: updateMutation.isError,
    updatePreferences,
  }
}
