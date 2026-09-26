import { useState } from 'react';
import { MapPin, AlertTriangle, X } from 'lucide-react';
import { useGPS } from '../hooks/useGPS';

interface GPSPermissionBannerProps {
  onDismiss?: () => void;
  inFlow?: boolean;
}

export function GPSPermissionBanner({ onDismiss, inFlow = false }: GPSPermissionBannerProps) {
  const { permission, error, requestPermission } = useGPS();
  const [dismissed, setDismissed] = useState(false);

  // Only show if GPS is denied or errored and not dismissed
  if (dismissed || permission === 'granted' || permission === 'loading' || permission === 'unavailable') {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  return (
    <div
      className={inFlow ? 'gps-banner-inflow' : 'gps-banner'}
      style={inFlow ? {
        position: 'relative',
        width: '100%',
        maxWidth: '100%',
        margin: '0 0 1rem 0',
        zIndex: 10,
        animation: 'none',
      } : undefined}
    >
      <div
        className="glass alert alert-warning gps-banner-card"
        style={{
          borderRadius: '1.15rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(180, 83, 9, 0.14) 100%)',
          border: '1px solid rgba(245, 158, 11, 0.42)',
          color: '#fef08a',
          boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
        }}
      >
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2, color: '#fbbf24' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 700, marginBottom: '0.2rem', fontSize: '0.875rem', color: '#fef08a' }}>
            {permission === 'denied' ? 'GPS access denied' : 'GPS not active'}
          </p>
          <p style={{ fontSize: '0.8rem', opacity: 0.9, lineHeight: 1.4, color: 'rgba(254, 240, 138, 0.9)' }}>
            {error ?? 'Enable location access to use navigation features.'}
          </p>
          {permission !== 'denied' && (
            <button
              className="btn btn-sm"
              style={{
                marginTop: '0.55rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: '0.7rem',
                color: '#ffffff',
                padding: '0.32rem 0.8rem',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
              onClick={() => {
                // Request orientation permissions on user gesture
                const DeviceEvent = window.DeviceOrientationEvent as any;
                if (DeviceEvent && typeof DeviceEvent.requestPermission === 'function') {
                  DeviceEvent.requestPermission().catch(console.error);
                }
                requestPermission();
              }}
            >
              <MapPin size={14} />
              Enable GPS
            </button>
          )}
          {permission === 'denied' && (
            <p style={{ fontSize: '0.75rem', opacity: 0.75, marginTop: '0.35rem', color: '#fef08a' }}>
              Go to your browser settings → Site permissions → Location → Allow.
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: 'rgba(255, 255, 255, 0.12)',
            border: 'none',
            borderRadius: '50%',
            width: 26,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'inherit',
            cursor: 'pointer',
            opacity: 0.85,
            padding: 0,
            flexShrink: 0,
          }}
          aria-label="Dismiss GPS banner"
          title="Dismiss banner"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

