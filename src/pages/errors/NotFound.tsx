import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function NotFound() {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center"
        >
          <div className="w-20 h-20 bg-gradient-to-br from-teal-500 to-teal-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <i className="ri-compass-discover-line text-4xl text-white"></i>
          </div>
          <h1 className="text-7xl font-bold text-teal-700 mb-2">404</h1>
          <h2 className="text-2xl font-semibold text-teal-800 mt-4">Page Not Found</h2>
          <p className="mt-3 text-teal-500 max-w-md mx-auto">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
          <div className="flex items-center justify-center gap-3 mt-8">
            <Link
              to="/"
              className="inline-flex items-center gap-2 bg-teal-700 hover:bg-teal-600 text-white px-6 py-2.5 rounded-xl font-medium transition-all shadow-lg hover:shadow-xl"
            >
              <i className="ri-home-line"></i>
              Go Home
            </Link>
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center gap-2 bg-teal-100 hover:bg-teal-200 text-teal-800 px-6 py-2.5 rounded-xl font-medium transition-all"
            >
              <i className="ri-arrow-left-line"></i>
              Go Back
            </button>
          </div>
        </motion.div>
      </div>
    );
  }