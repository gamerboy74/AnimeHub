
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../base/Button';
import NotificationCenter from './NotificationCenter';
import SearchBar from '../search/SearchBar';
import { useCurrentUser, useSignOut } from '../../hooks/auth/selectors';

import { prefetchOnHover } from '../../router/helpers/prefetch';

export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const user = useCurrentUser();
  const signOut = useSignOut();
  const navigate = useNavigate();

  const menuItems = [
    { label: 'Home', href: '/', icon: 'ri-home-line' },
    { label: 'Browse Anime', href: '/anime', icon: 'ri-movie-2-line' },
    { label: 'My Watchlist', href: '/watchlist', icon: 'ri-bookmark-line' },
    { label: 'Favorites', href: '/favorites', icon: 'ri-heart-line' },
    { label: 'Profile', href: '/profile', icon: 'ri-user-line' }
  ];

  const userMenuItems = [
    { label: 'Profile', href: '/profile', icon: 'ri-user-line' },
    { label: 'Watchlist', href: '/watchlist', icon: 'ri-bookmark-line' },
    { label: 'Favorites', href: '/favorites', icon: 'ri-heart-line' },
    { label: 'Settings', href: '/settings', icon: 'ri-settings-line' },
    { label: 'Help', href: '/help', icon: 'ri-question-line' },
    { label: 'Sign Out', action: 'signout', icon: 'ri-logout-box-line' }
  ];

  const handleUserMenuAction = async (item: any) => {
    if (item.action === 'signout') {
      try {
        await signOut();
        setIsUserMenuOpen(false);
        // Navigate to home page after successful signout
        if (typeof navigate === 'function') {
          navigate('/');
        } else {
          console.error('navigate is not a function:', navigate);
          window.location.href = '/';
        }
      } catch (error) {
        console.error('Sign out failed:', error);
        // Show error message to user
        alert('Sign out failed. Please try again.');
      }
    } else if (item.href) {
      if (typeof navigate === 'function') {
        navigate(item.href);
      } else {
        console.error('navigate is not a function:', navigate);
        window.location.href = item.href;
      }
      setIsUserMenuOpen(false);
    }
  };

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6 }}
      className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-teal-200 shadow-sm w-full"
    >
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2 flex-shrink-0">
            <div className="w-8 h-8 bg-teal-700 rounded-lg flex items-center justify-center">
              <i className="ri-play-fill text-white"></i>
            </div>
            <span className="text-xl font-bold text-teal-800 font-pacifico">
              AnimeHub
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-6">
            <Link 
              to="/anime" 
              onMouseEnter={() => prefetchOnHover('/anime')}
              className="text-teal-700 hover:text-teal-600 font-medium transition-colors duration-200 whitespace-nowrap"
            >
              Browse
            </Link>
            <Link 
              to="/watchlist" 
              onMouseEnter={() => prefetchOnHover('/watchlist')}
              className="text-teal-700 hover:text-teal-600 font-medium transition-colors duration-200 whitespace-nowrap"
            >
              Watchlist
            </Link>
            <Link 
              to="/favorites" 
              onMouseEnter={() => prefetchOnHover('/favorites')}
              className="text-teal-700 hover:text-teal-600 font-medium transition-colors duration-200 whitespace-nowrap"
            >
              Favorites
            </Link>
          </div>

          {/* Search Bar */}
          <div className="hidden lg:block flex-1 max-w-md mx-8">
            <SearchBar 
              placeholder="Search anime..."
              className="w-full"
            />
          </div>

          {/* Desktop User Actions */}
          <div className="hidden md:flex items-center space-x-4 flex-shrink-0">
            {user ? (
              <>
                {/* Notifications */}
                <NotificationCenter />

                {/* User Menu */}
                <div className="relative">
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="w-8 h-8 rounded-full overflow-hidden hover:ring-2 hover:ring-teal-200 transition-all duration-200 cursor-pointer"
                  >
                    <img
                      src={user.avatar_url || "https://readdy.ai/api/search-image?query=Anime%20character%20avatar%2C%20friendly%20face%2C%20Studio%20Ghibli%20style%2C%20simple%20background%2C%20portrait%2C%20colorful%20anime%20style&width=150&height=150&seq=navbar-avatar&orientation=squarish"}
                      alt={user.username}
                      className="w-full h-full object-cover object-top"
                      width={32}
                      height={32}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const fallback = target.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                    <div className="w-full h-full bg-teal-100 rounded-full flex items-center justify-center" style={{ display: 'none' }}>
                      <i className="ri-user-line text-teal-700"></i>
                    </div>
                  </button>

              {/* User Dropdown */}
              <AnimatePresence>
                {isUserMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsUserMenuOpen(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="absolute right-0 top-full mt-2 w-48 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-teal-200 z-50 overflow-hidden"
                    >
                      {userMenuItems.map((item, index) => (
                        <button
                          key={index}
                          onClick={() => handleUserMenuAction(item)}
                          onMouseEnter={() => item.href && prefetchOnHover(item.href)}
                          className="flex items-center gap-3 px-4 py-3 text-teal-700 hover:text-teal-900 hover:bg-green-50 transition-all duration-200 cursor-pointer w-full text-left"
                        >
                          <i className={item.icon}></i>
                          <span>{item.label}</span>
                        </button>
                      ))}
                      
                      {/* Admin Link */}
                      {user?.subscription_type === 'vip' && (
                        <button
                          onClick={() => {
                            navigate('/admin');
                            setIsUserMenuOpen(false);
                          }}
                          onMouseEnter={() => prefetchOnHover('/admin')}
                          className="flex items-center gap-3 px-4 py-3 text-purple-700 hover:text-purple-900 hover:bg-purple-50 transition-all duration-200 cursor-pointer w-full text-left border-t border-gray-200 mt-2 pt-3"
                        >
                          <i className="ri-admin-line"></i>
                          <span>Admin Panel</span>
                        </button>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
                </div>
              </>
            ) : (
              <>
                {/* Login/Signup Buttons */}
                <Button
                  variant="ghost"
                  onClick={() => navigate('/login')}
                  className="text-teal-700 hover:text-teal-800"
                >
                  Login
                </Button>
                <Button
                  onClick={() => navigate('/login?signup=true')}
                  className="bg-teal-600 hover:bg-teal-700 text-white"
                >
                  Sign Up
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden w-8 h-8 flex items-center justify-center text-teal-700 hover:text-teal-900 transition-colors duration-200 cursor-pointer"
          >
            <i className={`ri-${isMenuOpen ? 'close' : 'menu'}-line text-xl`}></i>
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="md:hidden bg-white/95 backdrop-blur-md border-t border-teal-200"
          >
            <div className="px-4 py-4 space-y-4">
              {/* Mobile Search */}
              <SearchBar 
                placeholder="Search anime..."
                className="w-full"
              />

              {/* Mobile Navigation Links */}
              {menuItems.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setIsMenuOpen(false)}
                  onMouseEnter={() => prefetchOnHover(item.href)}
                  className="flex items-center space-x-3 px-4 py-2 text-teal-700 hover:text-teal-900 hover:bg-green-50 rounded-lg transition-all duration-200 cursor-pointer"
                >
                  <i className={item.icon}></i>
                  <span className="font-medium">{item.label}</span>
                </Link>
              ))}

              {/* Mobile User Actions */}
              <div className="pt-4 border-t border-teal-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-teal-800">Account</span>
                  <div className="flex items-center gap-3">
                    <NotificationCenter />
                    <Link
                      to="/profile"
                      onClick={() => setIsMenuOpen(false)}
                      className="w-8 h-8 rounded-full overflow-hidden hover:ring-2 hover:ring-teal-200 transition-all duration-200 cursor-pointer"
                    >
                      <img
                        src="https://readdy.ai/api/search-image?query=Anime%20character%20avatar%2C%20friendly%20face%2C%20Studio%20Ghibli%20style%2C%20simple%20background%2C%20portrait%2C%20colorful%20anime%20style&width=150&height=150&seq=navbar-avatar-mobile&orientation=squarish"
                        alt="Profile"
                        className="w-full h-full object-cover object-top"
                        width={32}
                        height={32}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const fallback = target.nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                      <div className="w-full h-full bg-teal-100 rounded-full flex items-center justify-center" style={{ display: 'none' }}>
                        <i className="ri-user-line text-teal-700"></i>
                      </div>
                    </Link>
                  </div>
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>


    </motion.nav>
  );
}
