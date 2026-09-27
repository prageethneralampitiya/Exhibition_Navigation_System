import { useMemo } from 'react';
import { X, Footprints, ArrowRight, MapPin } from 'lucide-react';
import { type Store as StoreType } from '../lib/supabase';
import { getDistance } from '../utils/dijkstra';
import { isFacilityStore, getFacilityEmoji, getFacilityColor } from '../utils/facilities';

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
  // Only facilities registered in database / admin panel (no hardcoded categories or demo fallbacks)
  const registeredFacilities = useMemo(() => {
    const currentLat = userLat || 6.535472;
    const currentLng = userLng || 80.401000;

    // Filter only actual facilities
    const list = stores.filter(isFacilityStore);

    // Compute distance and sort by closest
    const withDistance = list.map((f) => {
      let distanceMeters = 0;
      if (f.latitude && f.longitude) {
        distanceMeters = Math.round(getDistance(currentLat, currentLng, f.latitude, f.longitude));
      }
      const walkMinutes = Math.max(1, Math.ceil(distanceMeters / 75)); // ~75m per minute
      return {
        facility: f,
        distanceMeters,
        walkMinutes,
      };
    });

    withDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return withDistance;
  }, [stores, userLat, userLng]);

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
                Quick Pitstop &amp; Facilities
              </h3>
            </div>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
              Select a facility below to take a quick detour. You can resume your original route anytime!
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

        {/* Facilities List (Admin-added only) */}
        <div
          style={{
            padding: '1rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            maxHeight: '52vh',
          }}
        >
          {registeredFacilities.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem 1.5rem',
                color: 'var(--color-muted)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-muted)',
                }}
              >
                <MapPin size={24} />
              </div>
              <h4 style={{ margin: '0.25rem 0 0', color: '#f8fafc', fontSize: '0.98rem', fontWeight: 700 }}>
                No Facilities Added Yet
              </h4>
              <p style={{ margin: 0, fontSize: '0.8rem', maxWidth: '340px', lineHeight: 1.5 }}>
                Facilities (washrooms, canteen, water points, first aid) added in the Admin Panel will be listed here.
              </p>
            </div>
          ) : (
            registeredFacilities.map(({ facility, distanceMeters, walkMinutes }) => {
              const emoji = getFacilityEmoji(facility);
              const styling = getFacilityColor(facility);

              return (
                <div
                  key={facility.id}
                  onClick={() => {
                    onSelectFacility(facility);
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.85rem 1rem',
                    borderRadius: '14px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                    e.currentTarget.style.borderColor = styling.color;
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
                        background: styling.bgColor,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.4rem',
                        flexShrink: 0,
                      }}
                    >
                      {emoji}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
                          {facility.name}
                        </span>
                        {facility.floor && (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              padding: '0.05rem 0.35rem',
                              borderRadius: '4px',
                              background: 'rgba(255, 255, 255, 0.08)',
                              color: 'var(--color-muted)',
                              fontWeight: 600,
                            }}
                          >
                            Floor {facility.floor}
                          </span>
                        )}
                      </div>
                      {facility.description && (
                        <div
                          style={{
                            fontSize: '0.76rem',
                            color: 'var(--color-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '260px',
                            marginTop: '0.1rem',
                          }}
                        >
                          {facility.description}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Distance & Action CTA */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 800, color: styling.color }}>
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
                        background: styling.bgColor,
                        color: styling.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <ArrowRight size={16} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
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
