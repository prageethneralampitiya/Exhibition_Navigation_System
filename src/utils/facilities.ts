import type { Store as StoreType } from '../lib/supabase';

const FACILITY_KEYWORDS = [
  'washroom', 'restroom', 'toilet', 'wc', 'bathroom',
  'canteen', 'cafeteria', 'food court', 'dining', 'snacks', 'refreshment',
  'first aid', 'medical', 'clinic', 'doctor', 'hospital',
  'water point', 'drinking water', 'water dispenser',
  'info desk', 'information desk', 'help desk', 'information', 'reception',
  'prayer room', 'mosque', 'chapel',
  'security', 'lost and found',
  'entrance', 'exit', 'gate',
  'amenity', 'facility',
];

const FACILITY_CATEGORY_NAMES = [
  'restrooms',
  'food & dining',
  'services',
  'medical & emergency',
  'visitor services',
  'entrances & exits',
  'facilities',
  'amenities',
];

/**
 * Returns true if a store record represents a campus/venue facility or amenity
 * (such as washrooms, canteen, drinking water, medical station, etc.) rather
 * than a regular exhibition stall/booth.
 */
export function isFacilityStore(store: StoreType | Partial<StoreType>): boolean {
  if (!store) return false;
  if (store.id === 'kalawana-national-school-landmark') return true;

  const catName = ((store as any).categories?.name || '').toLowerCase().trim();
  if (FACILITY_CATEGORY_NAMES.some((c) => catName === c || catName.includes(c))) {
    return true;
  }

  const name = (store.name || '').toLowerCase();
  const desc = (store.description || '').toLowerCase();
  const combined = `${name} ${desc} ${catName}`;

  return FACILITY_KEYWORDS.some((kw) => combined.includes(kw));
}

/**
 * Returns an appropriate emoji icon for a facility based on its name/category.
 */
export function getFacilityEmoji(store: StoreType | Partial<StoreType>): string {
  const text = `${store.name || ''} ${store.description || ''} ${(store as any).categories?.name || ''}`.toLowerCase();
  if (text.includes('washroom') || text.includes('restroom') || text.includes('toilet') || text.includes('wc')) {
    if (text.includes('men') && !text.includes('women')) return '🚹';
    if (text.includes('women')) return '🚺';
    if (text.includes('accessible') || text.includes('disabled') || text.includes('wheelchair')) return '♿';
    return '🚻';
  }
  if (text.includes('canteen') || text.includes('food') || text.includes('cafeteria') || text.includes('dining')) {
    return '🍽️';
  }
  if (text.includes('water')) {
    return '🚰';
  }
  if (text.includes('first aid') || text.includes('medical') || text.includes('clinic') || text.includes('doctor')) {
    return '🏥';
  }
  if (text.includes('info') || text.includes('help') || text.includes('reception')) {
    return 'ℹ️';
  }
  if (text.includes('entrance') || text.includes('gate') || text.includes('exit')) {
    return '🚪';
  }
  return '📍';
}

/**
 * Returns harmonious colors for a facility based on its type.
 */
export function getFacilityColor(store: StoreType | Partial<StoreType>): { color: string; bgColor: string } {
  const text = `${store.name || ''} ${store.description || ''} ${(store as any).categories?.name || ''}`.toLowerCase();
  if (text.includes('washroom') || text.includes('restroom') || text.includes('toilet') || text.includes('wc')) {
    return { color: '#38bdf8', bgColor: 'rgba(56, 189, 248, 0.15)' };
  }
  if (text.includes('canteen') || text.includes('food') || text.includes('cafeteria')) {
    return { color: '#f97316', bgColor: 'rgba(249, 115, 22, 0.15)' };
  }
  if (text.includes('water')) {
    return { color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.15)' };
  }
  if (text.includes('first aid') || text.includes('medical')) {
    return { color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)' };
  }
  if (text.includes('info') || text.includes('help')) {
    return { color: '#a855f7', bgColor: 'rgba(168, 85, 247, 0.15)' };
  }
  if (text.includes('entrance') || text.includes('gate')) {
    return { color: '#eab308', bgColor: 'rgba(234, 179, 8, 0.15)' };
  }
  return { color: '#6366f1', bgColor: 'rgba(99, 102, 241, 0.15)' };
}
