
import { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion } from 'framer-motion';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export default function Button({ 
  variant = 'primary', 
  size = 'md', 
  children, 
  className = '', 
  ...props 
}: ButtonProps) {
  const baseClasses = 'whitespace-nowrap cursor-pointer font-medium rounded-xl transition-all duration-200 flex items-center justify-center';
  
  const variants = {
    primary: 'bg-teal-700 hover:bg-teal-600 text-white shadow-lg hover:shadow-xl hover:scale-105',
    secondary: 'bg-teal-100 hover:bg-teal-200 text-teal-800 shadow-md hover:shadow-lg hover:scale-105',
    ghost: 'bg-transparent hover:bg-teal-700/10 text-teal-700 hover:text-teal-800'
  };
  
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  };

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  );
}
