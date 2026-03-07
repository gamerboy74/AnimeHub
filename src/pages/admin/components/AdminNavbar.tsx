
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentUser, useSignOut } from '../../../hooks/auth/selectors';
import { useNavigation } from '../../../contexts/navigation/NavigationContext';

interface AdminNavbarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function AdminNavbar({ collapsed, onToggleCollapse }: AdminNavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const user = useCurrentUser();
  const signOut = useSignOut();
  const { navigateTo } = useNavigation();

  const navSections = [
    {
      label: 'Main',
      items: [
        { name: 'Dashboard', path: '/admin', icon: 'ri-dashboard-line' },
        { name: 'Anime', path: '/admin/anime', icon: 'ri-movie-2-line' },
        { name: 'Users', path: '/admin/users', icon: 'ri-group-line' },
      ]
    },
    {
      label: 'Insights',
      items: [
        { name: 'Reports', path: '/admin/reports', icon: 'ri-flag-line' },
        { name: 'Analytics', path: '/admin/analytics', icon: 'ri-line-chart-line' },
        { name: 'Performance', path: '/admin/performance', icon: 'ri-speed-line' },
      ]
    },
    {
      label: 'System',
      items: [
        { name: 'Settings', path: '/admin/settings', icon: 'ri-settings-3-line' },
      ]
    }
  ];

  const isActive = (path: string) => {
    if (path === '/admin') return location.pathname === '/admin';
    return location.pathname.startsWith(path);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigateTo('/');
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  const handleNavClick = (path: string) => {
    setMobileOpen(false);
    navigateTo(path);
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const SidebarContent = ({ isMobile = false }: { isMobile?: boolean }) => {
    const isExpanded = !collapsed || isMobile;

    return (
      <div className="flex flex-col h-full">
        {/* Brand */}
        <div className={`flex items-center h-16 shrink-0 border-b border-slate-200/60 ${isExpanded ? 'px-5' : 'justify-center px-2'}`}>
          <button onClick={() => handleNavClick('/admin')} className="flex items-center gap-3 cursor-pointer">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20 flex-shrink-0">
              <i className="ri-admin-line text-white text-lg"></i>
            </div>
            {isExpanded && (
              <span className="text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent whitespace-nowrap">
                AnimeHub
              </span>
            )}
          </button>
          {!isMobile && isExpanded && (
            <button
              onClick={onToggleCollapse}
              className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Collapse sidebar"
            >
              <i className="ri-side-bar-line text-lg"></i>
            </button>
          )}
        </div>

        {/* Expand toggle when collapsed */}
        {!isMobile && collapsed && (
          <div className="flex justify-center py-3 shrink-0">
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Expand sidebar"
            >
              <i className="ri-side-bar-fill text-lg"></i>
            </button>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {navSections.map((section, sIdx) => (
            <div key={section.label}>
              {isExpanded && (
                <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.label}
                </div>
              )}
              {!isExpanded && sIdx > 0 && (
                <div className="mx-auto w-6 border-t border-slate-200/60 mb-3"></div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <button
                      key={item.path}
                      onClick={() => handleNavClick(item.path)}
                      className={`group relative flex items-center w-full ${isExpanded ? 'px-3' : 'justify-center'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                        active
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                      }`}
                      title={!isExpanded ? item.name : undefined}
                    >
                      {active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-blue-600 rounded-r-full" />
                      )}
                      <i className={`${item.icon} text-lg flex-shrink-0 ${active ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`}></i>
                      {isExpanded && <span className="ml-3 whitespace-nowrap">{item.name}</span>}

                      {/* Tooltip when collapsed */}
                      {!isExpanded && (
                        <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[60] shadow-xl">
                          {item.name}
                          <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800 rotate-45"></div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom Section */}
        <div className="border-t border-slate-200/60 p-3 space-y-1 shrink-0">
          {/* Home link */}
          <button
            onClick={() => navigateTo('/')}
            className={`group relative flex items-center w-full ${isExpanded ? 'px-3' : 'justify-center'} py-2.5 rounded-xl text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-all duration-200 cursor-pointer`}
            title={!isExpanded ? 'Back to Site' : undefined}
          >
            <i className="ri-home-line text-lg flex-shrink-0"></i>
            {isExpanded && <span className="ml-3">Back to Site</span>}
            {!isExpanded && (
              <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[60] shadow-xl">
                Back to Site
                <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800 rotate-45"></div>
              </div>
            )}
          </button>

          {/* User profile */}
          <div className={`flex ${isExpanded ? 'flex-row items-center px-3' : 'flex-col items-center'} py-2.5 gap-2`}>
            <div className="relative flex-shrink-0">
              <img
                src={user?.avatar_url || ''}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex'; }}
              />
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full items-center justify-center hidden text-white text-xs font-bold">
                {(user?.username || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></div>
            </div>
            {isExpanded ? (
              <>
                <div className="ml-1 flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{user?.username || 'Admin'}</p>
                  <p className="text-[11px] text-slate-400 truncate">Administrator</p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
                  title="Sign Out"
                >
                  <i className="ri-logout-box-r-line text-lg"></i>
                </button>
              </>
            ) : (
              <button
                onClick={handleSignOut}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                title="Sign Out"
              >
                <i className="ri-logout-box-r-line text-sm"></i>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-40 bg-white/80 backdrop-blur-xl border-r border-slate-200/60 transition-all duration-300 ease-in-out ${
          collapsed ? 'w-[72px]' : 'w-[260px]'
        }`}
      >
        <SidebarContent />
      </aside>

      {/* Mobile Top Bar */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 h-16 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 flex items-center px-4">
        <button onClick={() => setMobileOpen(true)} className="p-2 -ml-1 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer">
          <i className="ri-menu-line text-xl"></i>
        </button>
        <div className="flex items-center gap-2.5 ml-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
            <i className="ri-admin-line text-white text-sm"></i>
          </div>
          <span className="font-bold text-slate-800">Admin Panel</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => navigateTo('/')} className="p-2 rounded-xl text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer" title="Back to Site">
            <i className="ri-home-line text-lg"></i>
          </button>
          <button onClick={handleSignOut} className="p-2 rounded-xl text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer" title="Sign Out">
            <i className="ri-logout-box-r-line text-lg"></i>
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="lg:hidden fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 z-50 w-[280px] bg-white shadow-2xl shadow-slate-900/10"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-3 p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer z-10"
              >
                <i className="ri-close-line text-xl"></i>
              </button>
              <SidebarContent isMobile />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
