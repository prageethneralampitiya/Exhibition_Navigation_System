import { useState, useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  MapPin,
  LayoutDashboard,
  CalendarDays,
  Store,
  Tag,
  Navigation2,
  Megaphone,
  Users,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  BarChart3,
  Home,
  UserCheck,
  Maximize2,
  Coffee,
  PhoneCall,
  Building2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface NavItem {
  to: string;
  icon: ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',     icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
  { to: '/events',        icon: <CalendarDays size={18} />,    label: 'Event' },
  { to: '/blocks',        icon: <Building2 size={18} />,       label: 'Blocks' },
  { to: '/stores',        icon: <Store size={18} />,           label: 'Stores' },
  { to: '/facilities',    icon: <Coffee size={18} />,          label: 'Facilities' },
  { to: '/categories',    icon: <Tag size={18} />,             label: 'Categories' },
  { to: '/nodes',         icon: <Navigation2 size={18} />,     label: 'Nav Nodes' },
  { to: '/announcements', icon: <Megaphone size={18} />,       label: 'Announcements' },
  { to: '/emergency',     icon: <PhoneCall size={18} />,       label: 'Emergency & Lives' },
  { to: '/visitors',      icon: <Users size={18} />,           label: 'Visitors' },
  { to: '/users',         icon: <UserCheck size={18} />,       label: 'Users' },
  { to: '/analytics',     icon: <BarChart3 size={18} />,       label: 'Analytics' },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // Store admins start from the visitor homepage and navigate via the "Manage My Store" button
  }, []);


  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const sidebarClass = [
    'admin-sidebar',
    collapsed ? 'collapsed' : '',
    mobileOpen ? 'open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className={sidebarClass} aria-label="Admin navigation">
        {/* Header */}
        <div className="admin-sidebar-header">
          <div className="admin-sidebar-logo">
            <MapPin size={18} color="#fff" />
          </div>
          <span className="admin-sidebar-brand">ExNav Admin</span>
        </div>

        {/* Nav */}
        <nav className="admin-sidebar-nav">
          {profile?.role === 'store_admin' ? (
            <>
              <div className="admin-sidebar-section">Management</div>
              <NavLink
                to="/stores"
                className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? 'My Store' : undefined}
              >
                <span className="nav-icon"><Store size={18} /></span>
                <span className="admin-nav-label">My Store</span>
              </NavLink>
            </>
          ) : (
            <>
              <div className="admin-sidebar-section">Main</div>
              {NAV_ITEMS.slice(0, 1).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="admin-nav-label">{item.label}</span>
                </NavLink>
              ))}

              <div className="admin-sidebar-section" style={{ marginTop: '0.5rem' }}>Content</div>
              {NAV_ITEMS.slice(1, 5).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="admin-nav-label">{item.label}</span>
                </NavLink>
              ))}

              {profile?.role === 'admin' && (
                <a
                  href="/map3d"
                  className="admin-nav-item"
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? '3D Calibration' : undefined}
                  style={{ display: 'none', color: '#c084fc' }}
                >
                  <span className="nav-icon"><Maximize2 size={18} /></span>
                  <span className="admin-nav-label">3D Calibration</span>
                </a>
              )}

              <div className="admin-sidebar-section" style={{ marginTop: '0.5rem' }}>Engagement</div>
              {NAV_ITEMS.slice(5).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="admin-nav-label">{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="admin-sidebar-footer">
          {/* Collapse toggle (desktop only) */}
          <button
            className="admin-nav-item"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <span className="nav-icon">
              <ChevronLeft
                size={18}
                style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}
              />
            </span>
            <span className="admin-nav-label">Collapse</span>
          </button>

          <button
            className="admin-nav-item"
            onClick={handleSignOut}
            id="admin-sign-out"
            style={{ marginTop: '0.1rem' }}
          >
            <span className="nav-icon"><LogOut size={18} /></span>
            <span className="admin-nav-label">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="admin-sidebar-overlay"
          style={{ display: 'block' }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Content area */}
      <div className="admin-content">
        {/* Topbar */}
        <header className="admin-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Mobile menu toggle */}
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
              style={{ display: 'none' }}
              id="admin-mobile-menu-btn"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <a href="/" className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.65rem', border: '1px solid var(--color-border)', fontSize: '0.8rem' }} id="admin-home-btn">
              <Home size={14} />
              Return Home
            </a>
            <style>{`
              @media (max-width: 768px) {
                #admin-mobile-menu-btn { display: flex !important; }
              }
            `}</style>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {profile?.name?.[0]?.toUpperCase() ?? 'A'}
            </div>
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{profile?.name ?? 'Admin'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>Administrator</div>
            </div>
          </div>
        </header>

        {/* Page content */}
        {children}
      </div>
    </div>
  );
}
