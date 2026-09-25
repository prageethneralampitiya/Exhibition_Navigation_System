import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LiveBroadcastProvider } from './contexts/LiveBroadcastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RealtimeAnnouncements } from './components/RealtimeAnnouncements';
import { SplashScreen } from './components/SplashScreen';
import './index.css';

// Lazy load page components to improve initial loading performance
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));


const StoreDirectoryPage = lazy(() => import('./pages/StoreDirectoryPage').then(m => ({ default: m.StoreDirectoryPage })));
const StoreDetailPage = lazy(() => import('./pages/StoreDetailPage').then(m => ({ default: m.StoreDetailPage })));
const ExhibitionDirectoryPage = lazy(() => import('./pages/ExhibitionDirectoryPage').then(m => ({ default: m.ExhibitionDirectoryPage })));
const ExhibitionDetailPage = lazy(() => import('./pages/ExhibitionDetailPage').then(m => ({ default: m.ExhibitionDetailPage })));
const MapPage = lazy(() => import('./pages/MapPage').then(m => ({ default: m.MapPage })));
const Map3DPage = lazy(() => import('./pages/Map3DPage').then(m => ({ default: m.Map3DPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(m => ({ default: m.SearchPage })));

// Centered loading fallback component
function PageLoader() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
      flexDirection: 'column',
      gap: '1rem'
    }}>
      <div className="spinner" style={{ width: 36, height: 36, borderTopColor: 'var(--color-primary)' }} />
      <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)', letterSpacing: '0.05em' }}>
        LOADING RESOURCES...
      </span>
    </div>
  );
}


function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LiveBroadcastProvider>
          {/* ── Opening Intro Splash Screen (duration in seconds: change 4.5 here if you want a shorter/longer intro) ── */}
          <SplashScreen durationSeconds={3.5} />
          <div className="site-upper-background" aria-hidden="true" />
          <RealtimeAnnouncements />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Public routes (no login required) */}
              <Route path="/" element={<HomePage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/map3d" element={<Map3DPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/exhibitions" element={<ExhibitionDirectoryPage />} />
              <Route path="/exhibitions/:id" element={<ExhibitionDetailPage />} />
              <Route path="/stores" element={<StoreDirectoryPage />} />
              <Route path="/stores/:id" element={<StoreDetailPage />} />

              {/* Protected user routes */}
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </LiveBroadcastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

