import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GPSKalmanFilter } from '../utils/gpsFilter';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GPSPermission = 'granted' | 'denied' | 'prompt' | 'unavailable' | 'loading';

export interface GPSState {
  permission: GPSPermission;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  error: string | null;
  requestPermission: () => void;
}

// Anonymous visitors get a stable session_id from localStorage
function getAnonymousSessionId(): string {
  const key = 'exnav_session_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

// Quick distance calculation (meters) to avoid DB spam when stationary
function getFastDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111319.9;
  const dLon = (lon2 - lon1) * 111319.9 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

// Deterministic sampling: ~33% of anonymous visitors report location to admin heatmap,
// reducing concurrent database writes by an extra 67% without affecting the visitor's map.
function shouldSampleVisitor(sessionId: string): boolean {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash << 5) - hash + sessionId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 3 === 0;
}

// How often to push location to Supabase (ms) - optimized to 60s for high concurrent traffic (500+ users)
const SYNC_INTERVAL_MS = 60_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGPS(): GPSState {
  const { user } = useAuth();
  const [permission, setPermission] = useState<GPSPermission>('loading');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Kalman Filter for coordinates smoothing
  const filterRef = useRef(new GPSKalmanFilter(0.8, 1.8));

  // BUG FIX: use refs to prevent duplicate watchers & intervals
  const watchIdRef = useRef<number | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestCoordsRef = useRef<{ lat: number; lng: number; acc: number | null } | null>(null);
  const lastSyncedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // Track if we already inserted the initial anonymous row
  const anonRowIdRef = useRef<string | null>(null);

  // Push location to Supabase visitor_locations
  const syncLocation = useCallback(async () => {
    if (!latestCoordsRef.current) return;
    const { lat, lng, acc } = latestCoordsRef.current;

    // High traffic optimization 1: skip anonymous visitors not in sample (saves 67% DB writes)
    if (!user?.id) {
      const sessionId = getAnonymousSessionId();
      if (!shouldSampleVisitor(sessionId)) {
        return; // Visitor's local GPS still works 100% on their screen
      }
    }

    // High traffic optimization 2: skip database push if user hasn't moved at least 12 meters
    if (lastSyncedCoordsRef.current) {
      const movedMeters = getFastDistanceMeters(
        lastSyncedCoordsRef.current.lat,
        lastSyncedCoordsRef.current.lng,
        lat,
        lng
      );
      if (movedMeters < 12) {
        return;
      }
    }

    try {
      if (user?.id) {
        // Authenticated: upsert by user_id (unique constraint)
        await supabase
          .from('visitor_locations')
          .upsert(
            {
              user_id: user.id,
              session_id: null,
              latitude: lat,
              longitude: lng,
              accuracy: acc,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
        lastSyncedCoordsRef.current = { lat, lng };
      } else {
        // Anonymous: update existing row by its known UUID, or insert once
        // BUG FIX: Never upsert on 'id' (auto-generated) — it always inserts new rows.
        // Instead: insert once, save the returned id, then UPDATE by that id.
        if (anonRowIdRef.current) {
          // Update the existing row
          await supabase
            .from('visitor_locations')
            .update({
              latitude: lat,
              longitude: lng,
              accuracy: acc,
              updated_at: new Date().toISOString(),
            })
            .eq('id', anonRowIdRef.current);
          lastSyncedCoordsRef.current = { lat, lng };
        } else {
          // First sync for this anonymous session — insert a new row
          const { data } = await supabase
            .from('visitor_locations')
            .insert({
              user_id: null,
              session_id: getAnonymousSessionId(),
              latitude: lat,
              longitude: lng,
              accuracy: acc,
              updated_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (data?.id) {
            anonRowIdRef.current = data.id;
            lastSyncedCoordsRef.current = { lat, lng };
          }
        }
      }
    } catch {
      // Quietly ignore transient network or rate-limiting errors during crowd spikes
    }
  }, [user]);

  // BUG FIX: Guard against duplicate watchers — only start if not already running
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setPermission('unavailable');
      setError('GPS is not supported by your browser.');
      return;
    }

    // Don't start a second watcher if one is already active
    if (watchIdRef.current !== null) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: rawLat, longitude: rawLng, accuracy: acc } = pos.coords;
        const { lat, lng } = filterRef.current.filter(rawLat, rawLng, acc, pos.timestamp || Date.now());
        setLatitude(lat);
        setLongitude(lng);
        setAccuracy(acc);
        setError(null);
        setPermission('granted');
        latestCoordsRef.current = { lat, lng, acc };
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setPermission('denied');
          setError('GPS permission denied. Please enable location access in your browser settings.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError('GPS signal unavailable. Please try again outside or near a window.');
        } else {
          setError('GPS request timed out. Please try again.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    // Start periodic sync — guard against duplicate intervals
    if (syncTimerRef.current === null) {
      syncTimerRef.current = setInterval(syncLocation, SYNC_INTERVAL_MS);
    }
  }, [syncLocation]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (syncTimerRef.current !== null) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    filterRef.current.reset();
  }, []);

  // Check permission state and start tracking on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setPermission('unavailable');
      return;
    }

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        setPermission(result.state as GPSPermission);
        if (result.state === 'granted') startTracking();

        // Listen for future permission changes
        result.addEventListener('change', () => {
          setPermission(result.state as GPSPermission);
          if (result.state === 'granted') startTracking();
          else stopTracking();
        });
      })
      .catch(() => {
        // navigator.permissions API not supported — try tracking directly
        startTracking();
      });

    return stopTracking;
  }, []); // Empty deps: only run on mount/unmount — startTracking guards itself internally

  // When user logs in/out, reset the anon row ref and restart sync
  useEffect(() => {
    anonRowIdRef.current = null;
  }, [user?.id]);

  const requestPermission = useCallback(() => {
    startTracking();
  }, [startTracking]);

  return { permission, latitude, longitude, accuracy, error, requestPermission };
}
