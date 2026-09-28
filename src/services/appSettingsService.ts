import { supabase } from '../lib/supabase';

export interface EmergencyContact {
  id: string;
  title: string;
  phone: string;
  department?: string;
  description?: string;
  icon?: 'ambulance' | 'police' | 'fire' | 'phone' | 'shield';
  is_active?: boolean;
}

export interface VideoLivesConfig {
  youtube_url: string;
  facebook_url: string;
  is_youtube_active?: boolean;
  is_facebook_active?: boolean;
  title?: string;
  description?: string;
}

export interface TimeSlot {
  id: string;
  label: string;                    // e.g. "Afternoon Peak"
  start_hour: number;               // 0–23
  start_minute: number;             // 0–59
  end_hour: number;
  end_minute: number;
  initial_visitor_count: number;    // Simulated base for this period
  fluctuation_interval_sec: number; // Seconds between ±1/2 shifts
}

export interface LiveCounterConfig {
  time_slots: TimeSlot[];
  outside_hours_count: number;      // Count shown outside exhibition hours (usually 0)
}

export const DEFAULT_EMERGENCY_CONTACTS: EmergencyContact[] = [
  {
    id: 'em-1',
    title: 'Medical Center & Ambulance',
    phone: '1990',
    department: 'Health & First Aid',
    description: 'Emergency Suwa Seriya ambulance service & medical booth',
    icon: 'ambulance',
    is_active: true,
  },
  {
    id: 'em-2',
    title: 'Campus Police & Security',
    phone: '119',
    department: 'Security Division',
    description: 'Immediate response team for security and safety issues',
    icon: 'police',
    is_active: true,
  },
  {
    id: 'em-3',
    title: 'Fire & Rescue Service',
    phone: '110',
    department: 'Emergency Services',
    description: 'Fire hazard reporting & rescue operations',
    icon: 'fire',
    is_active: true,
  },
  {
    id: 'em-4',
    title: 'Exhibition Main Helpdesk',
    phone: '+94 11 265 0301',
    department: 'Organizing Committee',
    description: 'Inquiries, lost & found, and general visitor assistance',
    icon: 'phone',
    is_active: true,
  },
];

export const DEFAULT_VIDEO_LIVES: VideoLivesConfig = {
  youtube_url: 'https://www.youtube.com',
  facebook_url: 'https://www.facebook.com',
  is_youtube_active: true,
  is_facebook_active: true,
  title: 'INVEX 2026 Live Streams',
  description: 'Stream keynotes, project showcases and ceremonies live',
};

const STORAGE_KEY_EMERGENCY = 'exnav_emergency_contacts';
const STORAGE_KEY_VIDEOLIVES = 'exnav_video_lives';
const STORAGE_KEY_LIVECOUNTER = 'exnav_live_counter';

export const DEFAULT_LIVE_COUNTER: LiveCounterConfig = {
  outside_hours_count: 50,
  time_slots: [
    { id: 'slot-1', label: 'Morning Opening',   start_hour: 9,  start_minute: 0, end_hour: 11, end_minute: 0, initial_visitor_count: 120, fluctuation_interval_sec: 25 },
    { id: 'slot-2', label: 'Late Morning',       start_hour: 11, start_minute: 0, end_hour: 13, end_minute: 0, initial_visitor_count: 220, fluctuation_interval_sec: 20 },
    { id: 'slot-3', label: 'Afternoon Peak',     start_hour: 13, start_minute: 0, end_hour: 16, end_minute: 0, initial_visitor_count: 310, fluctuation_interval_sec: 15 },
    { id: 'slot-4', label: 'Late Afternoon',     start_hour: 16, start_minute: 0, end_hour: 19, end_minute: 0, initial_visitor_count: 240, fluctuation_interval_sec: 20 },
    { id: 'slot-5', label: 'Evening Wind-down',  start_hour: 19, start_minute: 0, end_hour: 22, end_minute: 0, initial_visitor_count: 140, fluctuation_interval_sec: 30 },
  ],
};

// ─── Emergency Contacts ──────────────────────────────────────────────────────

