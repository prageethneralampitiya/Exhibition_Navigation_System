import { useEffect, useState, useRef } from 'react';
import { Megaphone, X, Bell, AlertTriangle, AlertCircle, Check } from 'lucide-react';
import { supabase, type Announcement } from '../lib/supabase';

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
            background: 'rgba(5, 7, 12, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            justifyContent: 'flex-end',
            animation: 'drawer-fade-in 0.2s ease-out',
          }}
          onClick={() => setIsHistoryOpen(false)}
        >
          <div
            className="glass"
            style={{
              width: '100%',
              maxWidth: '380px',
              height: '100%',
              maxHeight: '100dvh',
              background: 'var(--color-bg)',
              boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              padding: '1.5rem',
              paddingBottom: 'calc(1.5rem + var(--safe-bottom, 0px))',
              paddingTop: 'calc(1.5rem + var(--safe-top, 0px))',
              animation: 'drawer-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Bell size={18} color="var(--color-primary-h)" />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0 }}>Announcements</h3>
              </div>
              <button
                onClick={() => setIsHistoryOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Actions list */}
            {history.length > 0 && unreadCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <button
                  onClick={handleMarkAllRead}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.725rem', padding: '0.2rem 0.5rem' }}
                >
                  Mark all as read
                </button>
              </div>
            )}

            {/* History Feed list */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
              {history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-muted)' }}>
                  <Megaphone size={28} style={{ margin: '0 auto 0.75rem auto', opacity: 0.5 }} />
                  <p style={{ fontSize: '0.85rem' }}>No announcements broadcasted yet.</p>
                </div>
              ) : (
                history.map((ann) => {
                  let badgeColor = 'var(--color-primary)';
                  if (ann.type === 'warning') badgeColor = 'var(--color-warning)';
                  if (ann.type === 'emergency') badgeColor = '#ef4444';

                  return (
                    <div
                      key={ann.id}
                      style={{
                        background: 'rgba(255,255,255,0.015)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                        padding: '0.875rem',
                        position: 'relative',
                        borderLeft: `3px solid ${badgeColor}`,
                      }}
                    >
                      <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: ann.type === 'emergency' ? '#ef4444' : 'inherit', margin: '0 0 0.15rem 0' }}>
                        {ann.title}
                      </h4>
                      <p style={{ fontSize: '0.775rem', color: 'var(--color-muted)', margin: 0, lineHeight: 1.4 }}>
                        {ann.message}
                      </p>
                      <span style={{ display: 'block', fontSize: '0.625rem', color: 'var(--color-muted)', marginTop: '0.4rem', textAlign: 'right' }}>
                        {new Date(ann.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })
              )}
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
          `}</style>
        </div>
      )}
    </>
  );
}
