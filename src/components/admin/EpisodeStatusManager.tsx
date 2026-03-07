import React, { useState } from 'react';
import { useAutoUpdateUpcomingAnime } from '../../hooks/anime/episode';
import Button from '../base/Button';

interface EpisodeStatusManagerProps {
  className?: string;
}

export default function EpisodeStatusManager({ className = '' }: EpisodeStatusManagerProps) {
  const { triggerUpdate, isUpdating, lastUpdate, updateStats } = useAutoUpdateUpcomingAnime();
  const [manualUpdateStats, setManualUpdateStats] = useState<{ updated: number; errors: number } | null>(null);

  const handleManualUpdate = async () => {
    const stats = await triggerUpdate();
    setManualUpdateStats(stats);
  };

  return (
    <div className={`bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-6 border border-white/50 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-teal-800 flex items-center">
          <i className="ri-refresh-line mr-2"></i>
          Episode Status Manager
        </h3>
        <Button
          onClick={handleManualUpdate}
          disabled={isUpdating}
          className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {isUpdating ? (
            <span className="flex items-center gap-2">
              <i className="ri-loader-4-line animate-spin"></i>
              Updating...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <i className="ri-refresh-line"></i>
              Update Now
            </span>
          )}
        </Button>
      </div>

      <div className="space-y-4">
        {/* Auto-update status */}
        <div className="bg-teal-50 rounded-lg p-4">
          <h4 className="font-semibold text-teal-800 mb-2">Auto-Update Status</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-teal-600">Last Update:</span>
              <div className="font-medium">
                {lastUpdate ? lastUpdate.toLocaleString() : 'Never'}
              </div>
            </div>
            <div>
              <span className="text-teal-600">Status:</span>
              <div className="font-medium text-green-600">
                {isUpdating ? 'Updating...' : 'Active'}
              </div>
            </div>
          </div>
        </div>

        {/* Update statistics */}
        {(updateStats || manualUpdateStats) && (
          <div className="bg-blue-50 rounded-lg p-4">
            <h4 className="font-semibold text-blue-800 mb-2">Update Statistics</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-blue-600">Anime Updated:</span>
                <div className="font-medium text-green-600">
                  {(updateStats || manualUpdateStats)?.updated || 0}
                </div>
              </div>
              <div>
                <span className="text-blue-600">Errors:</span>
                <div className="font-medium text-red-600">
                  {(updateStats || manualUpdateStats)?.errors || 0}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Information */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="font-semibold text-gray-800 mb-2">How it works</h4>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Automatically checks upcoming anime every 10 minutes</li>
            <li>• Updates status from "upcoming" to "ongoing" when episodes are available</li>
            <li>• Changes "Watch Now" button to "Upcoming" when no episodes exist</li>
            <li>• Real-time status updates on anime detail pages</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