export async function fetchEmergencyContacts(): Promise<EmergencyContact[]> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'emergency_contacts')
      .maybeSingle();

    if (!error && Array.isArray(data?.value)) {
      localStorage.setItem(STORAGE_KEY_EMERGENCY, JSON.stringify(data.value));
      return data.value as EmergencyContact[];
    }
  } catch (err) {
    console.warn('fetchEmergencyContacts: remote fetch error:', err);
  }

  try {
    const cached = localStorage.getItem(STORAGE_KEY_EMERGENCY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }

  return DEFAULT_EMERGENCY_CONTACTS;
}

export async function saveEmergencyContacts(contacts: EmergencyContact[]): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_EMERGENCY, JSON.stringify(contacts));
    window.dispatchEvent(new CustomEvent('emergency-contacts-updated', { detail: contacts }));
  } catch {
    // ignore
  }

  // Update existing row in app_settings table
  try {
    const { error } = await supabase
      .from('app_settings')
      .update({
        value: contacts,
        updated_at: new Date().toISOString(),
      })
      .eq('key', 'emergency_contacts');

    if (!error) return true;
  } catch (err) {
    console.warn('saveEmergencyContacts update error:', err);
  }

  return true;
}

// ─── Video Lives ─────────────────────────────────────────────────────────────

export async function fetchVideoLivesConfig(): Promise<VideoLivesConfig> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'video_lives')
      .maybeSingle();

    if (!error && data?.value && typeof data.value === 'object') {
      localStorage.setItem(STORAGE_KEY_VIDEOLIVES, JSON.stringify(data.value));
      return { ...DEFAULT_VIDEO_LIVES, ...(data.value as VideoLivesConfig) };
    }
  } catch (err) {
    console.warn('fetchVideoLivesConfig: remote fetch failed, falling back to local storage', err);
  }

  try {
    const cached = localStorage.getItem(STORAGE_KEY_VIDEOLIVES);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_VIDEO_LIVES, ...parsed };
      }
    }
  } catch {
    // ignore
  }

  return DEFAULT_VIDEO_LIVES;
}

export async function saveVideoLivesConfig(config: VideoLivesConfig): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_VIDEOLIVES, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent('video-lives-updated', { detail: config }));
  } catch {
    // ignore
  }

  try {
    const { error } = await supabase
      .from('app_settings')
      .update({
        value: config,
        updated_at: new Date().toISOString(),
      })
      .eq('key', 'video_lives');

    if (!error) return true;
  } catch (err) {
    console.warn('saveVideoLivesConfig update error:', err);
  }

  return true;
}

// ─── Live Counter Config ─────────────────────────────────────────────────────

export async function fetchLiveCounterConfig(): Promise<LiveCounterConfig> {
  // 1. Try app_settings table
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'live_counter')
      .maybeSingle();

    if (!error && data?.value && typeof data.value === 'object') {
      const fetched = data.value as Partial<LiveCounterConfig>;
      if (fetched.time_slots && fetched.time_slots.length > 0) {
        const merged: LiveCounterConfig = {
          outside_hours_count: fetched.outside_hours_count ?? 50,
          time_slots: fetched.time_slots,
        };
        try {
          localStorage.setItem(STORAGE_KEY_LIVECOUNTER, JSON.stringify(merged));
        } catch {
          // ignore
        }
        return merged;
      }
    }
  } catch (err) {
    console.warn('fetchLiveCounterConfig: app_settings read notice:', err);
  }

  // 2. Try announcements fallback table (title: 'LIVE_COUNTER_CONFIG')
  try {
    const { data } = await supabase
      .from('announcements')
      .select('message')
      .eq('title', 'LIVE_COUNTER_CONFIG')
      .maybeSingle();

    if (data?.message) {
      const parsed = JSON.parse(data.message) as Partial<LiveCounterConfig>;
      if (parsed.time_slots && parsed.time_slots.length > 0) {
        const merged: LiveCounterConfig = {
          outside_hours_count: parsed.outside_hours_count ?? 50,
          time_slots: parsed.time_slots,
        };
        try {
          localStorage.setItem(STORAGE_KEY_LIVECOUNTER, JSON.stringify(merged));
        } catch {
          // ignore
        }
        return merged;
      }
    }
  } catch (err) {
    console.warn('fetchLiveCounterConfig: announcements fallback read notice:', err);
  }

  // 3. Try announcements type = 'settings' (System Exhibition Settings record)
  try {
    const { data } = await supabase
      .from('announcements')
      .select('message')
      .eq('type', 'settings')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.message) {
      const parsed = JSON.parse(data.message);
      if (parsed.live_counter && parsed.live_counter.time_slots && parsed.live_counter.time_slots.length > 0) {
        const merged: LiveCounterConfig = {
          outside_hours_count: parsed.live_counter.outside_hours_count ?? 50,
          time_slots: parsed.live_counter.time_slots,
        };
        try {
          localStorage.setItem(STORAGE_KEY_LIVECOUNTER, JSON.stringify(merged));
        } catch {
          // ignore
        }
        return merged;
      }
    }
  } catch (err) {
    console.warn('fetchLiveCounterConfig: type settings read notice:', err);
  }

  // 4. Fall back to local storage cache
  try {
    const cached = localStorage.getItem(STORAGE_KEY_LIVECOUNTER);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<LiveCounterConfig>;
      if (parsed && parsed.time_slots && parsed.time_slots.length > 0) {
        return {
          outside_hours_count: parsed.outside_hours_count ?? 50,
          time_slots: parsed.time_slots,
        };
      }
    }
  } catch {
    // ignore
  }

  return DEFAULT_LIVE_COUNTER;
}

