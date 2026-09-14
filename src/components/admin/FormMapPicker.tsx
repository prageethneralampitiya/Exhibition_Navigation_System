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

const TILE_SOURCES = {
  satellite: {
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
    maxNativeZoom: 20,
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 20,
    maxNativeZoom: 19,
  },
};

interface FormMapPickerProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
  defaultTileMode?: 'satellite' | 'street';
}

export function FormMapPicker({ latitude, longitude, onChange, defaultTileMode = 'satellite' }: FormMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [tileMode, setTileMode] = useState<'satellite' | 'street'>(defaultTileMode);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;

    // Use current lat/lng or default to Kalawana National School campus center if coordinates are missing/0
    const startLat = latitude && latitude !== 0 ? latitude : 6.535472;
    const startLng = longitude && longitude !== 0 ? longitude : 80.401000;

    const map = L.map(containerRef.current, {
      center: [startLat, startLng],
      zoom: 18,
      zoomControl: true,
      attributionControl: false,
    });

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
      tileLayerRef.current = null;
    };
  }, []);

  // Update tile layer whenever tileMode changes (default: satellite)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }
    const cfg = TILE_SOURCES[tileMode];
    const tl = L.tileLayer(cfg.url, {
      maxZoom: cfg.maxZoom,
      maxNativeZoom: cfg.maxNativeZoom,
      subdomains: cfg.subdomains,
    }).addTo(map);
    tl.bringToBack();
    tileLayerRef.current = tl;
  }, [tileMode]);

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

      {/* Tile Mode Toggle: Satellite (default) vs Street */}
      <button
        type="button"
        onClick={() => setTileMode(tileMode === 'satellite' ? 'street' : 'satellite')}
        className="glass"
        style={{
          position: 'absolute',
          top: isFullScreen ? '20px' : '10px',
          right: isFullScreen ? '160px' : '50px',
          zIndex: 100000,
          background: 'rgba(11, 15, 26, 0.85)',
          border: '1px solid var(--color-border)',
          borderRadius: '6px',
          padding: '0.3rem 0.6rem',
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}
        title="Toggle between Satellite and Street map"
      >
        <span>{tileMode === 'satellite' ? '🛰️ Satellite' : '🗺️ Street'}</span>
      </button>

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
