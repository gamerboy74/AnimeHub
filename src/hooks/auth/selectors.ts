// Optimized auth selector hooks
// These hooks only subscribe to specific auth state slices to prevent unnecessary re-renders

import { useMemo } from 'react';
import { useAuthContext } from '../../contexts/auth/AuthContext';

// Hook to get only the current user (memoized by user ID)
export const useCurrentUser = () => {
  const { user } = useAuthContext();
  return useMemo(() => user, [user?.id]);
};

// Hook to get only authentication status
export const useIsAuthenticated = () => {
  const { user } = useAuthContext();
  return useMemo(() => !!user, [user?.id]);
};

// Hook to get only loading state
export const useAuthLoading = () => {
  const { loading } = useAuthContext();
  return loading;
};

// Hook to get only error state
export const useAuthError = () => {
  const { error } = useAuthContext();
  return error;
};

// Hook to get only user ID (useful for API calls)
export const useUserId = () => {
  const { user } = useAuthContext();
  return useMemo(() => user?.id || null, [user?.id]);
};

// Hook to get only user email
export const useUserEmail = () => {
  const { user } = useAuthContext();
  return useMemo(() => user?.email || null, [user?.email]);
};

// Hook to get only username
export const useUsername = () => {
  const { user } = useAuthContext();
  return useMemo(() => user?.username || null, [user?.username]);
};

// Hook to get only subscription type
export const useSubscriptionType = () => {
  const { user } = useAuthContext();
  return useMemo(() => user?.subscription_type || 'free', [user?.subscription_type]);
};

// Hook to check if user is admin
export const useIsAdmin = () => {
  const { user } = useAuthContext();
  return useMemo(() => user?.subscription_type === 'admin', [user?.subscription_type]);
};

// Hook to check if user is premium
export const useIsPremium = () => {
  const { user } = useAuthContext();
  return useMemo(() => 
    user?.subscription_type === 'premium' || user?.subscription_type === 'vip',
    [user?.subscription_type]
  );
};

// Hook to get auth actions (sign in, sign out, etc.)
export const useAuthActions = () => {
  const { 
    signUp, 
    signIn, 
    signInWithGoogle, 
    signInWithGitHub, 
    signOut, 
    resetPassword, 
    updatePassword, 
    refreshSession, 
    isSessionValid 
  } = useAuthContext();
  
  return useMemo(() => ({
    signUp,
    signIn,
    signInWithGoogle,
    signInWithGitHub,
    signOut,
    resetPassword,
    updatePassword,
    refreshSession,
    isSessionValid
  }), [
    signUp,
    signIn,
    signInWithGoogle,
    signInWithGitHub,
    signOut,
    resetPassword,
    updatePassword,
    refreshSession,
    isSessionValid
  ]);
};

// Hook to get specific auth action (useful for components that only need one action)
export const useSignIn = () => {
  const { signIn } = useAuthContext();
  return signIn;
};

export const useSignOut = () => {
  const { signOut } = useAuthContext();
  return signOut;
};

export const useSignUp = () => {
  const { signUp } = useAuthContext();
  return signUp;
};

export const useResetPassword = () => {
  const { resetPassword } = useAuthContext();
  return resetPassword;
};

export const useUpdatePassword = () => {
  const { updatePassword } = useAuthContext();
  return updatePassword;
};

export const useRefreshSession = () => {
  const { refreshSession } = useAuthContext();
  return refreshSession;
};

export const useIsSessionValid = () => {
  const { isSessionValid } = useAuthContext();
  return isSessionValid;
};
