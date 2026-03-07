
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '../../hooks/useNotifications';

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = window.REACT_APP_NAVIGATE;

  const {
    notifications: rawNotifications,
    isLoading,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications();

  // Adapt DB records to the shape the UI expects
  const notifications = rawNotifications.map((n) => ({
    id: n.id,
    type: (n.type || 'system') as 'new_episode' | 'recommendation' | 'system' | 'achievement',
    title: n.title,
    message: n.message,
    timestamp: new Date(n.created_at),
    read: n.read,
    actionUrl: n.action_url ?? undefined,
  }));

  const handleNotificationClick = (notification: typeof notifications[number]) => {
    markAsRead(notification.id);
    if (notification.actionUrl) {
      setIsOpen(false);
      navigate(notification.actionUrl);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'new_episode':
        return 'ri-play-circle-line';
      case 'recommendation':
        return 'ri-heart-line';
      case 'achievement':
        return 'ri-trophy-line';
      case 'system':
        return 'ri-settings-line';
      default:
        return 'ri-notification-line';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'new_episode':
        return 'text-blue-600 bg-blue-100';
      case 'recommendation':
        return 'text-pink-600 bg-pink-100';
      case 'achievement':
        return 'text-yellow-600 bg-yellow-100';
      case 'system':
        return 'text-gray-600 bg-gray-100';
      default:
        return 'text-teal-600 bg-teal-100';
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 60) {
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      return `${days}d ago`;
    }
  };

  return (
    <div className="relative">
      {/* Notification Bell */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-8 h-8 flex items-center justify-center text-teal-700 hover:text-teal-900 transition-colors duration-200"
      >
        <i className="ri-notification-line text-xl"></i>
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </motion.span>
        )}
      </button>

      {/* Notification Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            
            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.2 }}
              className="absolute right-0 top-full mt-2 w-80 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-green-200 z-50 max-h-96 overflow-hidden"
            >
              {/* Header */}
              <div className="p-4 border-b border-green-200">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-teal-800">Notifications</h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="text-sm text-teal-600 hover:text-teal-700 transition-colors duration-200 whitespace-nowrap"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
              </div>

              {/* Notifications List */}
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <i className="ri-notification-off-line text-3xl mb-2"></i>
                    <p>No notifications yet</p>
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <motion.div
                      key={notification.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-4 border-b border-green-100 hover:bg-green-50/50 transition-colors duration-200 cursor-pointer ${
                        !notification.read ? 'bg-teal-50/50' : ''
                      }`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getNotificationColor(notification.type)}`}>
                          <i className={`${getNotificationIcon(notification.type)} text-sm`}></i>
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between">
                            <h4 className={`text-sm font-medium ${!notification.read ? 'text-teal-800' : 'text-gray-800'}`}>
                              {notification.title}
                            </h4>
                            <div className="flex items-center gap-1 ml-2">
                              {!notification.read && (
                                <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteNotification(notification.id);
                                }}
                                className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors duration-200"
                              >
                                <i className="ri-close-line text-xs"></i>
                              </button>
                            </div>
                          </div>
                          
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                            {notification.message}
                          </p>
                          
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-gray-500">
                              {formatTimestamp(notification.timestamp)}
                            </span>
                            
                            <div className="flex items-center gap-2">
                              {!notification.read && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    markAsRead(notification.id);
                                  }}
                                  className="text-xs text-teal-600 hover:text-teal-700 transition-colors duration-200 whitespace-nowrap"
                                >
                                  Mark read
                                </button>
                              )}
                              {notification.actionUrl && (
                                <span className="text-xs text-blue-600">
                                  Click to view
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Footer */}
              {notifications.length > 0 && (
                <div className="p-3 border-t border-green-200 text-center">
                  <button
                    onClick={() => setIsOpen(false)}
                    className="text-sm text-teal-600 hover:text-teal-700 transition-colors duration-200 whitespace-nowrap"
                  >
                    Close notifications
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
