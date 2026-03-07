import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes default
      gcTime: 30 * 60 * 1000, // 30 minutes (increased from 10)
      retry: 1, // Reduced retries to fail faster
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
      refetchOnWindowFocus: false, // Prevent refetch on tab focus
      refetchOnReconnect: true,
      refetchOnMount: false, // Use cached data if available
      networkMode: 'online', // Only retry when online
    },
    mutations: {
      retry: 1,
    },
  },
});

export default queryClient;


