import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Maximize2, Check } from 'lucide-react';

// Fix Leaflet default icon paths inside Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface FormMapPickerProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
}

export function FormMapPicker({ latitude, longitude, onChange }: FormMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;

    // Use current lat/lng or default to Kalawana National School campus center if coordinates are missing/0
    const startLat = latitude && latitude !== 0 ? latitude : 6.535472;
    const startLng = longitude && longitude !== 0 ? longitude : 80.401000;

    const map = L.map(containerRef.current, {
      center: [startLat, startLng],
      zoom: 17,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
    }).addTo(map);

    const marker = L.marker([startLat, startLng], { draggable: true }).addTo(map);

    markerRef.current = marker;
    mapRef.current = map;

    // Trigger update on drag end
    marker.on('dragend', () => {
      const position = marker.getLatLng();
      const roundedLat = Math.round(position.lat * 1000000) / 1000000;
      const roundedLng = Math.round(position.lng * 1000000) / 1000000;
      onChange(roundedLat, roundedLng);
    });

    // Trigger update on map click
    map.on('click', (e) => {
      const roundedLat = Math.round(e.latlng.lat * 1000000) / 1000000;
      const roundedLng = Math.round(e.latlng.lng * 1000000) / 1000000;
      marker.setLatLng([roundedLat, roundedLng]);
      onChange(roundedLat, roundedLng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Update marker position externally if coords change (via form inputs)
  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      const markerLatLng = markerRef.current.getLatLng();
      if (markerLatLng.lat !== latitude || markerLatLng.lng !== longitude) {
        markerRef.current.setLatLng([latitude, longitude]);
        mapRef.current.panTo([latitude, longitude]);
      }
    }
  }, [latitude, longitude]);

  // Recalculate map tiles layout when dimensions transition (fullscreen toggle)
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, 150);
    }
  }, [isFullScreen]);

  // Dynamic overlay style for fullscreen vs inline
  const wrapperStyle: React.CSSProperties = isFullScreen
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        background: 'var(--color-bg)',
      }
    : {
        width: '100%',
        height: '100%',
        position: 'relative',
      };

  return (
    <div style={wrapperStyle}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: isFullScreen ? '0' : '8px',
          border: isFullScreen ? 'none' : '1px solid var(--color-border)',
          zIndex: 1,
        }}
      />

      {/* Floating Instructions Banner */}
      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'rgba(11, 15, 26, 0.95)',
        border: '1px solid var(--color-border)',
        borderRadius: '6px',
        padding: '0.3rem 0.8rem',
        fontSize: '0.7rem',
        fontWeight: 700,
        color: 'var(--color-accent)',
        pointerEvents: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}>
        📍 Click map or drag pin to choose coordinates
      </div>

      {/* Fullscreen Expand/Collapse Floating Controls */}
      {isFullScreen ? (
        <button
          type="button"
          onClick={() => setIsFullScreen(false)}
          className="btn btn-primary"
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 100000,
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            padding: '0.6rem 1.2rem',
            borderRadius: '8px',
          }}
        >
          <Check size={16} />
          Done Picking
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsFullScreen(true)}
          className="btn btn-ghost btn-sm btn-icon"
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: 1000,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text)',
          }}
          title="Open Full Screen Map"
        >
          <Maximize2 size={15} />
        </button>
      )}
    </div>
  );
}
