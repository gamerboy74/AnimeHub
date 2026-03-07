
import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import ProtectedRoute from '../components/auth/ProtectedRoute';
import AdminLayout from '../pages/admin/AdminLayout';
import { RouteWrapper } from './components/RouteWrapper';

const HomePage = lazy(() => import('../pages/home'));
const AnimePage = lazy(() => import('../pages/anime/page'));
const AnimeDetailPage = lazy(() => import('../pages/anime-detail/page'));
const PlayerPage = lazy(() => import('../pages/player/page'));
const WatchlistPage = lazy(() => import('../pages/watchlist/page'));
const ProfilePage = lazy(() => import('../pages/profile/page'));
const SearchPage = lazy(() => import('../pages/search/page'));
const SettingsPage = lazy(() => import('../pages/settings/page'));
const FavoritesPage = lazy(() => import('../pages/favorites/page'));
const NotFoundPage = lazy(() => import('../pages/errors/NotFound'));

// Admin Pages
const AdminDashboard = lazy(() => import('../pages/admin/page'));
const AdminAnime = lazy(() => import('../pages/admin/anime/page'));
const AdminUsers = lazy(() => import('../pages/admin/users/page'));
const AdminReports = lazy(() => import('../pages/admin/reports/page'));
const AdminAnalytics = lazy(() => import('../pages/admin/analytics/page'));
const AdminPerformance = lazy(() => import('../pages/admin/performance/page'));
const AdminSettings = lazy(() => import('../pages/admin/settings/page'));

const routes: RouteObject[] = [
  {
    path: '/',
    element: <RouteWrapper path="/"><HomePage /></RouteWrapper>
  },
  {
    path: '/anime',
    element: <RouteWrapper path="/anime"><AnimePage /></RouteWrapper>
  },
  {
    path: '/anime/:id',
    element: <RouteWrapper path="/anime/:id"><AnimeDetailPage /></RouteWrapper>
  },
  {
    path: '/player/:animeId/:episode',
    element: <RouteWrapper path="/player/:animeId/:episode"><PlayerPage /></RouteWrapper>
  },
  {
    path: '/watchlist',
    element: (
      <RouteWrapper path="/watchlist">
        <ProtectedRoute>
          <WatchlistPage />
        </ProtectedRoute>
      </RouteWrapper>
    )
  },
  {
    path: '/profile',
    element: (
      <RouteWrapper path="/profile">
        <ProtectedRoute>
          <ProfilePage />
        </ProtectedRoute>
      </RouteWrapper>
    )
  },
  {
    path: '/search',
    element: <RouteWrapper path="/search"><SearchPage /></RouteWrapper>
  },
  {
    path: '/settings',
    element: (
      <RouteWrapper path="/settings">
        <ProtectedRoute>
          <SettingsPage />
        </ProtectedRoute>
      </RouteWrapper>
    )
  },
  {
    path: '/favorites',
    element: (
      <RouteWrapper path="/favorites">
        <ProtectedRoute>
          <FavoritesPage />
        </ProtectedRoute>
      </RouteWrapper>
    )
  },
  // Admin Routes
  {
    path: '/admin',
    element: (
      <RouteWrapper path="/admin">
        <ProtectedRoute requireAdmin>
          <AdminLayout />
        </ProtectedRoute>
      </RouteWrapper>
    ),
    children: [
      {
        index: true,
        element: <RouteWrapper path="/admin"><AdminDashboard /></RouteWrapper>
      },
      {
        path: 'anime',
        element: <RouteWrapper path="/admin/anime"><AdminAnime /></RouteWrapper>
      },
      {
        path: 'users',
        element: <RouteWrapper path="/admin/users"><AdminUsers /></RouteWrapper>
      },
      {
        path: 'reports',
        element: <RouteWrapper path="/admin/reports"><AdminReports /></RouteWrapper>
      },
      {
        path: 'analytics',
        element: <RouteWrapper path="/admin/analytics"><AdminAnalytics /></RouteWrapper>
      },
      {
        path: 'performance',
        element: <RouteWrapper path="/admin/performance"><AdminPerformance /></RouteWrapper>
      },
      {
        path: 'settings',
        element: <RouteWrapper path="/admin/settings"><AdminSettings /></RouteWrapper>
      }
    ]
  },
  {
    path: '*',
    element: <RouteWrapper path="*"><NotFoundPage /></RouteWrapper>
  }
];

export default routes;
