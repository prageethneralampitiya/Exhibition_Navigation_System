import { useEffect, useState, useRef } from 'react';
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
  Sparkles,
  Clock,
  TrendingUp,
  ChevronRight,
  Shield,
  GraduationCap,
  Radio,
  VolumeX,
  PhoneCall,
  Video,
  Megaphone,
} from 'lucide-react';
import { supabase, type Exhibition, type Store as StoreType } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GPSPermissionBanner } from '../components/GPSPermissionBanner';
import { useLiveBroadcast } from '../contexts/LiveBroadcastContext';
import invexLogo from '../pics/logo.png';
import { SiteFooter } from '../components/SiteFooter';
import { EmergencyContactsModal } from '../components/EmergencyContactsModal';
import { VideoLivesModal } from '../components/VideoLivesModal';

// ── Customizable Placeholder Exhibition Slots ───────────────────────
// You can edit titles, locations, dates, or accent colors anytime.
// Once you add real exhibitions in Admin, they will seamlessly appear alongside these!
export interface PlaceholderExhibition {
  id: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string;
  is_featured: boolean;
  tag: string;
  accentColor: string;
  isPlaceholder: true;
}

export interface RealExhibitionItem extends Exhibition {
  isPlaceholder: false;
}

export type CarouselExhibitionItem = PlaceholderExhibition | RealExhibitionItem;

const placeholderExhibitions: PlaceholderExhibition[] = [
  {
    id: 'placeholder-ai-summit',
    title: 'AI & Robotics Summit',
    location: 'Hall B · Tech Arena',
    start_date: '2026-07-17',
    end_date: '2026-07-18',
    is_featured: true,
    tag: 'Upcoming',
    accentColor: '#8b5cf6',
    isPlaceholder: true,
  },
  {
    id: 'placeholder-green-tech',
    title: 'Green Tech & Clean Energy',
    location: 'Hall C · Eco Pavilion',
    start_date: '2026-07-19',
    end_date: '2026-07-20',
    is_featured: false,
    tag: 'Slot Ready',
    accentColor: '#10b981',
    isPlaceholder: true,
  },
  {
    id: 'placeholder-cyber-expo',
    title: 'Cyber Security & Cloud Summit',
    location: 'Innovation Wing · Level 2',
    start_date: '2026-07-21',
    end_date: '2026-07-22',
    is_featured: false,
    tag: 'Upcoming',
    accentColor: '#38bdf8',
    isPlaceholder: true,
  },
  {
    id: 'placeholder-mobility-ev',
    title: 'NextGen Mobility & EV Expo',
    location: 'Hall D · Main Stage',
    start_date: '2026-07-23',
    end_date: '2026-07-24',
    is_featured: true,
    tag: 'Slot Ready',
    accentColor: '#f59e0b',
    isPlaceholder: true,
  },
];

function useCarouselScroller(speed = 0.5) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isInteractingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollStartRef = useRef(0);
  const resumeTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      const delta = (currentTime - lastTime) / 16.67;
      lastTime = currentTime;

      const el = containerRef.current;
      if (el && !isInteractingRef.current && !isDraggingRef.current) {
        el.scrollLeft += speed * delta;
        // Seamless loop back to start
        if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 2) {
          el.scrollLeft = 1;
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [speed]);

  const pauseAndResume = () => {
    isInteractingRef.current = true;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      isInteractingRef.current = false;
    }, 2800);
  };

  const scroll = (direction: 'left' | 'right') => {
    pauseAndResume();
    const el = containerRef.current;
    if (!el) return;
    const distance = Math.max(el.clientWidth * 0.7, 260);
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    isDraggingRef.current = true;
    startXRef.current = e.pageX - el.offsetLeft;
    scrollStartRef.current = el.scrollLeft;
    pauseAndResume();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startXRef.current) * 1.4;
    el.scrollLeft = scrollStartRef.current - walk;
  };

  const onMouseUp = () => {
    isDraggingRef.current = false;
  };

  return {
    ref: containerRef,
    scroll,
    handlers: {
      onMouseEnter: () => { isInteractingRef.current = true; },
      onMouseLeave: () => { isInteractingRef.current = false; isDraggingRef.current = false; },
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onTouchStart: pauseAndResume,
      onWheel: pauseAndResume,
    },
  };
}

