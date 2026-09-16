import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { supabase, type Announcement } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveBroadcastContextValue {
  /** Currently active broadcast announcement, or null when none is live */
  activeBroadcast: Announcement | null;
  /** Whether the audio is actively playing (iframe loaded and running) */
  isPlaying: boolean;
  /** Whether the user has dismissed the full banner (mini-button still visible) */
  isDismissed: boolean;
  /** Start playing audio */
  handleListen: () => void;
  /** Mute / pause audio */
  handleMute: () => void;
  /** Dismiss the full banner (audio keeps state, mini-button remains) */
  handleDismiss: () => void;
  /** Re-show the full banner after it was dismissed */
  handleExpand: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const LiveBroadcastContext = createContext<LiveBroadcastContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function LiveBroadcastProvider({ children }: { children: ReactNode }) {
  const [activeBroadcast, setActiveBroadcast] = useState<Announcement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // ── Fetch + Real-time subscription ────────────────────────────────────────

  useEffect(() => {
    fetchActiveBroadcast();

    const channelName = `live-broadcast-ctx-${Math.random().toString(36).substring(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        (payload) => {
          const { eventType } = payload;
          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            const ann = payload.new as Announcement;
            if (ann.type === 'broadcast') {
              if (ann.is_active) {
                setActiveBroadcast(ann);
              } else {
                setActiveBroadcast(null);
                setIsPlaying(false);
                if (iframeRef.current) iframeRef.current.src = 'about:blank';
              }
            }
          } else if (eventType === 'DELETE') {
            const oldId = payload.old.id;
            setActiveBroadcast((prev) => {
              if (prev?.id === oldId) {
                setIsPlaying(false);
                if (iframeRef.current) iframeRef.current.src = 'about:blank';
                return null;
              }
              return prev;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchActiveBroadcast() {
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('type', 'broadcast')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      if (data && data.length > 0) {
        setActiveBroadcast(data[0]);
      } else {
        setActiveBroadcast(null);
      }
    } catch (err) {
      console.error('LiveBroadcastContext: Error fetching active broadcast:', err);
    }
  }

  // ── Audio helpers ─────────────────────────────────────────────────────────

  const youtubeId = activeBroadcast?.message || '';

  // Keep iframe in sync when youtubeId changes while playing
  useEffect(() => {
    if (isPlaying && iframeRef.current && youtubeId) {
      iframeRef.current.src = `https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=0&controls=0&playsinline=1&enablejsapi=1`;
    }
  }, [youtubeId, isPlaying]);

  const handleListen = useCallback(() => {
    setIsPlaying(true);
    if (iframeRef.current && youtubeId) {
      iframeRef.current.src = `https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=0&controls=0&playsinline=1&enablejsapi=1`;
    }
  }, [youtubeId]);

  const handleMute = useCallback(() => {
    setIsPlaying(false);
    if (iframeRef.current) iframeRef.current.src = 'about:blank';
  }, []);

  const handleDismiss = useCallback(() => {
    if (activeBroadcast) {
      sessionStorage.setItem('dismissed_broadcast_time', activeBroadcast.updated_at);
    }
    setIsDismissed(true);
    // NOTE: We do NOT stop audio on dismiss — user can keep listening via mini-button
  }, [activeBroadcast]);

  const handleExpand = useCallback(() => {
    setIsDismissed(false);
  }, []);

  // ── Hidden YouTube iframe — always in DOM while broadcast is active ────────

  return (
    <LiveBroadcastContext.Provider
      value={{
        activeBroadcast,
        isPlaying,
        isDismissed,
        handleListen,
        handleMute,
        handleDismiss,
        handleExpand,
      }}
    >
      {children}

      {/* 
        Always-in-DOM YouTube iframe for iOS Safari audio compatibility.
        Placed inside a 2×2 px overflow-hidden container so it's truly invisible
        to the user while remaining fully active for autoplay / gesture tracking.
      */}
      {youtubeId && (
        <div
          style={{
            position: 'fixed',
            top: '0px',
            left: '0px',
            width: '2px',
            height: '2px',
            overflow: 'hidden',
            zIndex: -1000,
            pointerEvents: 'none',
            opacity: 0.99,
          }}
        >
          <iframe
            ref={iframeRef}
            width="200"
            height="200"
            src="about:blank"
            title="Live Broadcast Audio Stream"
            allow="autoplay; encrypted-media"
            style={{ border: 'none' }}
          />
        </div>
      )}
    </LiveBroadcastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveBroadcast(): LiveBroadcastContextValue {
  const ctx = useContext(LiveBroadcastContext);
  if (!ctx) {
    throw new Error('useLiveBroadcast must be used inside <LiveBroadcastProvider>');
  }
  return ctx;
}
