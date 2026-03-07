
import { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export default function Card({ children, className = '', hover = true }: CardProps) {
  return (
    <motion.div
      whileHover={hover ? { scale: 1.02, y: -2 } : {}}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`bg-white/90 backdrop-blur-sm rounded-2xl shadow-md hover:shadow-lg border border-white/30 overflow-hidden transition-shadow duration-300 ${className}`}
    >
      {children}
    </motion.div>
  );
}
