
import { motion } from 'framer-motion';

interface QuickActionsProps {
  onAction: (action: string) => void;
}

export default function QuickActions({ onAction }: QuickActionsProps) {
  const actions = [
    {
      id: 'add_anime',
      title: 'Add New Anime',
      description: 'Upload new anime series',
      icon: 'ri-add-circle-line',
      color: 'bg-blue-500 hover:bg-blue-600',
      textColor: 'text-blue-600'
    },
    {
      id: 'manage_users',
      title: 'Manage Users',
      description: 'View and moderate users',
      icon: 'ri-user-settings-line',
      color: 'bg-green-500 hover:bg-green-600',
      textColor: 'text-green-600'
    },
    {
      id: 'view_reports',
      title: 'View Reports',
      description: 'Check content reports',
      icon: 'ri-flag-line',
      color: 'bg-yellow-500 hover:bg-yellow-600',
      textColor: 'text-yellow-600'
    },
    {
      id: 'system_settings',
      title: 'System Settings',
      description: 'Configure platform',
      icon: 'ri-settings-3-line',
      color: 'bg-purple-500 hover:bg-purple-600',
      textColor: 'text-purple-600'
    }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
    >
      <h2 className="text-xl font-semibold text-slate-800 mb-6">Quick Actions</h2>
      
      <div className="space-y-3">
        {actions.map((action, index) => (
          <motion.button
            key={action.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + index * 0.1 }}
            onClick={() => onAction(action.id)}
            className="w-full flex items-center space-x-4 p-4 rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all duration-200 cursor-pointer group"
          >
            <div className={`w-10 h-10 ${action.color} rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform duration-200`}>
              <i className={`${action.icon} text-lg`}></i>
            </div>
            <div className="flex-1 text-left">
              <h3 className="font-medium text-slate-800 group-hover:text-slate-900">{action.title}</h3>
              <p className="text-sm text-slate-600">{action.description}</p>
            </div>
            <i className="ri-arrow-right-line text-slate-400 group-hover:text-slate-600 group-hover:translate-x-1 transition-all duration-200"></i>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
