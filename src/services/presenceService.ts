import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Generate or retrieve persistent session key for this tab/device
function getPresenceSessionKey(): string {
  try {
    let key = sessionStorage.getItem('exnav_presence_tab_id');
    if (!key) {
      key = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem('exnav_presence_tab_id', key);
    }
    return key;
  } catch {
    return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Global presence hook to track that this client is currently active on the website.
 * Mounted at root App level so every visitor is counted in real-time.
 */
export function useTrackVisitorPresence() {
  useEffect(() => {
    const sessionKey = getPresenceSessionKey();
    const channel = supabase.channel('website-online-presence', {
      config: {
        presence: {
          key: sessionKey,
        },
      },
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({
            online_at: new Date().toISOString(),
            user_agent: navigator.userAgent.substring(0, 50),
          });
        } catch {
          // ignore tracking error
        }
      }
    });

    return () => {
      channel.untrack().catch(() => {});
      supabase.removeChannel(channel);
    };
  }, []);
}

/**
 * Hook for Admin Dashboard to watch REAL-TIME connected visitors on the website.
 * Returns the exact count of currently connected browser sessions.
 */
export function useRealtimeOnlineCount() {
  const [realtimeCount, setRealtimeCount] = useState<number>(1);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const sessionKey = getPresenceSessionKey();
    const channel = supabase.channel('website-online-presence', {
      config: {
        presence: {
          key: sessionKey,
        },
      },
    });

    const updateCountFromPresence = () => {
      const state = channel.presenceState();
      // Count unique presence keys (each client tab/device)
      const uniqueSessions = Object.keys(state);
      setRealtimeCount(Math.max(1, uniqueSessions.length));
    };

    channel
      .on('presence', { event: 'sync' }, updateCountFromPresence)
      .on('presence', { event: 'join' }, updateCountFromPresence)
      .on('presence', { event: 'leave' }, updateCountFromPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          try {
            await channel.track({
              online_at: new Date().toISOString(),
              role: 'admin_dashboard',
            });
          } catch {
            // ignore
          }
          updateCountFromPresence();
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setIsConnected(false);
        }
      });

    return () => {
      channel.untrack().catch(() => {});
      supabase.removeChannel(channel);
    };
  }, []);

  return { realtimeCount, isConnected };
}
