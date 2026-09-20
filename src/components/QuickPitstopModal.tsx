import { useMemo } from 'react';
import { X, Footprints, ArrowRight } from 'lucide-react';
import { type Store as StoreType } from '../lib/supabase';
import { getDistance } from '../utils/dijkstra';

export interface FacilityGroup {
  id: string;
  categoryTitle: string;
  emoji: string;
  keywords: string[];
  color: string;
  bgColor: string;
}

export const FACILITY_GROUPS: FacilityGroup[] = [
  {
    id: 'restroom',
    categoryTitle: 'Restrooms & Washrooms',
    emoji: '🚻',
    keywords: ['washroom', 'restroom', 'toilet', 'wc', 'bathroom'],
    color: '#38bdf8',
    bgColor: 'rgba(56, 189, 248, 0.12)',
  },
  {
    id: 'canteen',
    categoryTitle: 'Canteen & Food Court',
    emoji: '🍽️',
    keywords: ['canteen', 'cafeteria', 'food court', 'dining', 'refreshment', 'snacks'],
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.12)',
  },
  {
    id: 'water',
    categoryTitle: 'Drinking Water Station',
    emoji: '🚰',
    keywords: ['water', 'drinking water', 'water point'],
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.12)',
  },
  {
    id: 'medical',
    categoryTitle: 'First Aid & Medical',
    emoji: '🏥',
    keywords: ['first aid', 'medical', 'clinic', 'doctor'],
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.12)',
  },
  {
    id: 'emergency',
    categoryTitle: 'Emergency Exit',
    emoji: '🚪',
    keywords: ['emergency exit', 'fire exit', 'exit gate'],
    color: '#f43f5e',
    bgColor: 'rgba(244, 63, 94, 0.12)',
  },
  {
    id: 'help',
    categoryTitle: 'Help Desk / Information',
    emoji: 'ℹ️',
    keywords: ['info', 'help desk', 'information', 'reception'],
    color: '#a855f7',
    bgColor: 'rgba(168, 85, 247, 0.12)',
  },
];

// Fallback demo facilities near Kalawana School campus if none registered yet
const DEFAULT_DEMO_FACILITIES: StoreType[] = [
  {
    id: 'demo-facility-wc-1',
    name: 'Main Building Washroom (All Gender)',
    description: 'Ground floor unisex restrooms near the main corridor',
    latitude: 6.535520,
    longitude: 80.400850,
    floor: '1',
    is_active: true,
  } as any,
  {
    id: 'demo-facility-canteen-1',
    name: 'Campus Canteen & Refreshment Hub',
    description: 'Snacks, tea, cold drinks and lunch packs',
    latitude: 6.535700,
    longitude: 80.400500,
    floor: '1',
    is_active: true,
  } as any,
  {
    id: 'demo-facility-water-1',
    name: 'Purified Water Refill Station',
    description: 'Cold filtered drinking water dispenser',
    latitude: 6.535400,
    longitude: 80.401100,
    floor: '1',
    is_active: true,
  } as any,
  {
    id: 'demo-facility-medical-1',
    name: 'Red Cross First Aid Post',
    description: 'Medical staff on duty and emergency kits',
    latitude: 6.535650,
    longitude: 80.401300,
    floor: '1',
    is_active: true,
  } as any,
];

interface QuickPitstopModalProps {
  isOpen: boolean;
  onClose: () => void;
  userLat: number | null;
  userLng: number | null;
  stores: StoreType[];
  onSelectFacility: (facility: StoreType) => void;
}

export function QuickPitstopModal({
  isOpen,
  onClose,
  userLat,
  userLng,
  stores,
  onSelectFacility,
}: QuickPitstopModalProps) {
  // Combine registered facility stores with fallback demo facilities
  const allFacilities = useMemo(() => {
    const registered = stores.filter((s) => {
      const text = `${s.name} ${s.description || ''} ${(s as any).categories?.name || ''}`.toLowerCase();
      return FACILITY_GROUPS.some((g) => g.keywords.some((kw) => text.includes(kw)));
    });

    if (registered.length > 0) return registered;
    return DEFAULT_DEMO_FACILITIES;
  }, [stores]);

  // For each facility group, compute the nearest facility and distance
  const categorizedFacilities = useMemo(() => {
    const currentLat = userLat || 6.535472;
    const currentLng = userLng || 80.401000;

    return FACILITY_GROUPS.map((group) => {
      // Find matching facilities in this group
      const matches = allFacilities.filter((f) => {
        const text = `${f.name} ${f.description || ''} ${(f as any).categories?.name || ''}`.toLowerCase();
        return group.keywords.some((kw) => text.includes(kw));
      });

      if (matches.length === 0) return null;

      // Find nearest match
      let nearest: StoreType = matches[0];
      let minDistance = Infinity;

      matches.forEach((f) => {
        if (f.latitude && f.longitude) {
          const d = getDistance(currentLat, currentLng, f.latitude, f.longitude);
          if (d < minDistance) {
            minDistance = d;
            nearest = f;
          }
        }
      });

      return {
        group,
        nearest,
        distanceMeters: Math.round(minDistance),
        walkMinutes: Math.max(1, Math.ceil(minDistance / 75)), // ~75m per minute walking
      };
    }).filter(Boolean) as Array<{
      group: FacilityGroup;
      nearest: StoreType;
      distanceMeters: number;
      walkMinutes: number;
    }>;
  }, [allFacilities, userLat, userLng]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(11, 15, 26, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 11500,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          maxHeight: '85vh',
          backgroundColor: '#0f172a',
          borderRadius: '20px 20px 0 0',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.25rem 0.75rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ fontSize: '1.25rem' }}>⚡</span>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                Quick Pitstop & Amenities
              </h3>
            </div>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
              Need a quick break? We’ll route you there and resume your trip shortestly!
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Facility Cards List */}
        <div
          style={{
            padding: '1rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
          }}
        >
          {categorizedFacilities.map(({ group, nearest, distanceMeters, walkMinutes }) => (
            <div
              key={group.id}
              onClick={() => {
                onSelectFacility(nearest);
                onClose();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.borderColor = group.color;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '12px',
                    background: group.bgColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.4rem',
                    flexShrink: 0,
                  }}
                >
                  {group.emoji}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
                      {group.categoryTitle}
                    </span>
                    {nearest.floor && (
                      <span
                        style={{
                          fontSize: '0.65rem',
                          padding: '0.05rem 0.35rem',
                          borderRadius: '4px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--color-muted)',
                        }}
                      >
                        Floor {nearest.floor}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--color-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '260px',
                    }}
                  >
                    {nearest.name}
                  </div>
                </div>
              </div>

              {/* Distance & Action CTA */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 800, color: group.color }}>
                    {distanceMeters} m
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>
                    ~{walkMinutes} min
                  </div>
                </div>

                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: group.bgColor,
                    color: group.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ArrowRight size={16} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer info */}
        <div
          style={{
            padding: '0.75rem 1.25rem',
            background: 'rgba(0, 0, 0, 0.25)',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.74rem',
            color: 'var(--color-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
          }}
        >
          <Footprints size={14} style={{ color: 'var(--color-accent)' }} />
          <span>Your original route will be preserved and can be resumed at any moment.</span>
        </div>
      </div>
    </div>
  );
}
