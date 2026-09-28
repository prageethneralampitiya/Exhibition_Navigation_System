/**
 * Visitor Stats Tracking Service
 * 
 * Tracks:
 * 1. Full count of the day (Total unique users who used the app today)
 * 2. Full count from all the time (All-time cumulative unique users)
 * 
 * Synchronizes in real time across clients and persists in Supabase settings.
 */

import { supabase } from '../lib/supabase';
import { useEffect, useState, useCallback } from 'react';

export interface VisitorStats {
  today_date: string;       // "YYYY-MM-DD"
  today_count: number;      // Total unique users today
  all_time_count: number;   // Total unique users all time
  last_updated?: string;
}

const STORAGE_KEY_STATS = 'invex_visitor_stats_cache';
const STORAGE_KEY_CLIENT_VISITED_DATE = 'invex_client_visit_date';
const STORAGE_KEY_CLIENT_ALL_TIME = 'invex_client_visit_all_time';

const BROADCAST_CHANNEL = 'visitor-stats-sync';
const LOCAL_EVENT = 'visitor-stats-updated';

function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const DEFAULT_VISITOR_STATS: VisitorStats = {
  today_date: getTodayDateString(),
  today_count: 168,
  all_time_count: 1420,
};

/**
 * Loads cached visitor stats from localStorage
 */
export function getLocalVisitorStats(): VisitorStats {
  if (typeof window === 'undefined') return { ...DEFAULT_VISITOR_STATS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STATS);
    if (raw) {
      const parsed = JSON.parse(raw);
      const today = getTodayDateString();
      if (parsed.today_date !== today) {
        // Date changed: reset today_count for new day
        return {
          today_date: today,
          today_count: 1,
          all_time_count: parsed.all_time_count || DEFAULT_VISITOR_STATS.all_time_count,
        };
      }
      return parsed;
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_VISITOR_STATS, today_date: getTodayDateString() };
}

/**
 * Saves visitor stats to localStorage
 */
function setLocalVisitorStats(stats: VisitorStats) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

/**
 * Fetches current visitor stats from Supabase (announcements settings record)
 */
export async function fetchVisitorStats(): Promise<VisitorStats> {
  const today = getTodayDateString();
  try {
    const { data } = await supabase
      .from('announcements')
      .select('id, message')
      .eq('type', 'settings')
      .limit(1);

    if (data && data[0]?.message) {
      const parsed = JSON.parse(data[0].message);
      if (parsed.visitor_stats) {
        const stats = parsed.visitor_stats as VisitorStats;
        if (stats.today_date !== today) {
          // Date rolled over to new day
          const rolledOver: VisitorStats = {
            today_date: today,
            today_count: 1,
            all_time_count: stats.all_time_count || DEFAULT_VISITOR_STATS.all_time_count,
            last_updated: new Date().toISOString(),
          };
          setLocalVisitorStats(rolledOver);
          return rolledOver;
        }
        setLocalVisitorStats(stats);
        return stats;
      }
    }
  } catch (err) {
    console.warn('Could not fetch visitor stats from Supabase, using local cache:', err);
  }
  return getLocalVisitorStats();
}

/**
 * Saves / updates visitor stats in Supabase and broadcasts to all clients
 */
export async function saveVisitorStats(newStats: VisitorStats): Promise<boolean> {
  const statsToSave: VisitorStats = {
    today_date: newStats.today_date || getTodayDateString(),
    today_count: Math.max(1, newStats.today_count),
    all_time_count: Math.max(1, newStats.all_time_count),
    last_updated: new Date().toISOString(),
  };

  setLocalVisitorStats(statsToSave);

  // Dispatch local window event
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: statsToSave }));
  }

  // Broadcast to other tabs & devices
  try {
    const channel = supabase.channel(BROADCAST_CHANNEL);
    channel.send({
      type: 'broadcast',
      event: 'stats_updated',
      payload: statsToSave,
    });
  } catch {
    // ignore
  }

  // Persist to Supabase settings
  try {
    const { data } = await supabase
      .from('announcements')
      .select('id, message')
      .eq('type', 'settings')
      .limit(1);

    if (data && data[0]) {
      let payload: any = {};
      try {
        payload = JSON.parse(data[0].message);
      } catch {}
      payload.visitor_stats = statsToSave;

      await supabase
        .from('announcements')
        .update({
          message: JSON.stringify(payload),
          updated_at: new Date().toISOString(),
        })
        .eq('id', data[0].id);
    }
    return true;
  } catch (err) {
    console.error('Failed to save visitor stats to Supabase:', err);
    return false;
  }
}

/**
 * Records a client visit when a user opens the app.
 * Deduplicated per device:
 * - Counts once per day for "Today's count"
 * - Counts once ever for "All-Time count"
 */
let hasRunTrackingInSession = false;

export async function recordClientVisit(): Promise<void> {
  if (typeof window === 'undefined' || hasRunTrackingInSession) return;
  hasRunTrackingInSession = true;

  const today = getTodayDateString();
  const lastVisitedDate = localStorage.getItem(STORAGE_KEY_CLIENT_VISITED_DATE);
  const hasVisitedAllTime = localStorage.getItem(STORAGE_KEY_CLIENT_ALL_TIME) === 'true';

  const isNewToday = lastVisitedDate !== today;
  const isNewAllTime = !hasVisitedAllTime;

  if (!isNewToday && !isNewAllTime) {
    return; // Already counted for today and all-time on this device
  }

  // Mark device
  localStorage.setItem(STORAGE_KEY_CLIENT_VISITED_DATE, today);
  localStorage.setItem(STORAGE_KEY_CLIENT_ALL_TIME, 'true');

  try {
    const current = await fetchVisitorStats();
    let todayCount = current.today_count;
    let allTimeCount = current.all_time_count;

    if (current.today_date !== today) {
      todayCount = 1;
    } else if (isNewToday) {
      todayCount += 1;
    }

    if (isNewAllTime) {
      allTimeCount += 1;
    }

    await saveVisitorStats({
      today_date: today,
      today_count: todayCount,
      all_time_count: allTimeCount,
    });
  } catch (err) {
    console.warn('Error recording client visit count:', err);
  }
}

/**
 * React hook for Admin Dashboard to view and manage Total Visitor Counts
 */
export function useVisitorStats() {
  const [stats, setStats] = useState<VisitorStats>(getLocalVisitorStats);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const fresh = await fetchVisitorStats();
    setStats(fresh);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    // Listen to local tab updates
    const handleLocal = (e: Event) => {
      const detail = (e as CustomEvent).detail as VisitorStats;
      if (detail) setStats(detail);
    };
    window.addEventListener(LOCAL_EVENT, handleLocal);

    // Realtime broadcast synchronization
    let channel: any = null;
    try {
      channel = supabase.channel(BROADCAST_CHANNEL);
      channel
        .on('broadcast', { event: 'stats_updated' }, (payload: any) => {
          if (payload?.payload) {
            setStats(payload.payload);
            setLocalVisitorStats(payload.payload);
          }
        })
        .subscribe();
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener(LOCAL_EVENT, handleLocal);
      if (channel) supabase.removeChannel(channel);
    };
  }, [refresh]);

  return {
    stats,
    loading,
    refresh,
    saveStats: saveVisitorStats,
  };
}
