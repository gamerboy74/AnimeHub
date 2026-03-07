/**
 * Navigation Transition Component
 * Provides smooth transitions between routes
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface NavigationTransitionProps {
  children: React.ReactNode;
  duration?: number;
}

export function NavigationTransition({ children, duration = 0.2 }: NavigationTransitionProps) {
  const location = useLocation();
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    setIsTransitioning(true);
    const timer = setTimeout(() => setIsTransitioning(false), duration * 1000);
    return () => clearTimeout(timer);
  }, [location.pathname, duration]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration, ease: 'easeInOut' }}
        style={{ willChange: 'opacity' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

