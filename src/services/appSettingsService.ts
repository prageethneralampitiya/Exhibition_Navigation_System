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
  outside_hours_count: 0,
  time_slots: [
    { id: 'slot-1', label: 'Morning Opening',   start_hour: 9,  start_minute: 0, end_hour: 11, end_minute: 0, initial_visitor_count: 80,  fluctuation_interval_sec: 30 },
    { id: 'slot-2', label: 'Late Morning',       start_hour: 11, start_minute: 0, end_hour: 13, end_minute: 0, initial_visitor_count: 200, fluctuation_interval_sec: 20 },
    { id: 'slot-3', label: 'Afternoon Peak',     start_hour: 13, start_minute: 0, end_hour: 16, end_minute: 0, initial_visitor_count: 260, fluctuation_interval_sec: 15 },
    { id: 'slot-4', label: 'Late Afternoon',     start_hour: 16, start_minute: 0, end_hour: 19, end_minute: 0, initial_visitor_count: 190, fluctuation_interval_sec: 20 },
    { id: 'slot-5', label: 'Evening Wind-down',  start_hour: 19, start_minute: 0, end_hour: 21, end_minute: 0, initial_visitor_count: 110, fluctuation_interval_sec: 30 },
  ],
};

export async function fetchEmergencyContacts(): Promise<EmergencyContact[]> {
  try {
    // 1. Try Supabase app_settings table
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'emergency_contacts')
      .maybeSingle();

    if (!error && data?.value && Array.isArray(data.value)) {
      localStorage.setItem(STORAGE_KEY_EMERGENCY, JSON.stringify(data.value));
      return data.value as EmergencyContact[];
    }
  } catch (err) {
    console.warn('fetchEmergencyContacts: remote fetch failed, falling back to local storage', err);
  }

  // 2. Fall back to localStorage
  try {
    const cached = localStorage.getItem(STORAGE_KEY_EMERGENCY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore json error
  }

  // 3. Fall back to defaults
  return DEFAULT_EMERGENCY_CONTACTS;
}

export async function saveEmergencyContacts(contacts: EmergencyContact[]): Promise<boolean> {
  // Always update local cache & notify local listeners
  try {
    localStorage.setItem(STORAGE_KEY_EMERGENCY, JSON.stringify(contacts));
    window.dispatchEvent(new CustomEvent('emergency-contacts-updated', { detail: contacts }));
  } catch {
    // ignore
  }

  // Try saving to Supabase app_settings
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'emergency_contacts',
        value: contacts,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    if (!error) return true;
    console.warn('saveEmergencyContacts: app_settings upsert error:', error);
  } catch (err) {
    console.warn('saveEmergencyContacts: remote save error:', err);
  }

  return true;
}

export async function fetchVideoLivesConfig(): Promise<VideoLivesConfig> {
  try {
    // 1. Try Supabase app_settings table
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

  // 2. Fall back to localStorage
  try {
    const cached = localStorage.getItem(STORAGE_KEY_VIDEOLIVES);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_VIDEO_LIVES, ...parsed };
      }
    }
  } catch {
    // ignore json error
  }

  // 3. Fall back to defaults
  return DEFAULT_VIDEO_LIVES;
}

export async function saveVideoLivesConfig(config: VideoLivesConfig): Promise<boolean> {
  // Always update local cache & notify local listeners
  try {
    localStorage.setItem(STORAGE_KEY_VIDEOLIVES, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent('video-lives-updated', { detail: config }));
  } catch {
    // ignore
  }

  // Try saving to Supabase app_settings
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'video_lives',
        value: config,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    if (!error) return true;
    console.warn('saveVideoLivesConfig: app_settings upsert error:', error);
  } catch (err) {
    console.warn('saveVideoLivesConfig: remote save error:', err);
  }

  return true;
}

// ─── Live Counter Config ─────────────────────────────────────────────────────

export async function fetchLiveCounterConfig(): Promise<LiveCounterConfig> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'live_counter')
      .maybeSingle();

    if (!error && data?.value && typeof data.value === 'object') {
      const fetched = data.value as Partial<LiveCounterConfig>;
      // Backward-compat: old format had flat fields, not time_slots
      if (fetched.time_slots && fetched.time_slots.length > 0) {
        const merged = { ...DEFAULT_LIVE_COUNTER, ...fetched };
        localStorage.setItem(STORAGE_KEY_LIVECOUNTER, JSON.stringify(merged));
        return merged;
      }
    }
  } catch (err) {
    console.warn('fetchLiveCounterConfig: remote fetch failed, falling back to local storage', err);
  }

  try {
    const cached = localStorage.getItem(STORAGE_KEY_LIVECOUNTER);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<LiveCounterConfig>;
      if (parsed && parsed.time_slots && parsed.time_slots.length > 0) {
        return { ...DEFAULT_LIVE_COUNTER, ...parsed };
      }
    }
  } catch {
    // ignore
  }

  return DEFAULT_LIVE_COUNTER;
}

export async function saveLiveCounterConfig(config: LiveCounterConfig): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY_LIVECOUNTER, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent('live-counter-updated', { detail: config }));
  } catch {
    // ignore
  }

  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        { key: 'live_counter', value: config, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (!error) return true;
    console.warn('saveLiveCounterConfig: app_settings upsert error:', error);
  } catch (err) {
    console.warn('saveLiveCounterConfig: remote save error:', err);
  }

  return true;
}
