import { supabase } from './supabase';

// In-memory throttling map to prevent crowd spamming (key -> timestamp)
const recentEvents = new Map<string, number>();

/**
 * Log visitor engagement event (e.g. view store profile, start routing path)
 */
export async function logAnalyticsEvent(
  eventType: 'store_view' | 'route_calculation' | 'search_query' | 'path_deviation',
  targetId: string | null,
  targetName: string,
  metadata: Record<string, any> = {}
) {
  // Deduplicate identical events triggered within 8 seconds by same client
  const dedupeKey = `${eventType}:${targetId || ''}:${targetName}`;
  const now = Date.now();
  const lastFired = recentEvents.get(dedupeKey);
  if (lastFired && now - lastFired < 8000) {
    return;
  }
  recentEvents.set(dedupeKey, now);

  // Clean old keys if map grows large
  if (recentEvents.size > 200) {
    for (const [k, time] of recentEvents.entries()) {
      if (now - time > 15000) recentEvents.delete(k);
    }
  }

  try {
    // Read local session without making an extra network roundtrip
    const sessionStr = localStorage.getItem('sb-' + (import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0] || '') + '-auth-token');
    let userId: string | null = null;
    if (sessionStr) {
      try {
        const parsed = JSON.parse(sessionStr);
        userId = parsed?.user?.id || null;
      } catch {}
    }

    await supabase.from('analytics_events').insert({
      event_type: eventType,
      target_id: targetId || null,
      target_name: targetName,
      metadata,
      user_id: userId,
    });
  } catch (err) {
    // Non-critical, ignore quietly under high load
  }
}
