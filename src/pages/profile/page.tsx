
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import Navbar from '../../components/feature/Navbar';
import Footer from '../../components/feature/Footer';
import Button from '../../components/base/Button';
import Input from '../../components/base/Input';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import GenrePreferences from '../../components/profile/GenrePreferences';
import { useCurrentUser, useAuthLoading as useAuthLoadingSelector } from '../../hooks/auth/selectors';
import { useContinueWatching } from '../../hooks/user';
import { UserService } from '../../services/user';
import { UserPreferencesService } from '../../services/user/preferences';
import { AvatarService } from '../../services/auth/avatar';
import { generatePlayerUrl } from '../../utils/media/player';
import { sessionManager } from '../../utils/session/manager';

export default function ProfilePage() {
  const user = useCurrentUser();
  const authLoading = useAuthLoadingSelector();
  const [activeTab, setActiveTab] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [showGenrePreferences, setShowGenrePreferences] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingUsername, setEditingUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [userStats, setUserStats] = useState({
    watchTime: '0 hours',
    completedSeries: 0,
    currentlyWatching: 0,
    favoriteGenres: [] as string[],
    totalFavorites: 0,
    totalWatchlist: 0,
    totalReviews: 0,
    totalEpisodesWatched: 0
  });
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  
  const { continueWatching, loading: continueLoading } = useContinueWatching(user?.id);

  // Fetch user data and statistics
  useEffect(() => {
    const fetchUserData = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // Fetch user statistics and preferences in parallel
        const [stats, preferences] = await Promise.all([
          UserService.getUserStats(user.id),
          UserPreferencesService.getUserPreferences(user.id)
        ]);
        
        setUserStats(prevStats => ({
          ...prevStats,
          completedSeries: stats.completedEpisodes,
          currentlyWatching: stats.currentlyWatching || 0,
          totalFavorites: stats.totalFavorites,
          totalWatchlist: stats.totalWatchlist,
          totalReviews: stats.totalReviews,
          totalEpisodesWatched: stats.totalEpisodesWatched,
          favoriteGenres: preferences?.favorite_genres || [],
          watchTime: stats.watchTime || '0 hours'
        }));

        // Fetch recent activity
        const activity = await UserService.getRecentActivity(user.id);
        setRecentActivity(activity);

        // Fetch achievements
        const userAchievements = await UserService.getAchievements(user.id);
        setAchievements(userAchievements);

      } catch (error) {
        console.error('Failed to fetch user data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [user]);

  const handleEditProfile = () => {
    setEditingUsername(user?.username || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditingUsername('');
    setIsEditing(false);
  };

  const handleSaveProfile = async () => {
    if (!user || !editingUsername.trim() || saving) return;
    
    try {
      setSaving(true);
      
      // Update only the username in the database
      const updatedUser = await UserService.updateUserProfile(user.id, {
        username: editingUsername.trim()
      });
      
      // Update the session manager with the new user data
      // This will trigger a re-render across the app
      await sessionManager.refreshSession();
      
      setIsEditing(false);
      setEditingUsername('');
      
      console.log('Username updated successfully:', updatedUser.username);
    } catch (error) {
      console.error('Failed to save profile:', error);
      // You could add a toast notification here
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    try {
      setUploadingAvatar(true);
      
      // Create preview
      const previewUrl = URL.createObjectURL(file);
      setAvatarPreview(previewUrl);

      // Upload to Supabase storage
      const avatarUrl = await AvatarService.uploadAvatar(file, user.id, (progress) => {
        console.log(`Upload progress: ${progress}%`);
      });

      // Update user profile with new avatar URL
      const updatedUser = await UserService.updateUserProfile(user.id, {
        avatar_url: avatarUrl
      });

      // Refresh session to update user data across the app
      await sessionManager.refreshSession();

      console.log('Avatar uploaded successfully:', avatarUrl);
      
      // Clean up preview
      URL.revokeObjectURL(previewUrl);
      setAvatarPreview(null);
      
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      // Clean up preview on error
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview);
        setAvatarPreview(null);
      }
    } finally {
      setUploadingAvatar(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const handleGenrePreferencesSave = (genres: string[]) => {
    setUserStats(prev => ({
      ...prev,
      favoriteGenres: genres
    }));
    setShowGenrePreferences(false);
  };

  const handleGenrePreferencesCancel = () => {
    setShowGenrePreferences(false);
  };

  // Redirect to login if not authenticated
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <i className="ri-user-line text-6xl text-teal-300 mb-4"></i>
          <h2 className="text-2xl font-bold text-teal-800 mb-2">Please Sign In</h2>
          <p className="text-teal-600 mb-6">You need to be signed in to view your profile.</p>
          <Link
            to="/"
            className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors duration-200"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <SparkleLoadingSpinner size="lg" text="Loading your profile..." />
        </div>
      </div>
    );
  }

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'watched': return 'ri-play-circle-line';
      case 'completed': return 'ri-checkbox-circle-line';
      case 'added': return 'ri-add-circle-line';
      case 'favorited': return 'ri-heart-line';
      case 'rated': return 'ri-star-line';
      default: return 'ri-circle-line';
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'watched': return 'text-blue-600';
      case 'completed': return 'text-green-600';
      case 'added': return 'text-purple-600';
      case 'favorited': return 'text-pink-600';
      case 'rated': return 'text-yellow-600';
      default: return 'text-teal-600';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
      <Navbar />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Profile Header */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="mb-8"
        >
          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-8">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
              <div className="relative">
                <img
                  src={avatarPreview || AvatarService.getAvatarUrl(user?.avatar_url, user?.id)}
                  alt="Profile Avatar"
                  className="w-24 h-24 rounded-full object-cover object-top border-4 border-teal-200"
                  width={96}
                  height={96}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = AvatarService.getAvatarUrl(null, user?.id);
                  }}
                />
                <div className="absolute bottom-0 right-0">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                    id="avatar-upload"
                    disabled={uploadingAvatar}
                  />
                  <label
                    htmlFor="avatar-upload"
                    className={`w-8 h-8 bg-teal-700 text-white rounded-full flex items-center justify-center hover:bg-teal-600 transition-colors duration-200 cursor-pointer ${
                      uploadingAvatar ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    title="Upload Avatar"
                  >
                    {uploadingAvatar ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <i className="ri-camera-line text-sm"></i>
                    )}
                  </label>
                </div>
              </div>
              
              <div className="flex-1">
                {isEditing ? (
                  <div>
                    <label className="block text-sm font-medium text-teal-700 mb-2">
                      Username
                    </label>
                    <Input
                      value={editingUsername}
                      onChange={(e) => setEditingUsername(e.target.value)}
                      placeholder="Enter your username"
                    />
                    <p className="text-xs text-teal-500 mt-1">Only username can be changed</p>
                  </div>
                ) : (
                  <>
                    <h1 className="text-3xl font-bold text-teal-800 mb-2">{user?.username || 'Anime Fan'}</h1>
                    <p className="text-teal-600 mb-4">{user?.email}</p>
                    <div className="flex items-center gap-2 mb-4">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        user?.subscription_type === 'vip' 
                          ? 'bg-purple-200 text-purple-800' 
                          : user?.subscription_type === 'premium'
                          ? 'bg-yellow-200 text-yellow-800'
                          : 'bg-green-200 text-green-800'
                      }`}>
                        {user?.subscription_type?.toUpperCase() || 'FREE'}
                      </span>
                    </div>
                  </>
                )}
                
                <div className="flex flex-wrap gap-4 text-sm text-teal-600 mb-4">
                  <span className="flex items-center gap-1">
                    <i className="ri-calendar-line"></i>
                    Joined {new Date(user?.created_at || '').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="ri-time-line"></i>
                    {userStats.watchTime} watched
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="ri-checkbox-circle-line"></i>
                    {userStats.completedSeries} completed
                  </span>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-4">
                  {userStats.favoriteGenres && userStats.favoriteGenres.length > 0 ? userStats.favoriteGenres.map((genre) => (
                    <span
                      key={genre}
                      className="px-3 py-1 bg-pink-200 text-teal-800 text-sm rounded-full font-medium"
                    >
                      {genre}
                    </span>
                  )) : (
                    <span className="text-sm text-teal-500 italic">No favorite genres yet</span>
                  )}
                  <button
                    onClick={() => setShowGenrePreferences(true)}
                    className="px-3 py-1 bg-teal-100 text-teal-700 text-sm rounded-full font-medium hover:bg-teal-200 transition-colors flex items-center gap-1"
                  >
                    <i className="ri-add-line text-xs"></i>
                    {userStats.favoriteGenres.length > 0 ? 'Edit' : 'Add'} Genres
                  </button>
                </div>
              </div>
              
              <div className="flex gap-3">
                {isEditing ? (
                  <>
                    <Button onClick={handleSaveProfile} size="sm" disabled={!editingUsername.trim() || saving}>
                      {saving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                          Saving...
                        </>
                      ) : (
                        <>
                          <i className="ri-save-line mr-2"></i>
                          Save Username
                        </>
                      )}
                    </Button>
                    <Button variant="secondary" onClick={handleCancelEdit} size="sm" disabled={saving}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleEditProfile} variant="secondary" size="sm">
                    <i className="ri-edit-line mr-2"></i>
                    Edit Username
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.section>

        {/* Tab Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-8"
        >
          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-2">
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
                { id: 'watching', label: 'Currently Watching', icon: 'ri-play-circle-line' },
                { id: 'activity', label: 'Recent Activity', icon: 'ri-history-line' },
                { id: 'achievements', label: 'Achievements', icon: 'ri-trophy-line' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                    activeTab === tab.id
                      ? 'bg-teal-700 text-white shadow-sm'
                      : 'text-teal-700 hover:bg-green-100'
                  }`}
                >
                  <i className={tab.icon}></i>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Main Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Stats Cards */}
                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow duration-200">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <i className="ri-play-circle-line text-2xl text-blue-600"></i>
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-teal-800">{userStats.currentlyWatching}</h3>
                      <p className="text-teal-600">Currently Watching</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow duration-200">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <i className="ri-checkbox-circle-line text-2xl text-green-600"></i>
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-teal-800">{userStats.completedSeries}</h3>
                      <p className="text-teal-600">Completed Episodes</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow duration-200">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                      <i className="ri-time-line text-2xl text-purple-600"></i>
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-teal-800">{userStats.watchTime}</h3>
                      <p className="text-teal-600">Total Watch Time</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow duration-200">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center">
                      <i className="ri-heart-line text-2xl text-pink-600"></i>
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-teal-800">{userStats.totalFavorites}</h3>
                      <p className="text-teal-600">Favorites</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow duration-200">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                      <i className="ri-bookmark-line text-2xl text-yellow-600"></i>
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-teal-800">{userStats.totalWatchlist}</h3>
                      <p className="text-teal-600">Watchlist</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow duration-200">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <i className="ri-star-line text-2xl text-indigo-600"></i>
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-teal-800">{userStats.totalReviews}</h3>
                      <p className="text-teal-600">Reviews</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow duration-200 md:col-span-2 lg:col-span-1">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-teal-100 rounded-lg flex items-center justify-center">
                      <i className="ri-tv-line text-2xl text-teal-600"></i>
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-teal-800">{userStats.totalEpisodesWatched}</h3>
                      <p className="text-teal-600">Episodes Watched</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6">
                <h3 className="text-lg font-bold text-teal-800 mb-4">Quick Actions</h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setActiveTab('watching')}
                    className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors flex items-center gap-2"
                  >
                    <i className="ri-play-circle-line"></i>
                    Continue Watching
                  </button>
                  <button
                    onClick={() => setActiveTab('activity')}
                    className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors flex items-center gap-2"
                  >
                    <i className="ri-history-line"></i>
                    View Activity
                  </button>
                  <button
                    onClick={() => setActiveTab('achievements')}
                    className="px-4 py-2 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors flex items-center gap-2"
                  >
                    <i className="ri-trophy-line"></i>
                    View Achievements
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'watching' && (
            <div className="space-y-4">
              {continueLoading ? (
                <div className="text-center py-12">
                  <div className="w-12 h-12 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-teal-700 font-medium">Loading your watch progress...</p>
                </div>
              ) : continueWatching.length > 0 ? (
                continueWatching.map((item, index) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6"
                  >
                    <div className="flex items-center gap-6">
                      <Link to={`/anime/${item.anime?.id}`} className="flex-shrink-0">
                        <img
                          src={item.thumbnail || item.anime?.poster_url || "https://readdy.ai/api/search-image?query=Anime%20thumbnail%2C%20default%20anime%20image&width=200&height=300&seq=watching-thumbnail&orientation=portrait"}
                          srcSet={item.thumbnail || item.anime?.poster_url ? `${(item.thumbnail || item.anime?.poster_url)}?w=96 96w, ${(item.thumbnail || item.anime?.poster_url)}?w=128 128w, ${(item.thumbnail || item.anime?.poster_url)}?w=160 160w` : undefined}
                          sizes="(max-width: 640px) 96px, 128px"
                          alt={item.title}
                          className="w-16 h-20 object-cover object-top rounded-lg hover:scale-105 transition-transform duration-300"
                          width={64}
                          height={80}
                          loading="lazy"
                          decoding="async"
                        />
                      </Link>
                      
                      <div className="flex-1">
                        <Link to={`/anime/${item.anime?.id}`}>
                          <h3 className="text-lg font-bold text-teal-800 mb-2 hover:text-teal-600 transition-colors duration-200">
                            {item.title}
                          </h3>
                        </Link>
                        
                        <p className="text-teal-600 text-sm mb-3">
                          Episode {item.episode}
                        </p>
                        
                        <div className="w-full bg-green-200 rounded-full h-2 mb-3">
                          <div
                            className="bg-teal-700 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(item.progress, 100)}%` }}
                          ></div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <Link to={generatePlayerUrl(item.anime?.id || '', item.episode, item.progressSeconds)}>
                            <Button size="sm">
                              <i className="ri-play-fill mr-1"></i>
                              Continue Watching
                            </Button>
                          </Link>
                          <span className="text-sm text-teal-600">{Math.min(item.progress, 100)}% complete</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="text-center py-12">
                  <i className="ri-play-circle-line text-6xl text-teal-300 mb-4"></i>
                  <p className="text-teal-600 text-lg">No anime in progress</p>
                  <p className="text-teal-500 text-sm">Start watching to see your progress here</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-green-200 p-6">
              <h2 className="text-xl font-bold text-teal-800 mb-6">Recent Activity</h2>
              <div className="space-y-4">
                {recentActivity.length > 0 ? (
                  recentActivity.map((activity, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      className="flex items-center gap-4 p-4 hover:bg-green-50 rounded-lg transition-colors duration-200"
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getActivityColor(activity.type)} bg-current bg-opacity-10`}>
                        <i className={`${getActivityIcon(activity.type)} ${getActivityColor(activity.type)}`}></i>
                      </div>
                      
                      <div className="flex-1">
                        <p className="text-teal-800">
                          {activity.type === 'watched' && (
                            <>Watched episode {activity.episode ? `${activity.episode} ` : ''}of </>
                          )}
                          {activity.type === 'completed' && (
                            <>Completed episode {activity.episode ? `${activity.episode} of ` : ''}</>
                          )}
                          {activity.type === 'added' && 'Added to watchlist '}
                          {activity.type === 'favorited' && 'Favorited '}
                          {activity.type === 'rated' && `Rated ${activity.rating}/10 `}
                          <Link to={`/anime/${activity.anime.id}`} className="font-medium hover:text-teal-600 transition-colors duration-200">
                            {activity.anime.title}
                          </Link>
                        </p>
                        <p className="text-sm text-teal-600">{activity.time}</p>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="text-center py-12">
                    <i className="ri-history-line text-6xl text-teal-300 mb-4"></i>
                    <p className="text-teal-600 text-lg">No recent activity</p>
                    <p className="text-teal-500 text-sm">Start watching anime to see your activity here</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'achievements' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {achievements.length > 0 ? (
                achievements.map((achievement, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className={`bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border p-6 ${
                      achievement.earned ? 'border-yellow-300 bg-yellow-50/50' : 'border-green-200'
                    }`}
                  >
                    <div className="text-center">
                      <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
                        achievement.earned ? 'bg-yellow-100 text-yellow-600' : 'bg-teal-50 text-teal-400'
                      }`}>
                        <i className={`${achievement.icon} text-2xl`}></i>
                      </div>
                      
                      <h3 className={`text-lg font-bold mb-2 ${
                        achievement.earned ? 'text-yellow-700' : 'text-teal-500'
                      }`}>
                        {achievement.title}
                      </h3>
                      
                      <p className={`text-sm ${
                        achievement.earned ? 'text-yellow-600' : 'text-teal-400'
                      }`}>
                        {achievement.description}
                      </p>
                      
                      {achievement.earned && (
                        <div className="mt-3">
                          <span className="inline-flex items-center px-2 py-1 bg-yellow-200 text-yellow-800 text-xs rounded-full">
                            <i className="ri-check-line mr-1"></i>
                            Earned
                          </span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="col-span-full text-center py-12">
                  <i className="ri-trophy-line text-6xl text-teal-300 mb-4"></i>
                  <p className="text-teal-600 text-lg">No achievements yet</p>
                  <p className="text-teal-500 text-sm">Start watching anime to unlock achievements</p>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </main>

      {/* Genre Preferences Modal */}
      <AnimatePresence>
        {showGenrePreferences && user && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
            onClick={() => setShowGenrePreferences(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-4xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <GenrePreferences
                userId={user.id}
                onSave={handleGenrePreferencesSave}
                onCancel={handleGenrePreferencesCancel}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Footer />
    </div>
  );
}
