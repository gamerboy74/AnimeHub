/**
 * Router Module Exports
 * Centralized exports for all router utilities
 */

// Route configuration
export { default as routes } from './config';

// Main router component is exported from index.tsx

// Metadata
export * from './metadata';

// Guards
export * from './guards';

// Analytics
export { navigationAnalytics } from './analytics';

// Components
export { RouteWrapper } from './components/RouteWrapper';
export { Breadcrumbs } from './components/Breadcrumbs';
export { NavigationTransition } from './components/NavigationTransition';

// Hooks
export { useUnsavedChanges, useFormUnsavedChanges } from './hooks/useUnsavedChanges';
export { useNavigationUtils } from './hooks/useNavigation';

// Utilities
export * from './utils/documentTitle';
export * from './utils/queryParams';
export * from './utils/routeHelpers';

