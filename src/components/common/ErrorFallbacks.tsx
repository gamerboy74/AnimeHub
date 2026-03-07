import React from 'react';
import { motion } from 'framer-motion';

interface ErrorFallbackProps {
  error?: Error;
  resetError?: () => void;
  title?: string;
  message?: string;
  showRetry?: boolean;
  className?: string;
}

// Generic section error fallback
export const SectionError: React.FC<ErrorFallbackProps> = ({
  error,
  resetError,
  title = "Something went wrong",
  message = "This section couldn't load properly.",
  showRetry = true,
  className = ""
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={`bg-white/80 backdrop-blur-sm rounded-xl p-6 shadow-lg border border-red-200 text-center ${className}`}
  >
    <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mx-auto mb-4">
      <i className="ri-error-warning-line text-2xl text-red-500"></i>
    </div>
    <h3 className="text-lg font-semibold text-teal-800 mb-2">{title}</h3>
    <p className="text-teal-600 mb-4">{message}</p>
    
    {showRetry && resetError && (
      <button
        onClick={resetError}
        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
      >
        Try Again
      </button>
    )}
    
    {import.meta.env.DEV && error && (
      <details className="mt-4 text-left">
        <summary className="cursor-pointer text-sm text-teal-500">Error Details</summary>
        <pre className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto">
          {error.message}
        </pre>
      </details>
    )}
  </motion.div>
);

// Video player specific error fallback
export const VideoPlayerError: React.FC<ErrorFallbackProps> = ({
  error,
  resetError,
  title = "Video Player Error",
  message = "The video couldn't load. This might be due to network issues or an unsupported format.",
  showRetry = true,
  className = ""
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    className={`bg-black/90 backdrop-blur-sm rounded-lg p-8 shadow-2xl border border-red-500/50 text-center ${className}`}
  >
    <div className="w-14 h-14 bg-red-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
      <i className="ri-film-line text-3xl text-red-400"></i>
    </div>
    <h3 className="text-xl font-semibold text-white mb-3">{title}</h3>
    <p className="text-gray-300 mb-6 max-w-md mx-auto">{message}</p>
    
    <div className="flex flex-col sm:flex-row gap-3 justify-center">
      {showRetry && resetError && (
        <button
          onClick={resetError}
          className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-medium"
        >
          Retry Video
        </button>
      )}
      
      <button
        onClick={() => window.history.back()}
        className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors font-medium"
      >
        Go Back
      </button>
    </div>
    
    {import.meta.env.DEV && error && (
      <details className="mt-6 text-left">
        <summary className="cursor-pointer text-sm text-gray-400">Debug Info</summary>
        <pre className="mt-2 text-xs text-red-300 bg-black/50 p-3 rounded overflow-auto">
          {error.message}
        </pre>
      </details>
    )}
  </motion.div>
);

// Content loading error fallback
export const ContentError: React.FC<ErrorFallbackProps> = ({
  error,
  resetError,
  title = "Content Loading Error",
  message = "We couldn't load this content. Please check your connection and try again.",
  showRetry = true,
  className = ""
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={`bg-gradient-to-br from-orange-50 to-red-50 rounded-xl p-6 shadow-lg border border-orange-200 text-center ${className}`}
  >
    <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
      <i className="ri-file-warning-line text-2xl text-orange-500"></i>
    </div>
    <h3 className="text-lg font-semibold text-teal-800 mb-2">{title}</h3>
    <p className="text-teal-600 mb-4">{message}</p>
    
    {showRetry && resetError && (
      <button
        onClick={resetError}
        className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
      >
        Reload Content
      </button>
    )}
    
    {import.meta.env.DEV && error && (
      <details className="mt-4 text-left">
        <summary className="cursor-pointer text-sm text-teal-500">Error Details</summary>
        <pre className="mt-2 text-xs text-orange-600 bg-orange-50 p-2 rounded overflow-auto">
          {error.message}
        </pre>
      </details>
    )}
  </motion.div>
);

// Network error fallback
export const NetworkError: React.FC<ErrorFallbackProps> = ({
  error,
  resetError,
  title = "Connection Problem",
  message = "It looks like you're offline or having connection issues. Please check your internet connection.",
  showRetry = true,
  className = ""
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={`bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 shadow-lg border border-blue-200 text-center ${className}`}
  >
    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
      <i className="ri-wifi-off-line text-2xl text-blue-500"></i>
    </div>
    <h3 className="text-lg font-semibold text-teal-800 mb-2">{title}</h3>
    <p className="text-teal-600 mb-4">{message}</p>
    
    <div className="flex flex-col sm:flex-row gap-3 justify-center">
      {showRetry && resetError && (
        <button
          onClick={resetError}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
        >
          Retry Connection
        </button>
      )}
      
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg transition-colors"
      >
        Refresh Page
      </button>
    </div>
    
    {import.meta.env.DEV && error && (
      <details className="mt-4 text-left">
        <summary className="cursor-pointer text-sm text-teal-500">Network Error Details</summary>
        <pre className="mt-2 text-xs text-blue-600 bg-blue-50 p-2 rounded overflow-auto">
          {error.message}
        </pre>
      </details>
    )}
  </motion.div>
);

// Loading error fallback (for when loading fails)
export const LoadingError: React.FC<ErrorFallbackProps> = ({
  error,
  resetError,
  title = "Loading Failed",
  message = "The content is taking longer than expected to load. This might be due to server issues.",
  showRetry = true,
  className = ""
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    className={`bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-6 shadow-lg border border-purple-200 text-center ${className}`}
  >
    <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-4">
      <i className="ri-loader-line text-2xl text-purple-500"></i>
    </div>
    <h3 className="text-lg font-semibold text-teal-800 mb-2">{title}</h3>
    <p className="text-teal-600 mb-4">{message}</p>
    
    {showRetry && resetError && (
      <button
        onClick={resetError}
        className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors"
      >
        Try Loading Again
      </button>
    )}
    
    {import.meta.env.DEV && error && (
      <details className="mt-4 text-left">
        <summary className="cursor-pointer text-sm text-teal-500">Loading Error Details</summary>
        <pre className="mt-2 text-xs text-purple-600 bg-purple-50 p-2 rounded overflow-auto">
          {error.message}
        </pre>
      </details>
    )}
  </motion.div>
);

// Default export with all error fallbacks
export default {
  SectionError,
  VideoPlayerError,
  ContentError,
  NetworkError,
  LoadingError
};
