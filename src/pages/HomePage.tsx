import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MapPin,
  Navigation,
  User,
  Store,
  LogOut,
  CalendarDays,
  ArrowRight,
  Star,
  Search,
  Bell,
  Sparkles,
  Clock,
  TrendingUp,
  ChevronRight,
  Shield,
  GraduationCap,
  Radio,
  VolumeX,
} from 'lucide-react';
import { supabase, type Exhibition, type Store as StoreType } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GPSPermissionBanner } from '../components/GPSPermissionBanner';
import { useLiveBroadcast } from '../contexts/LiveBroadcastContext';

export function HomePage() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { activeBroadcast, isPlaying, handleListen, handleMute } = useLiveBroadcast();

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleUnread = (e: Event) => {
      setUnreadNotifications((e as CustomEvent).detail);
    };
    window.addEventListener('announcements-unread-count', handleUnread);
    window.dispatchEvent(new CustomEvent('request-announcements-unread-count'));

    return () => {
      window.removeEventListener('announcements-unread-count', handleUnread);
    };
  }, []);

  const handleOpenAnnouncements = () => {
    window.dispatchEvent(new CustomEvent('open-announcements-history'));
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    try {
      setLoading(true);
      const [exhibitionsRes, storesRes] = await Promise.all([
        supabase
          .from('exhibitions')
          .select('*')
          .eq('is_active', true)
          .order('is_featured', { ascending: false })
          .limit(4),
        supabase
          .from('stores')
          .select(`
            *,
            categories:category_id (id, name, color),
            exhibitions:exhibition_id (id, title)
          `)
          .eq('is_active', true)
          .limit(6),
      ]);

      setExhibitions(exhibitionsRes.data || []);
      setStores(storesRes.data || []);
    } catch (err) {
      console.error('Error loading homepage dashboard resources:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className="profile-page home-enhanced" style={{ maxWidth: 880, paddingBottom: '4rem' }}>
      <GPSPermissionBanner inFlow />

        {/* ── Premium Header ─────────────────────────────────── */}
        <header className="home-header-enhanced">
          {/* Animated background orbs */}
          <div className="home-header-orb home-header-orb-1" />
          <div className="home-header-orb home-header-orb-2" />

          <div className="home-header-left">
            <div className="brand-icon home-brand-icon">
              <MapPin size={26} color="#fff" />
            </div>
            <div>
              <p className="home-greeting">{getGreeting()}, {profile?.name?.split(' ')[0] || 'Visitor'} 👋</p>
              <h1 className="home-title">Exhibition Navigator</h1>
              <p className="home-subtitle">Explore booths, discover promotions, and navigate in real time.</p>
            </div>
          </div>

          <div className="home-header-actions">
            <Link to="/search" className="btn btn-ghost btn-sm home-action-btn" id="home-search-btn">
              <Search size={14} />
              Search
            </Link>
            <button
              onClick={handleOpenAnnouncements}
              className="btn btn-ghost btn-sm btn-icon home-bell-btn"
              title="View Announcements"
              id="home-announcements-btn"
            >
              <Bell size={16} />
              {unreadNotifications > 0 && (
                <span className="notification-dot">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>

            {/* Live Audio / Broadcast Button — only when broadcast is active */}
            {activeBroadcast && (
              <button
                id="home-live-audio-btn"
                onClick={isPlaying ? handleMute : handleListen}
                className="btn btn-ghost btn-sm home-action-btn"
                title={isPlaying ? 'Mute broadcast' : 'Listen to broadcast'}
                style={{
                  position: 'relative',
                  border: isPlaying
                    ? '1px solid rgba(239, 68, 68, 0.5)'
                    : '1px solid rgba(99, 102, 241, 0.3)',
                  color: isPlaying ? '#f87171' : 'var(--color-primary-light, #818cf8)',
                  background: isPlaying ? 'rgba(239, 68, 68, 0.12)' : 'rgba(99, 102, 241, 0.08)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontWeight: 600,
                  transition: 'all 0.2s ease',
                }}
              >
                {isPlaying ? <VolumeX size={14} /> : <Radio size={14} />}
                <span>Broadcast</span>
                {isPlaying && (
                  <span
                    className="live-dot-pulse"
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      backgroundColor: '#ef4444',
                      display: 'inline-block',
                      marginLeft: '2px',
                    }}
                  />
                )}
              </button>
            )}
            {user ? (
              <>
                <Link to="/profile" className="btn btn-ghost btn-sm home-action-btn" id="home-profile-btn">
                  <User size={14} />
                  Profile
                </Link>
                {profile?.role === 'admin' && (
                  <a href="/admin/" className="btn btn-ghost btn-sm home-action-btn" style={{ border: '1px dashed var(--color-warning)', color: 'var(--color-warning)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} id="home-admin-btn">
                    <Shield size={14} />
                    Admin
                  </a>
                )}
                <button className="btn btn-danger btn-sm" onClick={handleSignOut} id="home-signout-btn">
                  <LogOut size={14} />
                  Out
                </button>
              </>
            ) : null}
          </div>
        </header>

        {/* ── Store Admin Panel Banner ─────────────────────────── */}
        {profile?.role === 'store_admin' && (
          <section
            id="store-admin-banner"
            style={{
              background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(168,85,247,0.15) 100%)',
              border: '1px solid rgba(99,102,241,0.35)',
              borderRadius: 16,
              padding: '1.25rem 1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              marginBottom: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Store size={22} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text)' }}>
                  Store Administrator
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: 2 }}>
                  You have store management access. Design and manage your store.
                </div>
              </div>
            </div>
            <a
              href="/admin/stores"
              id="home-manage-store-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.55rem 1.1rem',
                borderRadius: 10,
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.85rem',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
                transition: 'opacity 0.2s',
              }}
            >
              <Store size={15} />
              Manage My Store
            </a>
          </section>
        )}

        <section className="home-map-cta-enhanced">
          <div className="home-map-cta-glow" />
          <div className="home-map-cta-content">
            <div className="home-map-cta-icon">
              <Navigation size={22} color="#fff" style={{ transform: 'rotate(45deg)' }} />
            </div>
            <div>
              <h2 className="home-map-cta-title">Interactive Floor Map</h2>
              <p className="home-map-cta-desc">
                Live GPS tracking · Route planning · Real-time booth locations
              </p>
            </div>
          </div>
          <Link to="/map" className="btn btn-primary home-map-cta-btn" id="home-open-map-btn">
            Open Map
            <ArrowRight size={15} />
          </Link>
          {/* 3D School button hidden from UI, preserved in codebase */}
          <Link
            to="/map3d"
            id="home-open-3d-btn"
            style={{
              display: 'none',
              alignItems: 'center', gap: '0.4rem',
              padding: '0.6rem 1.1rem', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem',
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              color: '#fff', textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(99,102,241,0.45)',
              border: 'none', whiteSpace: 'nowrap',
            }}
          >
            <GraduationCap size={16} />
            3D School
          </Link>
        </section>

        {/* ── Stats Bar ──────────────────────────────────────── */}
        <div className="home-stats-bar">
          <div className="home-stat-chip">
            <TrendingUp size={14} />
            <span>{loading ? '—' : exhibitions.length} Active Events</span>
          </div>
          <div className="home-stat-divider" />
          <div className="home-stat-chip">
            <Store size={14} />
            <span>{loading ? '—' : stores.length} Exhibitors</span>
          </div>
          <div className="home-stat-divider" />
          <div className="home-stat-chip">
            <MapPin size={14} />
            <span>Live Navigation</span>
          </div>
        </div>

        {/* ── Main Content Grid ───────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2.5rem' }}>

          {/* ── Featured Exhibitions ─────────────────────────── */}
          <section>
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <div className="home-section-icon home-section-icon-purple">
                  <CalendarDays size={16} color="#fff" />
                </div>
                <div>
                  <h2 className="home-section-title">Featured Exhibitions</h2>
                  <p className="home-section-sub">Ongoing events & summits near you</p>
                </div>
              </div>
              <Link to="/exhibitions" className="home-view-all-link" id="home-view-all-exhibitions">
                View All <ChevronRight size={14} />
              </Link>
            </div>

            {loading ? (
              <div className="home-exhibitions-grid">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="glass skeleton home-ex-skeleton" />
                ))}
              </div>
            ) : exhibitions.length === 0 ? (
              <div className="home-empty-state">
                <CalendarDays size={32} style={{ opacity: 0.35 }} />
                <p>No active exhibitions right now.</p>
              </div>
            ) : (
              <div className="home-exhibitions-grid">
                {exhibitions.map((ex) => (
                  <Link
                    key={ex.id}
                    to={`/exhibitions/${ex.id}`}
                    className="home-ex-card"
                    id={`home-ex-card-${ex.id}`}
                  >
                    {/* Thumbnail / Image */}
                    <div className="home-ex-thumb">
                      {ex.image_url ? (
                        <img src={ex.image_url} alt={ex.title} className="home-ex-thumb-img" />
                      ) : (
                        <div className="home-ex-thumb-placeholder">
                          <CalendarDays size={24} color="rgba(255,255,255,0.4)" />
                        </div>
                      )}
                      {ex.is_featured && (
                        <span className="home-ex-featured-badge">
                          <Star size={9} fill="currentColor" /> Featured
                        </span>
                      )}
                    </div>

                    {/* Details */}
                    <div className="home-ex-details">
                      <h3 className="home-ex-title">{ex.title}</h3>
                      <span className="home-ex-location">
                        <MapPin size={11} />
                        {ex.location || 'Exhibition Area'}
                      </span>
                      {(ex.start_date || ex.end_date) && (
                        <span className="home-ex-dates">
                          <Clock size={11} />
                          {ex.start_date || '?'} – {ex.end_date || '?'}
                        </span>
                      )}
                    </div>

                    <div className="home-ex-arrow">
                      <ChevronRight size={14} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* ── Participant Exhibitors (Stores) ──────────────── */}
          <section>
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <div className="home-section-icon home-section-icon-cyan">
                  <Store size={16} color="#fff" />
                </div>
                <div>
                  <h2 className="home-section-title">Participant Exhibitors</h2>
                  <p className="home-section-sub">Browse booths, stalls & brand partners</p>
                </div>
              </div>
              <Link to="/stores" className="home-view-all-link" id="home-view-all-stores">
                View All <ChevronRight size={14} />
              </Link>
            </div>

            {loading ? (
              <div className="home-stores-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="glass skeleton home-store-skeleton" />
                ))}
              </div>
            ) : stores.length === 0 ? (
              <div className="home-empty-state">
                <Store size={32} style={{ opacity: 0.35 }} />
                <p>No active exhibitors found.</p>
              </div>
            ) : (
              <div className="home-stores-grid">
                {stores.map((st) => (
                  <Link
                    key={st.id}
                    to={`/stores/${st.id}`}
                    className="home-store-card"
                    id={`home-store-card-${st.id}`}
                    style={{
                      '--store-cat-color': st.categories?.color || 'var(--color-primary)',
                    } as React.CSSProperties}
                  >
                    {/* Category color accent bar */}
                    <div
                      className="home-store-accent"
                      style={{ background: st.categories?.color || 'var(--color-primary)' }}
                    />

                    {/* Logo */}
                    <div className="home-store-logo-wrap">
                      {st.logo_url ? (
                        <img src={st.logo_url} alt={st.name} className="home-store-logo" />
                      ) : (
                        <div className="home-store-logo-placeholder">
                          <Store size={18} color="var(--color-muted)" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="home-store-info">
                      <h3 className="home-store-name">{st.name}</h3>
                      <span className="home-store-meta">
                        Floor {st.floor || '1'}
                        {st.categories ? ` · ${st.categories.name}` : ''}
                      </span>
                    </div>

                    {/* Category chip */}
                    {st.categories && (
                      <span
                        className="home-store-cat-chip"
                        style={{
                          background: `${st.categories.color}20`,
                          color: st.categories.color || 'var(--color-primary-h)',
                          borderColor: `${st.categories.color}40`,
                        }}
                      >
                        {st.categories.name}
                      </span>
                    )}

                    {/* Promo star */}
                    {(st.phone || st.website) && (
                      <Sparkles size={13} className="home-store-sparkle" color="var(--color-warning)" />
                    )}
                  </Link>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>
  );
}
