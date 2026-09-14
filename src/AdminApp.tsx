import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import './index.css';

// Lazy load page components to improve initial loading performance
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AdminLayout = lazy(() => import('./components/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));

const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })));
const AdminExhibitionsPage = lazy(() => import('./pages/admin/AdminExhibitionsPage').then(m => ({ default: m.AdminExhibitionsPage })));
const AdminStoresPage = lazy(() => import('./pages/admin/AdminStoresPage').then(m => ({ default: m.AdminStoresPage })));
const AdminFacilitiesPage = lazy(() => import('./pages/admin/AdminFacilitiesPage').then(m => ({ default: m.AdminFacilitiesPage })));
const AdminCategoriesPage = lazy(() => import('./pages/admin/AdminCategoriesPage').then(m => ({ default: m.AdminCategoriesPage })));
const AdminNodesPage = lazy(() => import('./pages/admin/AdminNodesPage').then(m => ({ default: m.AdminNodesPage })));
const AdminAnnouncementsPage = lazy(() => import('./pages/admin/AdminAnnouncementsPage').then(m => ({ default: m.AdminAnnouncementsPage })));
const AdminVisitorsPage = lazy(() => import('./pages/admin/AdminVisitorsPage').then(m => ({ default: m.AdminVisitorsPage })));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminAnalyticsPage = lazy(() => import('./pages/admin/AdminAnalyticsPage').then(m => ({ default: m.AdminAnalyticsPage })));

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
        LOADING ADMIN RESOURCES...
      </span>
    </div>
  );
}

function AdminApp() {
  return (
    <BrowserRouter basename="/admin">
      <AuthProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public login route under the /admin basename -> matches /admin/login */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected admin routes under the /admin basename -> matches /admin/* */}
            <Route
              path="/*"
              element={
                <ProtectedRoute adminOnly>
                  <AdminLayout>
                    <Routes>
                      <Route path="dashboard" element={<AdminDashboardPage />} />
                      <Route path="exhibitions" element={<AdminExhibitionsPage />} />
                      <Route path="stores" element={<AdminStoresPage />} />
                      <Route path="facilities" element={<AdminFacilitiesPage />} />
                      <Route path="categories" element={<AdminCategoriesPage />} />
                      <Route path="nodes" element={<AdminNodesPage />} />
                      <Route path="announcements" element={<AdminAnnouncementsPage />} />
                      <Route path="visitors" element={<AdminVisitorsPage />} />
                      <Route path="users" element={<AdminUsersPage />} />
                      <Route path="analytics" element={<AdminAnalyticsPage />} />
                      <Route path="*" element={<Navigate to="dashboard" replace />} />
                    </Routes>
                  </AdminLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default AdminApp;
