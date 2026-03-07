
import { motion } from 'framer-motion';

interface Activity {
  id?: number;
  type: string;
  message?: string;
  time?: string;
  timestamp?: string;
  description?: string;
  status?: string;
  user?: string;
  anime?: string;
  rating?: number;
  episode?: string;
}

interface RecentActivityProps {
  activities: Activity[] | null;
}

export default function RecentActivity({ activities }: RecentActivityProps) {
  // Handle null activities
  if (!activities) {
    return (
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6">
        <h2 className="text-xl font-bold text-slate-800 mb-4">Recent Activity</h2>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'user_registration':
        return 'ri-user-add-line';
      case 'review':
        return 'ri-star-line';
      case 'episode_completed':
        return 'ri-check-double-line';
      case 'episode_watched':
        return 'ri-play-circle-line';
      case 'favorited':
        return 'ri-heart-line';
      case 'added':
        return 'ri-bookmark-line';
      case 'rated':
        return 'ri-star-fill';
      case 'anime_upload':
        return 'ri-upload-line';
      case 'report':
        return 'ri-flag-line';
      case 'server':
        return 'ri-server-line';
      case 'user_ban':
        return 'ri-user-forbid-line';
      case 'payment':
        return 'ri-money-dollar-circle-line';
      case 'system':
        return 'ri-settings-line';
      case 'content':
        return 'ri-movie-2-line';
      default:
        return 'ri-information-line';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-600 bg-green-100';
      case 'error':
        return 'text-red-600 bg-red-100';
      case 'warning':
        return 'text-yellow-600 bg-yellow-100';
      case 'info':
        return 'text-blue-600 bg-blue-100';
      case 'new':
        return 'text-purple-600 bg-purple-100';
      default:
        return 'text-slate-600 bg-slate-100';
    }
  };

  const handleActivityClick = (activity: Activity) => {
    // Handle different activity types
    switch (activity.type) {
      case 'user_registration':
      case 'user_ban':
        window.REACT_APP_NAVIGATE('/admin/users');
        break;
      case 'anime_upload':
      case 'content':
        window.REACT_APP_NAVIGATE('/admin/anime');
        break;
      case 'report':
        // Could navigate to reports page
        console.log('Navigate to reports');
        break;
      default:
        break;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-slate-800">Recent Activity</h2>
        <button className="text-sm text-blue-600 hover:text-blue-700 cursor-pointer">
          View All
        </button>
      </div>

      <div className="space-y-4">
        {activities.map((activity, index) => (
          <motion.div
            key={activity.id || `activity-${index}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + index * 0.05 }}
            onClick={() => handleActivityClick(activity)}
            className="flex items-start space-x-4 p-3 rounded-lg hover:bg-slate-50/50 transition-colors duration-200 cursor-pointer group"
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getStatusColor(activity.status || 'info')}`}>
              <i className={`${getActivityIcon(activity.type)} text-sm`}></i>
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-800 group-hover:text-slate-900">
                {activity.message || activity.description || 'Activity'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {activity.time || activity.timestamp || 'Recently'}
              </p>
            </div>

            <i className="ri-arrow-right-line text-slate-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200"></i>
          </motion.div>
        ))}
      </div>

      {activities.length === 0 && (
        <div className="text-center py-8">
          <i className="ri-history-line text-4xl text-slate-300 mb-4"></i>
          <p className="text-slate-500">No recent activity</p>
        </div>
      )}
    </motion.div>
  );
}
