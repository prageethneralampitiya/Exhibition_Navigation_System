import { supabase } from './supabase';

/**
 * Log visitor engagement event (e.g. view store profile, start routing path)
 */
export async function logAnalyticsEvent(
  eventType: 'store_view' | 'route_calculation' | 'search_query' | 'path_deviation',
  targetId: string | null,
  targetName: string,
  metadata: Record<string, any> = {}
) {
  try {
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    
    await supabase.from('analytics_events').insert({
      event_type: eventType,
      target_id: targetId || null,
      target_name: targetName,
      metadata,
      user_id: user?.id || null
    });
  } catch (err) {
    console.warn('Unable to record analytics event:', err);
  }
}
