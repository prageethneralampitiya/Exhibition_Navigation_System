import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If true, only admin users can access this route */
  adminOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg, #0b0f1a)',
        }}
      >
        <div className="spinner" style={{ width: 36, height: 36, borderTopColor: 'var(--color-primary, #06b6d4)' }} />
      </div>
    );
  }

  // If no session or if user is an anonymous visitor (from the public site)
  if (!user || user.is_anonymous) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If this route is restricted to admins/store_admins
  if (adminOnly && profile?.role !== 'admin' && profile?.role !== 'store_admin') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
