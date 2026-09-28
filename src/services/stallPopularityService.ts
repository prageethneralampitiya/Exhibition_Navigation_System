/**
 * Stall Popularity Tracking Service
 * 
 * Accurately tracks visitor engagement for exhibition stalls:
 * - Direct path navigation requests (highest intent, weight: 5)
 * - Tour planner stall selections (weight: 3)
 * - Stall detail views (weight: 2)
 * - Search query clicks (weight: 1)
 * 
 * Synchronizes across browser tabs and devices via Supabase Realtime broadcast
 * and persists to localStorage.
 */

import { supabase } from '../lib/supabase';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'invex_stall_popularity_v1';
const BROADCAST_CHANNEL = 'stall-popularity-sync';
const UPDATE_EVENT = 'stall-popularity-updated';

// Realistic baseline popularity points for major exhibition attractions
// Ensures sensible initial ranking before thousands of live user interactions occur
const BASELINE_POPULARITY_BY_NAME: Record<string, number> = {
  'sri lanka air force': 48,
  '3d film': 42,
  'arthur c. clarke institute': 39,
  'technical college - ratnapura': 35,
  'colombo stock exchange': 31,
  'food products stall': 29,
  'archaeology institue - rathnapura': 27,
  'animal kingdom': 25,
  'ayurvedic medical clinic': 23,
  'cadets unit': 21,
  'chemistry lab': 20,
  'apaya': 19,
  'newton laws exhibition': 18,
  'greenhouse': 17,
  'art section': 16,
};

export type EngagementType = 'route' | 'tour_select' | 'view' | 'search';

const ENGAGEMENT_WEIGHTS: Record<EngagementType, number> = {
  route: 5,       // Direct to path / route calculation on map
  tour_select: 3, // Selected in Exhibition Tour Planner
  view: 2,        // Viewed stall profile / popup
  search: 1,      // Clicked from search results
};

// In-memory throttling map to prevent excessive writes (key -> timestamp)
const throttleMap = new Map<string, number>();

/**
 * Loads stored popularity counts from localStorage
 */
export function getStoredPopularityScores(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Saves stored popularity counts to localStorage
 */
function savePopularityScores(scores: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch {
    // ignore quota errors
  }
}

/**
 * Computes combined popularity score for a stall ID and stall name
 */
export function getStallScore(
  stallId: string,
  stallName: string,
  scoresMap: Record<string, number> = getStoredPopularityScores()
): number {
  const normName = (stallName || '').toLowerCase().trim();
  
  // Baseline initial points (fuzzy match or direct match)
  let baseline = 0;
  for (const [key, pts] of Object.entries(BASELINE_POPULARITY_BY_NAME)) {
    if (normName.includes(key) || key.includes(normName)) {
      baseline = Math.max(baseline, pts);
    }
  }

  const liveById = scoresMap[stallId] || 0;
  const liveByName = scoresMap[normName] || 0;

  return baseline + liveById + liveByName;
}

/**
 * Record a user interaction with a stall and broadcast to other tabs/devices
 */
export function recordStallEngagement(
  stallId: string | null | undefined,
  stallName: string | null | undefined,
  type: EngagementType = 'view'
) {
  if (!stallId && !stallName) return;

  const id = stallId || '';
  const normName = (stallName || '').toLowerCase().trim();
  const weight = ENGAGEMENT_WEIGHTS[type] || 1;

  // Throttling: deduplicate same stall engagement within 5 seconds from same user
  const throttleKey = `${id}:${normName}:${type}`;
  const now = Date.now();
  const lastTime = throttleMap.get(throttleKey);
  if (lastTime && now - lastTime < 5000) {
    return;
  }
  throttleMap.set(throttleKey, now);

  // 1. Update local storage
  const current = getStoredPopularityScores();
  if (id) {
    current[id] = (current[id] || 0) + weight;
  }
  if (normName) {
    current[normName] = (current[normName] || 0) + weight;
  }
  savePopularityScores(current);

  // 2. Dispatch local window event so UI reacts immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(UPDATE_EVENT, {
        detail: { stallId: id, stallName: normName, weight, scores: current },
      })
    );
  }

  // 3. Broadcast to other open tabs / devices via Supabase channel
  try {
    const channel = supabase.channel(BROADCAST_CHANNEL);
    channel.send({
      type: 'broadcast',
      event: 'stall_engagement',
      payload: { stallId: id, stallName: normName, weight },
    });
  } catch {
    // non-critical
  }
}

/**
 * React hook that subscribes to realtime popularity updates and returns the live scores map
 */
export function useStallPopularity(): {
  scores: Record<string, number>;
  getScore: (id: string, name: string) => number;
} {
  const [scores, setScores] = useState<Record<string, number>>(getStoredPopularityScores);

  useEffect(() => {
    // Listen to local tab updates
    const handleLocalUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.scores) {
        setScores({ ...detail.scores });
      } else {
        setScores(getStoredPopularityScores());
      }
    };
    window.addEventListener(UPDATE_EVENT, handleLocalUpdate);

    // Subscribe to cross-tab / cross-device broadcast
    let broadcastChannel: any = null;
    try {
      broadcastChannel = supabase.channel(BROADCAST_CHANNEL);
      broadcastChannel
        .on('broadcast', { event: 'stall_engagement' }, (payload: any) => {
          const { stallId, stallName, weight } = payload?.payload || {};
          if (stallId || stallName) {
            setScores((prev) => {
              const updated = { ...prev };
              if (stallId) updated[stallId] = (updated[stallId] || 0) + (weight || 1);
              if (stallName) updated[stallName] = (updated[stallName] || 0) + (weight || 1);
              savePopularityScores(updated);
              return updated;
            });
          }
        })
        .subscribe();
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener(UPDATE_EVENT, handleLocalUpdate);
      if (broadcastChannel) {
        supabase.removeChannel(broadcastChannel);
      }
    };
  }, []);

  const getScore = (id: string, name: string) => {
    return getStallScore(id, name, scores);
  };

  return { scores, getScore };
}
