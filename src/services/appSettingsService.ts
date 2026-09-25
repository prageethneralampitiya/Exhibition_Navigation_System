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