export function HomePage() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { activeBroadcast, isPlaying, handleListen, handleMute } = useLiveBroadcast();

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals for new buttons
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [isVideoLivesModalOpen, setIsVideoLivesModalOpen] = useState(false);

  // Interactive auto-scrolling & manually scrollable carousels
  const featuredCarousel = useCarouselScroller(0.48);
  const storesCarousel = useCarouselScroller(0.48);

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

  // ── Scroll Reveal Intersection Observer ─────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in-view');
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    const elements = document.querySelectorAll('.scroll-reveal');
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [loading, exhibitions, stores]);

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
    <div className="home-wrapper">
      {/* Main Page Content */}
      <div className="profile-page home-enhanced" style={{ maxWidth: 880, paddingBottom: '4rem', paddingTop: '2.5rem' }}>
        <GPSPermissionBanner inFlow />

        {/* ── Centered Logo in Middle of Front Page ─────────── */}
        <div className="home-hero-center">
          <img 
            src={invexLogo} 
            alt="INVEX 2026 Logo" 
            className="home-hero-logo"
          />
        </div>

        {/* ── Hero Welcome Greeting ────────────────────────── */}
        <div className="home-welcome-banner">
          <span className="home-welcome-line1">{getGreeting()},</span>
          <span className="home-welcome-line2">
            {profile?.name?.split(' ')[0] || 'Visitor'} <span className="home-welcome-wave">👋</span>
          </span>
        </div>

        {/* ── Interactive Floor Map Bar ─────────────────────── */}
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
              marginBottom: '1.25rem',
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

        {/* ── Box Under Logo Holding Nav & Utility Items ────── */}
        <div className="home-action-box glass">
          {/* Navigation Links */}
          <div className="home-action-box-links">
            {/* 1. Floor Map changed to Emergancy Contacts */}
            <button
              type="button"
              onClick={() => setIsEmergencyModalOpen(true)}
              className="home-box-link link-emergency"
              id="nav-emergency-contacts"
              title="Emergency Contacts & Hotlines"
            >
              <div className="home-box-link-icon icon-emergency">
                <PhoneCall size={22} strokeWidth={2.2} />
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Emergancy Contacts</span>
                <span className="home-box-link-desc">Hotlines</span>
              </div>
            </button>

            {/* 2. 3D Campus replaced with Broadcast */}
            <button
              type="button"
              onClick={() => {
                if (activeBroadcast) {
                  if (isPlaying) {
                    handleMute();
                  } else {
                    handleListen();
                  }
                } else {
                  handleOpenAnnouncements();
                }
              }}
              className={`home-box-link link-broadcast ${isPlaying ? 'is-playing' : ''}`}
              id="nav-broadcast"
              title={activeBroadcast ? (isPlaying ? 'Mute live voice broadcast' : 'Listen to live voice broadcast') : 'Live Voice Broadcast'}
            >
              <div className="home-box-link-icon icon-broadcast" style={{ position: 'relative' }}>
                {isPlaying ? <VolumeX size={22} strokeWidth={2.2} /> : <Radio size={22} strokeWidth={2.2} />}
                {activeBroadcast && (
                  <span
                    className="live-dot-pulse"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#ef4444',
                    }}
                  />
                )}
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Broadcast</span>
                <span className="home-box-link-desc">
                  {isPlaying ? 'Live Audio' : activeBroadcast ? 'On Air' : 'Voice Stream'}
                </span>
              </div>
            </button>

            {/* 3. Event replaced with Video Lives */}
            <button
              type="button"
              onClick={() => setIsVideoLivesModalOpen(true)}
              className="home-box-link link-videolives"
              id="nav-video-lives"
              title="Live Video Streams (YouTube & Facebook)"
            >
              <div className="home-box-link-icon icon-videolives">
                <Video size={22} strokeWidth={2.2} />
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Video Lives</span>
                <span className="home-box-link-desc">YouTube &amp; FB</span>
              </div>
            </button>

            {/* 4. Stalls replaced with Announcement */}
            <button
              type="button"
              onClick={handleOpenAnnouncements}
              className="home-box-link link-announcements"
              id="nav-announcements"
              title="Exhibition Announcements & Alerts"
            >
              <div className="home-box-link-icon icon-announcements" style={{ position: 'relative' }}>
                <Megaphone size={22} strokeWidth={2.2} />
                {unreadNotifications > 0 && (
                  <span
                    className="notification-dot"
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      background: '#ef4444',
                      color: '#fff',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px',
                      border: '2px solid rgba(13, 16, 28, 0.9)',
                    }}
                  >
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </span>
                )}
              </div>
              <div className="home-box-link-text">
                <span className="home-box-link-title">Announcement</span>
                <span className="home-box-link-desc">
                  {unreadNotifications > 0 ? `${unreadNotifications} Unread` : 'Live Alerts'}
                </span>
              </div>
            </button>
          </div>

          {/* User Profile / Admin controls (Search, Bell, Broadcast, and Sign In buttons hidden) */}
          {user && (
            <>
              <div className="home-action-box-divider" />
              <div className="home-action-box-bottom">
                <div className="home-action-box-buttons" style={{ justifyContent: 'center' }}>
                  <Link to="/profile" className="btn btn-ghost btn-sm navbar-action-btn" id="nav-profile-btn" title="My Profile">
                    <User size={14} />
                    <span>Profile</span>
                  </Link>
                  {profile?.role === 'admin' && (
                    <a href="/admin/" className="btn btn-ghost btn-sm navbar-admin-btn" id="nav-admin-btn" title="Admin Portal">
                      <Shield size={14} />
                      <span>Admin</span>
                    </a>
                  )}
                  <button className="btn btn-danger btn-sm navbar-signout-btn" onClick={handleSignOut} id="nav-signout-btn" title="Sign Out">
                    <LogOut size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

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

        {/* ── Transition Bridge to Lower Discovery Section ─────── */}
        <div className="home-section-transition scroll-reveal">
          <div className="home-transition-beam" />
        </div>

        {/* ── Main Content Grid ───────────────────────────────── */}
        <div className="home-content-grid">

          {/* ── Featured Exhibitions ─────────────────────────── */}
          <section className="home-content-block home-content-block-purple scroll-reveal">
            <div className="home-content-block-glow" />
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <div className="home-section-icon home-section-icon-purple">
                  <CalendarDays size={18} color="#fff" />
                </div>
                <div>
                  <h2 className="home-section-title">Featured Exhibitions</h2>
                  <p className="home-section-sub">Ongoing events &amp; summits near you</p>
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
            ) : (
              <div
                ref={featuredCarousel.ref}
                className="home-ex-carousel-viewport"
                {...featuredCarousel.handlers}
              >
                <div className="home-ex-carousel-track">
                  {(
                    [
                      ...exhibitions.map((ex): RealExhibitionItem => ({ ...ex, isPlaceholder: false })),
                      ...placeholderExhibitions,
                      ...exhibitions.map((ex): RealExhibitionItem => ({ ...ex, isPlaceholder: false })),
                      ...placeholderExhibitions,
                    ] as CarouselExhibitionItem[]
                  ).map((item, index) =>
                    item.isPlaceholder ? (
                      /* Customizable Placeholder Card */
                      <div
                        key={`ph-${item.id}-${index}`}
                        className="home-ex-card home-ex-card-placeholder"
                        title="Customizable Exhibition Slot — Change or add details anytime"
                      >
                        <div
                          className="home-ex-thumb home-ex-thumb-placeholder-banner"
                          style={{
                            background: `radial-gradient(circle at 50% 30%, ${item.accentColor}30 0%, rgba(13, 17, 30, 0.92) 100%)`,
                          }}
                        >
                          <div className="home-ex-thumb-placeholder-icon" style={{ color: item.accentColor }}>
                            <Sparkles size={24} />
                          </div>
                          <span
                            className="home-ex-featured-badge home-ex-placeholder-badge"
                            style={{
                              borderColor: `${item.accentColor}40`,
                              color: '#fff',
                            }}
                          >
                            <Clock size={9} /> {item.tag}
                          </span>
                        </div>

                        <div className="home-ex-details">
                          <h3 className="home-ex-title">{item.title}</h3>
                          <span className="home-ex-location">
                            <MapPin size={11} />
                            {item.location}
                          </span>
                          <span className="home-ex-dates">
                            <Clock size={11} />
                            {item.start_date} – {item.end_date}
                          </span>
                        </div>

                        <div className="home-ex-arrow">
                          <ChevronRight size={14} />
                        </div>
                      </div>
                    ) : (
                      /* Real Exhibition Card */
                      <Link
                        key={`real-${item.id}-${index}`}
                        to={`/exhibitions/${item.id}`}
                        className="home-ex-card"
                        id={`home-ex-card-${item.id}-${index}`}
                      >
                        <div className="home-ex-thumb">
                          {item.image_url ? (
                            <img src={item.image_url} alt={item.title} className="home-ex-thumb-img" />
                          ) : (
                            <div className="home-ex-thumb-placeholder">
                              <CalendarDays size={24} color="rgba(255,255,255,0.4)" />
                            </div>
                          )}
                          {item.is_featured && (
                            <span className="home-ex-featured-badge">
                              <Star size={9} fill="currentColor" /> Featured
                            </span>
                          )}
                        </div>

                        <div className="home-ex-details">
                          <h3 className="home-ex-title">{item.title}</h3>
                          <span className="home-ex-location">
                            <MapPin size={11} />
                            {item.location || 'Exhibition Area'}
                          </span>
                          {(item.start_date || item.end_date) && (
                            <span className="home-ex-dates">
                              <Clock size={11} />
                              {item.start_date || '?'} – {item.end_date || '?'}
                            </span>
                          )}
                        </div>

                        <div className="home-ex-arrow">
                          <ChevronRight size={14} />
                        </div>
                      </Link>
                    )
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ── Participant Exhibitors (Stores) ──────────────── */}
          <section className="home-content-block home-content-block-cyan scroll-reveal">
            <div className="home-content-block-glow" />
            <div className="home-section-header">
              <div className="home-section-title-wrap">
                <div className="home-section-icon home-section-icon-cyan">
                  <Store size={18} color="#fff" />
                </div>
                <div>
                  <h2 className="home-section-title">Participant Exhibitors</h2>
                  <p className="home-section-sub">Browse booths, stalls &amp; brand partners</p>
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
              <div
                ref={storesCarousel.ref}
                className="home-stores-carousel-viewport"
                {...storesCarousel.handlers}
              >
                <div className="home-stores-carousel-track">
                  {(
                    stores.length < 5
                      ? [...stores, ...stores, ...stores, ...stores]
                      : [...stores, ...stores]
                  ).map((st, index) => (
                    <Link
                      key={`st-${st.id}-${index}`}
                      to={`/stores/${st.id}`}
                      className="home-store-carousel-card"
                      id={`home-store-card-${st.id}-${index}`}
                      style={{
                        '--store-cat-color': st.categories?.color || 'var(--color-primary)',
                      } as React.CSSProperties}
                    >
                      {/* Top colored accent indicator */}
                      <div
                        className="home-store-accent"
                        style={{ background: st.categories?.color || 'var(--color-primary)' }}
                      />

                      {/* Store Logo */}
                      <div className="home-store-carousel-logo">
                        {st.logo_url ? (
                          <img src={st.logo_url} alt={st.name} />
                        ) : (
                          <Store size={24} color={st.categories?.color || 'var(--color-primary)'} />
                        )}
                      </div>

                      {/* Store Name */}
                      <h3 className="home-store-carousel-name">{st.name}</h3>

                      {/* Meta location */}
                      <span className="home-store-carousel-meta">
                        <MapPin size={11} /> Floor {st.floor || '1'}
                      </span>

                      {/* Category Chip */}
                      {st.categories && (
                        <span
                          className="home-store-cat-chip"
                          style={{
                            marginTop: '0.6rem',
                            background: `${st.categories.color}20`,
                            color: st.categories.color || 'var(--color-primary-h)',
                            borderColor: `${st.categories.color}40`,
                            fontSize: '0.72rem',
                          }}
                        >
                          {st.categories.name}
                        </span>
                      )}

                      {/* Promotion Sparkle */}
                      {(st.phone || st.website) && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 10,
                            right: 10,
                            color: 'var(--color-warning)',
                          }}
                        >
                          <Sparkles size={13} />
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

        </div>
      </div>

      {/* Emergency Contacts Modal */}
      <EmergencyContactsModal
        isOpen={isEmergencyModalOpen}
        onClose={() => setIsEmergencyModalOpen(false)}
      />

      {/* Video Lives Modal */}
      <VideoLivesModal
        isOpen={isVideoLivesModalOpen}
        onClose={() => setIsVideoLivesModalOpen(false)}
      />

      {/* Contact & Partner Information Ribbon Footer */}
      <SiteFooter />
    </div>
  );
}
