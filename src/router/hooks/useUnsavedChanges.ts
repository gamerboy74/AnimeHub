/**
 * Unsaved Changes Detection Hook
 * Detects unsaved form changes and prompts user before navigation
 */

import { useEffect, useRef, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';
import { useNavigation as useNavigationContext } from '../../contexts/navigation/NavigationContext';

interface UseUnsavedChangesOptions {
  enabled?: boolean;
  message?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

/**
 * Hook to detect and block navigation when there are unsaved changes
 */
export function useUnsavedChanges(
  hasUnsavedChanges: boolean,
  options: UseUnsavedChangesOptions = {}
) {
  const {
    enabled = true,
    message = 'You have unsaved changes. Are you sure you want to leave?',
    onConfirm,
    onCancel,
  } = options;

  const { setLoading } = useNavigationContext();
  const hasUnsavedRef = useRef(hasUnsavedChanges);

  // Update ref when changes state updates
  useEffect(() => {
    hasUnsavedRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  // Block navigation when there are unsaved changes
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      enabled && hasUnsavedRef.current && currentLocation.pathname !== nextLocation.pathname
  );

  // Handle navigation block
  useEffect(() => {
    if (blocker.state === 'blocked' && hasUnsavedRef.current) {
      const confirmed = window.confirm(message);
      
      if (confirmed) {
        onConfirm?.();
        blocker.proceed();
      } else {
        onCancel?.();
        blocker.reset();
      }
    }
  }, [blocker, message, onConfirm, onCancel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setLoading(false);
    };
  }, [setLoading]);

  return {
    hasUnsavedChanges,
    isBlocked: blocker.state === 'blocked',
  };
}

/**
 * Hook for form-based unsaved changes detection
 */
export function useFormUnsavedChanges<T extends Record<string, unknown>>(
  formData: T,
  initialData: T,
  options?: Omit<UseUnsavedChangesOptions, 'enabled'>
) {
  const hasChanges = JSON.stringify(formData) !== JSON.stringify(initialData);
  
  return useUnsavedChanges(hasChanges, { enabled: true, ...options });
}

