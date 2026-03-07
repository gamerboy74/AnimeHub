/**
 * Breadcrumbs Component
 * Displays navigation breadcrumbs based on current route
 */

import { Link, useLocation } from 'react-router-dom';
import { getRouteMetadata } from '../metadata';
import { motion } from 'framer-motion';

interface Breadcrumb {
  label: string;
  path: string;
}

interface BreadcrumbsProps {
  customBreadcrumbs?: Breadcrumb[];
}

export function Breadcrumbs({ customBreadcrumbs }: BreadcrumbsProps) {
  const location = useLocation();
  const params = location.pathname.match(/\/[^/]+/g)?.reduce((acc, segment) => {
    const key = segment.replace('/', '');
    acc[key] = segment;
    return acc;
  }, {} as Record<string, string>) || {};

  // Use custom breadcrumbs if provided, otherwise get from metadata
  const metadata = getRouteMetadata(location.pathname, params, location.state as Record<string, unknown>);
  const breadcrumbs = customBreadcrumbs || 
    (typeof metadata?.breadcrumbs === 'function' 
      ? metadata.breadcrumbs(params, location.state as Record<string, unknown>)
      : metadata?.breadcrumbs) || [];

  if (breadcrumbs.length === 0) return null;

  return (
    <nav 
      className="flex items-center space-x-2 text-sm text-gray-600 mb-4 px-4 py-2 bg-gray-50 rounded-lg"
      aria-label="Breadcrumb"
    >
      <ol className="flex items-center space-x-2">
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          
          return (
            <li key={crumb.path} className="flex items-center">
              {index > 0 && (
                <i className="ri-arrow-right-s-line text-gray-400 mr-2"></i>
              )}
              {isLast ? (
                <span className="text-gray-900 font-medium" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.path}
                  className="text-teal-600 hover:text-teal-700 hover:underline transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

