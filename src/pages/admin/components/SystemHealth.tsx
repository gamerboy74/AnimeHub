
import { motion } from 'framer-motion';

interface SystemHealthProps {
  health: {
    database_status: string;
    api_response_time: number;
    storage_usage: number;
    active_connections: number;
    error_rate: number;
  } | null;
}

export default function SystemHealth({ health }: SystemHealthProps) {
  // Handle null health data
  if (!health) {
    return (
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6">
        <h2 className="text-xl font-bold text-slate-800 mb-4">System Health</h2>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-green-600 bg-green-100';
      case 'warning':
        return 'text-yellow-600 bg-yellow-100';
      case 'error':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-slate-600 bg-slate-100';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'ri-check-line';
      case 'warning':
        return 'ri-error-warning-line';
      case 'error':
        return 'ri-close-line';
      default:
        return 'ri-question-line';
    }
  };

  const systemComponents = [
    { name: 'Database', status: health.database_status, icon: 'ri-database-2-line' },
    { name: 'API', status: health.api_response_time < 1000 ? 'healthy' : 'warning', icon: 'ri-api-line' },
    { name: 'Storage', status: health.storage_usage < 80 ? 'healthy' : 'warning', icon: 'ri-hard-drive-line' },
    { name: 'Connections', status: health.active_connections > 0 ? 'healthy' : 'error', icon: 'ri-wifi-line' }
  ];

  const performanceMetrics = [
    { label: 'Response Time', value: `${health.api_response_time}ms`, icon: 'ri-speed-line' },
    { label: 'Storage Usage', value: `${health.storage_usage}%`, icon: 'ri-hard-drive-line' },
    { label: 'Active Connections', value: health.active_connections.toLocaleString(), icon: 'ri-user-line' },
    { label: 'Error Rate', value: `${health.error_rate}%`, icon: 'ri-error-warning-line' }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
    >
      <h2 className="text-xl font-semibold text-slate-800 mb-6">System Health</h2>

      {/* System Status */}
      <div className="space-y-3 mb-6">
        {systemComponents.map((component, index) => (
          <motion.div
            key={component.name}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 + index * 0.1 }}
            className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors duration-200"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                <i className={`${component.icon} text-slate-600`}></i>
              </div>
              <span className="font-medium text-slate-700">{component.name}</span>
            </div>
            
            <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center space-x-1 ${getStatusColor(component.status)}`}>
              <i className={getStatusIcon(component.status)}></i>
              <span className="capitalize">{component.status}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Performance Metrics */}
      <div className="border-t border-slate-200 pt-6">
        <h3 className="text-sm font-medium text-slate-700 mb-4">Performance Metrics</h3>
        <div className="grid grid-cols-2 gap-4">
          {performanceMetrics.map((metric, index) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8 + index * 0.1 }}
              className="text-center p-3 bg-slate-50/50 rounded-lg"
            >
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                <i className={`${metric.icon} text-blue-600 text-sm`}></i>
              </div>
              <p className="text-lg font-semibold text-slate-800">{metric.value}</p>
              <p className="text-xs text-slate-600">{metric.label}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* System Actions */}
      <div className="border-t border-slate-200 pt-6 mt-6">
        <div className="flex space-x-2">
          <button className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 cursor-pointer text-sm whitespace-nowrap">
            <i className="ri-refresh-line mr-1"></i>
            Refresh
          </button>
          <button className="flex-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors duration-200 cursor-pointer text-sm whitespace-nowrap">
            <i className="ri-settings-line mr-1"></i>
            Settings
          </button>
        </div>
      </div>
    </motion.div>
  );
}
