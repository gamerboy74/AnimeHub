// Error Boundary Component for AnimeHub
// Catches JavaScript errors anywhere in the component tree and displays fallback UI

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { motion } from 'framer-motion';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

class ErrorBoundary extends Component<Props, State> {
  private maxRetries = 3;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // Send error to monitoring service
    this.logError(error, errorInfo);

    // Call custom error handler
    this.props.onError?.(error, errorInfo);
  }

  private logError = (error: Error, errorInfo: ErrorInfo) => {
    // Dynamic import to avoid circular dependencies
    import('../../utils/monitoring/errorTracking').then(({ errorTracker }) => {
      const errorData = {
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        retryCount: this.state.retryCount
      };

      errorTracker.captureException(error, errorData);
    }).catch(() => {
      // Fallback if error tracking fails
      console.error('Error in ErrorBoundary:', error, errorInfo);
    });
  };

  private handleRetry = () => {
    if (this.state.retryCount < this.maxRetries) {
      this.setState(prevState => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: prevState.retryCount + 1
      }));
    } else {
      // Max retries reached, reload the page
      window.location.reload();
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 to-pink-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
          >
            {/* Error Icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6"
            >
              <i className="ri-error-warning-line text-3xl text-red-500"></i>
            </motion.div>

            {/* Error Title */}
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-2xl font-bold text-gray-800 mb-4"
            >
              Oops! Something went wrong
            </motion.h1>

            {/* Error Message */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-gray-600 mb-6"
            >
              We encountered an unexpected error. Don't worry, our team has been notified.
            </motion.p>

            {/* Error Details (Development only) */}
            {process.env.NODE_ENV === 'development' && this.props.showDetails && this.state.error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ delay: 0.5 }}
                className="mb-6 p-4 bg-gray-100 rounded-lg text-left"
              >
                <h3 className="font-semibold text-gray-800 mb-2">Error Details:</h3>
                <p className="text-sm text-red-600 mb-2">{this.state.error.message}</p>
                <details className="text-xs text-gray-600">
                  <summary className="cursor-pointer font-medium">Stack Trace</summary>
                  <pre className="mt-2 whitespace-pre-wrap">{this.state.error.stack}</pre>
                </details>
              </motion.div>
            )}

            {/* Action Buttons */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex flex-col sm:flex-row gap-3"
            >
              {this.state.retryCount < this.maxRetries ? (
                <button
                  onClick={this.handleRetry}
                  className="flex-1 px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                  <i className="ri-refresh-line mr-2"></i>
                  Try Again ({this.maxRetries - this.state.retryCount} attempts left)
                </button>
              ) : (
                <button
                  onClick={this.handleReload}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  <i className="ri-refresh-line mr-2"></i>
                  Reload Page
                </button>
              )}

              <button
                onClick={this.handleGoHome}
                className="flex-1 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
              >
                <i className="ri-home-line mr-2"></i>
                Go Home
              </button>
            </motion.div>

            {/* Retry Count */}
            {this.state.retryCount > 0 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-sm text-gray-500 mt-4"
              >
                Retry attempt {this.state.retryCount} of {this.maxRetries}
              </motion.p>
            )}
          </motion.div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Higher-order component for wrapping components with error boundary
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) => {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
};

// Hook for error boundary context
export const useErrorHandler = () => {
  const handleError = (error: Error, errorInfo?: ErrorInfo) => {
    console.error('Error caught by useErrorHandler:', error, errorInfo);
    
    // You can add custom error handling logic here
    // e.g., send to analytics, show toast notification, etc.
  };

  return { handleError };
};

// Error boundary for specific sections
export const SectionErrorBoundary: React.FC<{
  children: ReactNode;
  sectionName: string;
  fallback?: ReactNode;
}> = ({ children, sectionName, fallback }) => (
  <ErrorBoundary
    fallback={fallback || (
      <div className="p-8 text-center bg-red-50 rounded-lg border border-red-200">
        <i className="ri-error-warning-line text-2xl text-red-500 mb-2"></i>
        <p className="text-red-700 font-medium">Failed to load {sectionName}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm"
        >
          Reload
        </button>
      </div>
    )}
    onError={(error, errorInfo) => {
      console.error(`Error in ${sectionName}:`, error, errorInfo);
    }}
  >
    {children}
  </ErrorBoundary>
);

export default ErrorBoundary;
