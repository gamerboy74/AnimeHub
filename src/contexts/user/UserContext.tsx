// Optimized User Context - Separated from AuthContext
// Reduces re-renders by isolating user data

import React, { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Tables } from '../lib/database/supabase';

type User = Tables<'users'>;

interface UserContextType {
  user: User | null;
  isAuthenticated: boolean;
  userId: string | null;
  subscriptionType: string;
  isAdmin: boolean;
  isPremium: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
  user: User | null;
}

export function UserProvider({ children, user }: UserProviderProps) {
  // Memoize user data to prevent unnecessary re-renders
  const userData = useMemo(() => ({
    user,
    isAuthenticated: !!user,
    userId: user?.id || null,
    subscriptionType: user?.subscription_type || 'free',
    isAdmin: user?.subscription_type === 'admin',
    isPremium: user?.subscription_type === 'premium' || user?.subscription_type === 'vip'
  }), [user]);

  return (
    <UserContext.Provider value={userData}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

// Selector hooks for specific user data
export function useIsAuthenticated() {
  const { isAuthenticated } = useUser();
  return isAuthenticated;
}

export function useUserId() {
  const { userId } = useUser();
  return userId;
}

export function useSubscriptionType() {
  const { subscriptionType } = useUser();
  return subscriptionType;
}

export function useIsAdmin() {
  const { isAdmin } = useUser();
  return isAdmin;
}

export function useIsPremium() {
  const { isPremium } = useUser();
  return isPremium;
}