export async function saveLiveCounterConfig(config: LiveCounterConfig): Promise<boolean> {
  let saved = false;

  // 1. LocalStorage & local event dispatch
  try {
    localStorage.setItem(STORAGE_KEY_LIVECOUNTER, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent('live-counter-updated', { detail: config }));
    saved = true;
  } catch {
    // ignore
  }

  // 2. Update existing row in app_settings table (UPDATE works, upsert fails with 42501 RLS)
  try {
    const { error } = await supabase
      .from('app_settings')
      .update({
        value: config,
        updated_at: new Date().toISOString(),
      })
      .eq('key', 'live_counter');

    if (!error) {
      saved = true;
    } else {
      console.warn('saveLiveCounterConfig: app_settings update error:', error);
    }
  } catch (err) {
    console.warn('saveLiveCounterConfig: app_settings error:', err);
  }

  // 3. Dual-sync to announcements table with title: 'LIVE_COUNTER_CONFIG'
  try {
    const payloadStr = JSON.stringify(config);
    const { data: existing } = await supabase
      .from('announcements')
      .select('id')
      .eq('title', 'LIVE_COUNTER_CONFIG')
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from('announcements')
        .update({
          message: payloadStr,
          type: 'live_counter',
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (!error) saved = true;
    } else {
      const { error } = await supabase
        .from('announcements')
        .insert({
          title: 'LIVE_COUNTER_CONFIG',
          message: payloadStr,
          type: 'live_counter',
          is_active: true,
        });
      if (!error) saved = true;
    }
  } catch (err) {
    console.warn('saveLiveCounterConfig: announcements sync error:', err);
  }

  // 4. Also sync into type = 'settings' announcement record
  try {
    const { data: settingsRow } = await supabase
      .from('announcements')
      .select('id, message')
      .eq('type', 'settings')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (settingsRow?.id) {
      let parsedSettings: any = {};
      if (settingsRow.message) {
        try { parsedSettings = JSON.parse(settingsRow.message); } catch {}
      }
      parsedSettings.live_counter = config;
      const { error } = await supabase
        .from('announcements')
        .update({
          message: JSON.stringify(parsedSettings),
          updated_at: new Date().toISOString(),
        })
        .eq('id', settingsRow.id);
      if (!error) saved = true;
    }
  } catch (err) {
    console.warn('saveLiveCounterConfig: type settings sync error:', err);
  }

  // 5. Realtime broadcast channel so any user with HomePage open updates immediately
  try {
    const channel = supabase.channel('live-counter-sync-broadcast');
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'live_counter_changed',
          payload: config,
        }).catch(() => {});
      }
    });
  } catch {
    // ignore
  }

  return saved;
}
