
import { motion } from 'framer-motion';

interface DashboardStatsProps {
  data: {
    totalUsers: number;
    totalAnime: number;
    totalEpisodes: number;
    totalReviews: number;
    recentUsers: number;
    activeUsers: number;
    premiumUsers: number;
    totalWatchTime: string;
  } | null;
}

export default function DashboardStats({ data }: DashboardStatsProps) {
  // Handle null data
  if (!data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded mb-4"></div>
              <div className="h-8 bg-gray-200 rounded mb-2"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const stats = [
    {
      title: 'Total Users',
      value: data.totalUsers?.toLocaleString() || '0',
      icon: 'ri-user-line',
      color: 'blue',
      change: '+12.5%',
      changeType: 'increase'
    },
    {
      title: 'Total Anime',
      value: data.totalAnime?.toLocaleString() || '0',
      icon: 'ri-movie-2-line',
      color: 'green',
      change: '+8.2%',
      changeType: 'increase'
    },
    {
      title: 'Total Episodes',
      value: data.totalEpisodes?.toLocaleString() || '0',
      icon: 'ri-play-circle-line',
      color: 'purple',
      change: '+15.3%',
      changeType: 'increase'
    },
    {
      title: 'Active Users',
      value: data.activeUsers?.toLocaleString() || '0',
      icon: 'ri-live-line',
      color: 'red',
      change: '-2.1%',
      changeType: 'decrease'
    }
  ];

  const getColorClasses = (color: string) => {
    const colors = {
      blue: 'bg-blue-100 text-blue-600',
      green: 'bg-green-100 text-green-600',
      purple: 'bg-purple-100 text-purple-600',
      red: 'bg-red-100 text-red-600'
    };
    return colors[color as keyof typeof colors];
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6 hover:shadow-xl transition-all duration-300"
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${getColorClasses(stat.color)}`}>
              <i className={`${stat.icon} text-xl`}></i>
            </div>
            <div className={`text-sm font-medium ${
              stat.changeType === 'increase' ? 'text-green-600' : 'text-red-600'
            }`}>
              {stat.change}
            </div>
          </div>
          
          <div>
            <h3 className="text-2xl font-bold text-slate-800 mb-1">{stat.value}</h3>
            <p className="text-slate-600 text-sm">{stat.title}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
