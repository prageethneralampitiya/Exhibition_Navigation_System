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
      <div className="glass alert alert-warning" style={{ borderRadius: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-warning)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 700, marginBottom: '0.2rem', fontSize: '0.875rem' }}>
            {permission === 'denied' ? 'GPS access denied' : 'GPS not active'}
          </p>
          <p style={{ fontSize: '0.8rem', opacity: 0.85, lineHeight: 1.4 }}>
            {error ?? 'Enable location access to use navigation features.'}
          </p>
          {permission !== 'denied' && (
            <button
              className="btn btn-sm btn-ghost"
              style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
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
            <p style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.35rem' }}>
              Go to your browser settings → Site permissions → Location → Allow.
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            borderRadius: '50%',
            width: 26,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'inherit',
            cursor: 'pointer',
            opacity: 0.8,
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

