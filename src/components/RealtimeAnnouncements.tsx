import { useEffect, useState, useRef } from 'react';
import { Megaphone, X, Bell, AlertTriangle, AlertCircle, Check, Radio, Info } from 'lucide-react';
import { supabase, type Announcement } from '../lib/supabase';
import mainDarkBg from '../pics/main dark.png';

export function RealtimeAnnouncements() {
  const [activeToast, setActiveToast] = useState<Announcement | null>(null);
  const [emergencyAlert, setEmergencyAlert] = useState<Announcement | null>(null);
  const [history, setHistory] = useState<Announcement[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const unreadCountRef = useRef(unreadCount);

  // Sync ref with state
  useEffect(() => {
    unreadCountRef.current = unreadCount;
    window.dispatchEvent(new CustomEvent('announcements-unread-count', { detail: unreadCount }));
  }, [unreadCount]);

  useEffect(() => {
    fetchActiveAnnouncements();
    const unsubscribe = setupRealtimeSubscription();

    // Listen to open-history window events
    const handleOpenHistory = () => setIsHistoryOpen(true);
    window.addEventListener('open-announcements-history', handleOpenHistory);

    // Listen to query count requests
    const handleRequestCount = () => {
      window.dispatchEvent(new CustomEvent('announcements-unread-count', { detail: unreadCountRef.current }));
    };
    window.addEventListener('request-announcements-unread-count', handleRequestCount);

    // Request browser push permission
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }

    return () => {
      unsubscribe();
      window.removeEventListener('open-announcements-history', handleOpenHistory);
      window.removeEventListener('request-announcements-unread-count', handleRequestCount);
    };
  }, []);

  async function fetchActiveAnnouncements() {
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      const list = data || [];
      setHistory(list);
      setUnreadCount(list.length);
    } catch (err) {
      console.error('Error fetching initial announcements:', err);
    }
  }

  function setupRealtimeSubscription() {
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    // Use standardized topic to allow Supabase to efficiently broadcast without creating 500 unique channel topics
    const channel = supabase
      .channel('announcements-public-broadcast')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcements',
        },
        (payload) => {
          const eventType = payload.eventType;
          
          if (eventType === 'INSERT') {
            const newAnn = payload.new as Announcement;
            if (newAnn.is_active) {
              handleNewIncomingAnnouncement(newAnn);
            }
          } else if (eventType === 'UPDATE') {
            const updatedAnn = payload.new as Announcement;
            if (updatedAnn.is_active) {
              handleNewIncomingAnnouncement(updatedAnn);
            } else {
              // Remove deactivated ones from history list
              setHistory(prev => prev.filter(a => a.id !== updatedAnn.id));
            }
          } else if (eventType === 'DELETE') {
            const oldId = payload.old.id;
            setHistory(prev => prev.filter(a => a.id !== oldId));
          }
        }
      )
      .subscribe((status) => {
        // High traffic fallback: If WebSocket fails or hits quota, fall back to lightweight HTTP polling
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (!pollInterval) {
            pollInterval = setInterval(fetchActiveAnnouncements, 60_000);
          }
        }
      });

    // 90s safety interval for mobile background tabs
    const backgroundPoll = setInterval(fetchActiveAnnouncements, 90_000);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      clearInterval(backgroundPoll);
      supabase.removeChannel(channel);
    };
  }

  function handleNewIncomingAnnouncement(ann: Announcement) {
    // 1. Prepend to history lists
    setHistory((prev) => {
      // Avoid duplication if it was an update
      const filtered = prev.filter((a) => a.id !== ann.id);
      return [ann, ...filtered];
    });

    setUnreadCount((prev) => prev + 1);

    // 2. Browser native push notification
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(ann.title, {
        body: ann.message,
        icon: '/favicon.ico',
      });
    }

    // 3. UI Display triggers
    if (ann.type === 'emergency') {
      setEmergencyAlert(ann);
    } else {
      setActiveToast(ann);
      // Auto dismiss normal alerts after 7 seconds
      setTimeout(() => {
        setActiveToast((prev) => (prev?.id === ann.id ? null : prev));
      }, 7000);
    }
  }

  const handleMarkAllRead = () => {
    setUnreadCount(0);
  };

  return (
    <>
      {/* 1. Normal Corner Toast Banner Alert */}
      {activeToast && (
        <div
          className="glass"
          style={{
            position: 'fixed',
            bottom: 'calc(24px + var(--safe-bottom, 0px))',
            right: '12px',
            left: '12px',
            width: 'min(320px, calc(100vw - 24px))',
            marginLeft: 'auto',
            zIndex: 9999,
            padding: '1rem',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            borderLeft: `4px solid ${
              activeToast.type === 'warning' ? 'var(--color-warning)' : 'var(--color-primary)'
            }`,
            animation: 'toast-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              padding: '0.35rem',
              borderRadius: '6px',
              background: activeToast.type === 'warning' ? 'rgba(245,158,11,0.1)' : 'rgba(99,102,241,0.1)',
              color: activeToast.type === 'warning' ? 'var(--color-warning)' : 'var(--color-primary-h)',
            }}
          >
            {activeToast.type === 'warning' ? <AlertTriangle size={18} /> : <Megaphone size={18} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, margin: '0 0 0.15rem 0' }}>
              {activeToast.title}
            </h4>
            <p style={{ fontSize: '0.775rem', color: 'var(--color-muted)', margin: 0, lineHeight: 1.4 }}>
              {activeToast.message}
            </p>
          </div>
          <button
            onClick={() => setActiveToast(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: 0 }}
          >
            <X size={14} />
          </button>
          
          <style>{`
            @keyframes toast-slide-in {
              from { transform: translateY(40px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {/* 2. Full-Screen Takeover Emergency Alert */}
      {emergencyAlert && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(5, 7, 12, 0.95)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
          }}
        >
          <div
            className="glass"
            style={{
              width: '100%',
              maxWidth: '480px',
              padding: '2.25rem',
              borderRadius: '16px',
              textAlign: 'center',
              border: '2px solid #ef4444',
              boxShadow: '0 0 40px rgba(239,68,68,0.25)',
              animation: 'emergency-pulse 1.8s infinite alternate',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.25rem',
              }}
            >
              <AlertCircle size={32} />
            </div>
            
            <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#ef4444', margin: '0 0 0.5rem 0', letterSpacing: '-0.02em' }}>
              {emergencyAlert.title}
            </h2>
            
            <p style={{ fontSize: '0.925rem', color: '#fff', lineHeight: 1.6, margin: '0 0 2rem 0' }}>
              {emergencyAlert.message}
            </p>

            <button
              onClick={() => setEmergencyAlert(null)}
              className="btn"
              style={{
                background: '#ef4444',
                color: '#fff',
                fontWeight: 700,
                width: '100%',
                padding: '0.75rem',
                border: 'none',
                boxShadow: '0 4px 14px rgba(239,68,68,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <Check size={16} />
              I Acknowledge Alert
            </button>
          </div>

          <style>{`
            @keyframes emergency-pulse {
              from { border-color: rgba(239, 68, 68, 0.5); box-shadow: 0 0 20px rgba(239,68,68,0.1); }
              to { border-color: rgba(239, 68, 68, 1); box-shadow: 0 0 40px rgba(239,68,68,0.3); }
            }
          `}</style>
        </div>
      )}

      {/* 3. History Drawer / Modal Overlay */}
      {isHistoryOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9998,
            background: 'rgba(5, 7, 12, 0.72)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            justifyContent: 'flex-end',
            animation: 'drawer-fade-in 0.2s ease-out',
          }}
          onClick={() => setIsHistoryOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
              height: '100%',
              maxHeight: '100dvh',
              position: 'relative',
              boxShadow: '-16px 0 48px rgba(0, 0, 0, 0.85)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              padding: '1.25rem',
              paddingBottom: 'calc(1.25rem + var(--safe-bottom, 0px))',
              paddingTop: 'calc(1.25rem + var(--safe-top, 0px))',
              overflow: 'hidden',
              backgroundColor: '#070a14',
              animation: 'drawer-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Blurred Background Image: main dark.png */}
            <div
              style={{
                position: 'absolute',
                inset: -20,
                backgroundImage: `url(${mainDarkBg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'right top',
                backgroundRepeat: 'no-repeat',
                filter: 'blur(9px)',
                transform: 'scale(1.06)',
                pointerEvents: 'none',
                zIndex: 0,
                opacity: 0.9,
              }}
            />

            {/* Dark Mask layer over blurred image to ensure maximum readability */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(180deg, rgba(8, 12, 22, 0.42) 0%, rgba(6, 9, 18, 0.68) 100%)',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />

            {/* Content Container (elevated above background for maximum legibility) */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1rem',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingBottom: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '10px',
                      background: 'rgba(99, 102, 241, 0.14)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--color-primary-h)',
                    }}
                  >
                    <Bell size={18} />
                  </div>
                  <div>
                    <h3
                      style={{
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        margin: 0,
                        color: '#f8fafc',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                      }}
                    >
                      Announcements
                      {unreadCount > 0 && (
                        <span
                          style={{
                            fontSize: '0.62rem',
                            fontWeight: 800,
                            padding: '0.1rem 0.4rem',
                            borderRadius: '999px',
                            background: '#ef4444',
                            color: '#fff',
                          }}
                        >
                          {unreadCount}
                        </span>
                      )}
                    </h3>
                    <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.74rem', color: 'var(--color-muted)' }}>
                      Live exhibition updates &amp; alerts
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsHistoryOpen(false)}
                  className="btn btn-ghost btn-sm btn-icon"
                  title="Close announcements"
                  style={{
                    borderRadius: '50%',
                    width: 32,
                    height: 32,
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-muted)',
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Actions list */}
              {history.length > 0 && unreadCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                  <button
                    onClick={handleMarkAllRead}
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '0.25rem 0.6rem',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#38bdf8',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    }}
                  >
                    <Check size={12} />
                    Mark all as read
                  </button>
                </div>
              )}

              {/* History Feed list */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                  paddingRight: '0.25rem',
                }}
              >
                {history.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--color-muted)' }}>
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: '14px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '0.75rem',
                        color: 'var(--color-muted)',
                      }}
                    >
                      <Megaphone size={24} />
                    </div>
                    <p style={{ fontSize: '0.86rem', fontWeight: 600, color: '#f8fafc', margin: '0 0 0.2rem 0' }}>
                      No announcements yet
                    </p>
                    <p style={{ fontSize: '0.76rem', margin: 0 }}>
                      Live broadcasts and exhibition notices will appear here.
                    </p>
                  </div>
                ) : (
                  history.map((ann, index) => {
                    let accentColor = '#38bdf8';
                    let typeLabel = 'Notice';
                    let IconComponent = Info;

                    if (ann.type === 'warning') {
                      accentColor = '#f59e0b';
                      typeLabel = 'Warning';
                      IconComponent = AlertTriangle;
                    } else if (ann.type === 'emergency') {
                      accentColor = '#ef4444';
                      typeLabel = 'Alert';
                      IconComponent = AlertCircle;
                    } else if (ann.type === 'broadcast') {
                      accentColor = '#a855f7';
                      typeLabel = 'Broadcast';
                      IconComponent = Radio;
                    }

                    return (
                      <div
                        key={ann.id}
                        className="announcement-glass-card"
                        style={{
                          background: 'rgba(12, 17, 32, 0.68)',
                          backdropFilter: 'blur(16px)',
                          WebkitBackdropFilter: 'blur(16px)',
                          border: '1px solid rgba(255, 255, 255, 0.11)',
                          borderRadius: '14px',
                          padding: '0.9rem 1.05rem',
                          position: 'relative',
                          boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
                          animation: 'announcement-card-slide-in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both',
                          animationDelay: `${index * 0.08 + 0.12}s`,
                          transition: 'background 0.2s ease, border-color 0.2s ease, transform 0.2s ease',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.5rem',
                            marginBottom: '0.25rem',
                          }}
                        >
                          <h4
                            style={{
                              fontSize: '0.88rem',
                              fontWeight: 750,
                              color: ann.type === 'emergency' ? '#f87171' : '#f8fafc',
                              margin: 0,
                              lineHeight: 1.3,
                            }}
                          >
                            {ann.title}
                          </h4>
                          <span
                            style={{
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              padding: '0.1rem 0.35rem',
                              borderRadius: '4px',
                              background: `${accentColor}18`,
                              color: accentColor,
                              border: `1px solid ${accentColor}30`,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              flexShrink: 0,
                            }}
                          >
                            <IconComponent size={10} />
                            {typeLabel}
                          </span>
                        </div>

                        <p
                          style={{
                            fontSize: '0.84rem',
                            color: '#f1f5f9',
                            margin: '0.25rem 0 0 0',
                            lineHeight: 1.5,
                            wordBreak: 'break-word',
                          }}
                        >
                          {ann.message}
                        </p>

                        <span
                          style={{
                            display: 'block',
                            fontSize: '0.65rem',
                            color: '#94a3b8',
                            marginTop: '0.45rem',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                          }}
                        >
                          {new Date(ann.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <style>{`
            @keyframes drawer-fade-in {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes drawer-slide-in {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
            @keyframes announcement-card-slide-in {
              from {
                opacity: 0;
                transform: translateX(-32px);
              }
              to {
                opacity: 1;
                transform: translateX(0);
              }
            }
            .announcement-glass-card:hover {
              background: rgba(18, 25, 46, 0.8) !important;
              border-color: rgba(255, 255, 255, 0.18) !important;
              transform: translateX(3px) !important;
              box-shadow: 0 10px 28px -3px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
            }
          `}</style>
        </div>
      )}
    </>
  );
}
