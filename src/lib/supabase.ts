import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Database Types ───────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: 'visitor' | 'admin' | 'store_admin';
  avatar_url: string | null;
  is_anonymous: boolean;
  created_at: string;
  updated_at: string;
}

export interface VisitorLocation {
  id: string;
  user_id: string | null;
  session_id: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  created_at: string;
}

export interface Exhibition {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  location: string | null;
  start_date: string | null;   // ISO date string YYYY-MM-DD
  end_date: string | null;
  latitude: number | null;
  longitude: number | null;
  is_featured: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExhibitionEvent {
  id: string;
  exhibition_id: string;
  title: string;
  description: string | null;
  location: string | null;
  speaker: string | null;
  start_time: string; // ISO date string
  end_time: string; // ISO date string
  created_at: string;
}


export interface Store {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  category_id: string | null;
  exhibition_id: string | null;
  floor: string | null;
  opening_time: string | null;  // HH:MM:SS
  closing_time: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  is_active: boolean;
  created_by: string | null;
  store_admin_id: string | null;  // UUID of the store_admin assigned to manage this store
  created_at: string;
  updated_at: string;
  // Joined fields (optional, populated by select queries)
  categories?: Pick<Category, 'id' | 'name' | 'color'> | null;
  exhibitions?: Pick<Exhibition, 'id' | 'title'> | null;
}

export interface StoreImage {
  id: string;
  store_id: string;
  image_url: string;
  created_at: string;
}

export interface Promotion {
  id: string;
  store_id: string;
  title: string;
  description: string | null;
  discount_code: string | null;
  banner_url: string | null;
  start_date: string | null; // ISO YYYY-MM-DD
  end_date: string | null; // ISO YYYY-MM-DD
  is_active: boolean;
  created_at: string;
  updated_at: string;
}


export interface Announcement {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'emergency' | 'broadcast' | 'settings';
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type NodeType = 'path' | 'entrance' | 'poi' | 'store' | 'emergency';

export interface NavigationNode {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  floor: string | null;
  type: NodeType;
  store_id: string | null;
  created_at: string;
}

export interface NavigationEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  distance: number;
  is_bidirectional: boolean;
  created_at: string;
  // Joined
  from_node?: Pick<NavigationNode, 'id' | 'label'> | null;
  to_node?: Pick<NavigationNode, 'id' | 'label'> | null;
}
