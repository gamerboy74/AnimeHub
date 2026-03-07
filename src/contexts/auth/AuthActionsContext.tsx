// Optimized Auth Actions Context - Separated from AuthContext
// Reduces re-renders by isolating auth actions

import React, { createContext, useContext, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { sessionManager } from '../../utils/session/manager';

interface AuthActionsContextType {
  signUp: (email: string, password: string, username?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  refreshSession: () => Promise<void>;
  isSessionValid: () => boolean;
}

const AuthActionsContext = createContext<AuthActionsContextType | undefined>(undefined);

interface AuthActionsProviderProps {
  children: ReactNode;
}

export function AuthActionsProvider({ children }: AuthActionsProviderProps) {
  // Memoize auth actions to prevent unnecessary re-renders
  const signUp = useCallback(async (email: string, password: string, username?: string) => {
    await sessionManager.signUp(email, password, username);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await sessionManager.signIn(email, password);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await sessionManager.signInWithGoogle();
  }, []);

  const signInWithGitHub = useCallback(async () => {
    await sessionManager.signInWithGitHub();
  }, []);

  const signOut = useCallback(async () => {
    await sessionManager.signOut();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sessionManager.resetPassword(email);
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    await sessionManager.updatePassword(newPassword);
  }, []);

  const refreshSession = useCallback(async () => {
    await sessionManager.refreshSession();
  }, []);

  const isSessionValid = useCallback(() => {
    return sessionManager.isSessionValid();
  }, []);

  const authActions = useMemo(() => ({
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

  return (
    <AuthActionsContext.Provider value={authActions}>
      {children}
    </AuthActionsContext.Provider>
  );
}

export function useAuthActions() {
  const context = useContext(AuthActionsContext);
  if (context === undefined) {
    throw new Error('useAuthActions must be used within an AuthActionsProvider');
  }
  return context;
}

// Individual action hooks for better performance
export function useSignIn() {
  const { signIn } = useAuthActions();
  return signIn;
}

export function useSignOut() {
  const { signOut } = useAuthActions();
  return signOut;
}

export function useSignUp() {
  const { signUp } = useAuthActions();
  return signUp;
}
