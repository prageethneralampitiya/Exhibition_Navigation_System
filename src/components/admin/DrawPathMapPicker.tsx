import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type NavigationNode, type NavigationEdge, type Store } from '../../lib/supabase';
import { getCampusStoreLocation } from '../KalawanaSchool3DLayer';
import { Maximize2, RotateCcw, Trash2, Check, Satellite, Map, Crosshair, Footprints, Radio } from 'lucide-react';
import { getDistance } from '../../utils/dijkstra';

// ── Tile layer definitions ────────────────────────────────────────────────────
const TILE_LAYERS = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 20, subdomains: ['a', 'b', 'c'] as string[] },
  },
  satellite: {
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    options: { maxZoom: 20, maxNativeZoom: 20, subdomains: ['0', '1', '2', '3'] as string[] },
  },
} as const;

type TileMode = keyof typeof TILE_LAYERS;

// Fix Leaflet default icon paths inside Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A single point in a drawn path.
 * - New click on empty map → { lat, lng }
 * - Click on existing node dot → { lat, lng, existingNodeId, label }  (no new DB node created)
 * - After rename popup → { ..., label: 'custom name' }
 */
export interface DrawPoint {
  lat: number;
  lng: number;
  /** Set when this point snaps to an already-saved NavigationNode. */
  existingNodeId?: string | null;
  /** User-set name. If undefined, defaults to "Node N" using startNodeCounter. */
  label?: string;
}

interface DrawPathMapPickerProps {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  stores: Store[];
  points: DrawPoint[];
  setPoints: Dispatch<SetStateAction<DrawPoint[]>>;
  /** Current active drawing tool. */
  tool: 'draw' | 'erase';
  /** Called when the user toggles the tool inside the fullscreen panel. */
  onToolChange: (t: 'draw' | 'erase') => void;
  /** Called when the user clicks an existing edge in erase mode. */
  onEraseEdge: (edgeId: string) => void;
  /** The first sequential number to assign to new (non-existing) nodes in this session. */
  startNodeCounter: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DrawPathMapPicker({
  nodes,
  edges,
  stores,
  points,
  setPoints,
  tool,
  onToolChange,
  onEraseEdge,
  startNodeCounter,
}: DrawPathMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pathLineRef = useRef<L.Polyline | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [tileMode, setTileMode] = useState<TileMode>('satellite');

  // Refs that keep Leaflet event handlers always current without re-registering
  const toolRef = useRef(tool);
  const setPointsRef = useRef(setPoints);
  const onEraseEdgeRef = useRef(onEraseEdge);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { setPointsRef.current = setPoints; }, [setPoints]);
  useEffect(() => { onEraseEdgeRef.current = onEraseEdge; }, [onEraseEdge]);

  // ── Real-Time Field Calibrator state ──
  const [isLiveCalibrating, setIsLiveCalibrating] = useState(false);
  const [liveCoords, setLiveCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isAutoWalkRecord, setIsAutoWalkRecord] = useState(false);
  const lastRecordedWalkPointRef = useRef<{ lat: number; lng: number } | null>(null);
  const liveMarkerRef = useRef<L.Marker | null>(null);
  const liveCircleRef = useRef<L.Circle | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isLiveCalibrating) {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
      }
      if (liveMarkerRef.current && mapRef.current) {
        mapRef.current.removeLayer(liveMarkerRef.current);
        liveMarkerRef.current = null;
      }
      if (liveCircleRef.current && mapRef.current) {
        mapRef.current.removeLayer(liveCircleRef.current);
        liveCircleRef.current = null;
      }
      setLiveCoords(null);
      setIsAutoWalkRecord(false);
      lastRecordedWalkPointRef.current = null;
      return;
    }

    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      setIsLiveCalibrating(false);
      return;
    }

    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1_000_000) / 1_000_000;
        const lng = Math.round(pos.coords.longitude * 1_000_000) / 1_000_000;
        const accuracy = Math.round(pos.coords.accuracy);
        setLiveCoords({ lat, lng, accuracy });

        const map = mapRef.current;
        if (!map) return;

        const liveIcon = L.divIcon({
          className: 'live-gps-admin-marker',
          html: `<div style="
            width: 22px; height: 22px; border-radius: 50%;
            background: #06b6d4; border: 3px solid #fff;
            box-shadow: 0 0 16px #06b6d4, 0 0 32px rgba(6, 182, 212, 0.6);
            display: flex; align-items: center; justify-content: center;
          "><div style="width: 6px; height: 6px; border-radius: 50%; background: #fff;"></div></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

        if (!liveMarkerRef.current) {
          liveMarkerRef.current = L.marker([lat, lng], { icon: liveIcon, zIndexOffset: 999999 }).addTo(map);
          liveCircleRef.current = L.circle([lat, lng], {
            radius: accuracy,
            color: '#06b6d4',
            fillColor: '#06b6d4',
            fillOpacity: 0.15,
            weight: 1,
            dashArray: '3, 3',
          }).addTo(map);
          map.setView([lat, lng], Math.max(map.getZoom(), 18));
        } else {
          liveMarkerRef.current.setLatLng([lat, lng]);
          if (liveCircleRef.current) {
            liveCircleRef.current.setLatLng([lat, lng]);
            liveCircleRef.current.setRadius(accuracy);
          }
        }

        // Auto Walk & Record: as admin walks >= 4 meters, append point automatically
        if (isAutoWalkRecord) {
          const last = lastRecordedWalkPointRef.current;
          if (!last || getDistance(last.lat, last.lng, lat, lng) >= 4) {
            lastRecordedWalkPointRef.current = { lat, lng };
            setPointsRef.current((prev) => [...prev, { lat, lng }]);
          }
        }
      },
      (err) => {
        console.warn('Live field calibration GPS error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    return () => {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
      }
    };
  }, [isLiveCalibrating, isAutoWalkRecord]);

  // ── Initialize map (once on mount) ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    // Default center: most recently created node, or Kalawana School
    let centerLat = 6.535472;
    let centerLng = 80.401000;
    if (nodes.length > 0) {
      const latest = [...nodes].sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      )[0];
      if (latest?.latitude && latest?.longitude) {
        centerLat = latest.latitude;
        centerLng = latest.longitude;
      }
    }

    const map = L.map(containerRef.current, {
      center: [centerLat, centerLng],
      zoom: 18,
      zoomControl: false,
      attributionControl: false,
    });
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    const initialTile = TILE_LAYERS.street;
    const tl = L.tileLayer(initialTile.url, initialTile.options).addTo(map);
    tileLayerRef.current = tl;

    const markersGroup = L.layerGroup().addTo(map);
    markersGroupRef.current = markersGroup;

    const pathLine = L.polyline([], {
      color: '#6366f1',
      weight: 5,
      opacity: 0.85,
      dashArray: '9, 7',
    }).addTo(map);
    pathLineRef.current = pathLine;

    // Map click → add new point (draw mode only, using ref so always current)
    map.on('click', (e) => {
      if (toolRef.current !== 'draw') return;
      const lat = Math.round(e.latlng.lat * 1_000_000) / 1_000_000;
      const lng = Math.round(e.latlng.lng * 1_000_000) / 1_000_000;
      setPointsRef.current((prev) => [...prev, { lat, lng }]);
    });

    mapRef.current = map;
    setMapReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      pathLineRef.current = null;
      markersGroupRef.current = null;
      tileLayerRef.current = null;
      setMapReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swap tile layer when tileMode changes ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }
    const cfg = TILE_LAYERS[tileMode];
    const tl = L.tileLayer(cfg.url, cfg.options).addTo(map);
    tl.bringToBack();
    tileLayerRef.current = tl;
  }, [tileMode, mapReady]);

  // ── Fullscreen size invalidation ─────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) setTimeout(() => mapRef.current?.invalidateSize(), 150);
  }, [isFullScreen]);

  // ── Cursor style reflects active tool ───────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    mapRef.current.getContainer().style.cursor = tool === 'erase' ? 'crosshair' : '';
  }, [tool, mapReady]);

  // ── Main rendering effect ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;
    const pathLine = pathLineRef.current;
    if (!mapReady || !map || !markersGroup || !pathLine) return;

    markersGroup.clearLayers();
    const eraseMode = tool === 'erase';

    // ── 1. Existing saved edges ────────────────────────────────────────────────
    edges.forEach((edge) => {
      const A = nodes.find((n) => n.id === edge.from_node_id);
      const B = nodes.find((n) => n.id === edge.to_node_id);
      if (!A || !B) return;

      const line = L.polyline(
        [[A.latitude, A.longitude], [B.latitude, B.longitude]],
        {
          color: eraseMode ? 'rgba(239,68,68,0.55)' : 'rgba(99,102,241,0.45)',
          weight: eraseMode ? 6 : 3.5,
          dashArray: '6,6',
          interactive: true,
        }
      ).bindTooltip(
        eraseMode
          ? `🗑️ Erase: ${A.label} ── ${B.label}`
          : `${A.label} ── ${B.label}`,
        { permanent: false, direction: 'top' }
      );

      if (eraseMode) {
        line.on('mouseover', () =>
          line.setStyle({ color: '#ef4444', weight: 9, opacity: 1 })
        );
        line.on('mouseout', () =>
          line.setStyle({ color: 'rgba(239,68,68,0.55)', weight: 6, opacity: 0.8 })
        );
        line.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onEraseEdgeRef.current(edge.id);
        });
      }

      markersGroup.addLayer(line);
    });

    // ── 2. Existing saved nodes (click to snap into current path) ──────────────
    nodes.forEach((node) => {
      const alreadyUsed = points.some((p) => p.existingNodeId === node.id);
      const isStore = node.type === 'store' || !!node.store_id;
      const linkedStore = node.store_id ? stores.find((s) => s.id === node.store_id) : null;

      const tooltipText = eraseMode
        ? node.label
        : alreadyUsed
        ? `✅ In path: ${node.label}`
        : `🔗 Click to connect: ${linkedStore ? `${node.label} (${linkedStore.name})` : node.label}`;

      const dot = L.circleMarker([node.latitude, node.longitude], {
        radius: isStore ? 7 : 5.5,
        fillColor: alreadyUsed
          ? '#f59e0b'
          : isStore
          ? '#a855f7'
          : node.type === 'entrance'
          ? '#22d3ee'
          : '#94a3b8',
        color: '#fff',
        weight: alreadyUsed ? 2.5 : 1.5,
        fillOpacity: 0.88,
        interactive: !eraseMode,
      }).bindTooltip(tooltipText, { permanent: false, direction: 'top' });

      if (!eraseMode) {
        dot.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setPointsRef.current((prev) => [
            ...prev,
            {
              lat: Math.round(node.latitude * 1_000_000) / 1_000_000,
              lng: Math.round(node.longitude * 1_000_000) / 1_000_000,
              existingNodeId: node.id,
              label: node.label,
            },
          ]);
        });
      }

      markersGroup.addLayer(dot);
    });

    // ── 3. Store pins (visual context only) ───────────────────────────────────
    stores.forEach((store, storeIdx) => {
      const campusPos = getCampusStoreLocation(store, storeIdx);
      // Use actual GPS coordinates from DB if present; fall back to campus-grid placement
      const pinLat = (store.latitude != null && !isNaN(store.latitude)) ? store.latitude : campusPos.lat;
      const pinLng = (store.longitude != null && !isNaN(store.longitude)) ? store.longitude : campusPos.lng;

      const isSchool =
        store.id === 'kalawana-national-school-landmark' ||
        store.name.toLowerCase().includes('kalawana');
      const catColor = isSchool ? '#a855f7' : (store.categories?.color || '#6366f1');
      const inner = isSchool
        ? '🏫'
        : store.logo_url
        ? `<img src="${store.logo_url}" alt="${store.name}" style="width:100%;height:100%;object-fit:cover;" />`
        : (store.name[0] || '🏪');

      const pin = L.marker([pinLat, pinLng], {

        icon: L.divIcon({
          html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;background:${catColor};border:2.5px solid #fff;border-radius:50%;color:#fff;font-size:${isSchool ? '0.8rem' : '0.65rem'};font-weight:800;box-shadow:0 2px 8px rgba(0,0,0,0.55);overflow:hidden;">${inner}</div>`,
          className: 'custom-store-pin',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      }).bindTooltip(`🏪 ${store.name}`, { permanent: false, direction: 'top' });

      markersGroup.addLayer(pin);
    });

    // ── 4. Current drawn points ────────────────────────────────────────────────
    // Pre-compute display numbers: only non-existing points get a new number
    let localNewIdx = 0;
    const dispNums: (number | null)[] = points.map((pt) =>
      pt.existingNodeId ? null : startNodeCounter + localNewIdx++
    );

    const lineCoords: [number, number][] = [];

    points.forEach((pt, idx) => {
      lineCoords.push([pt.lat, pt.lng]);

      const isFirst = idx === 0;
      const isLast = idx === points.length - 1 && points.length > 1;
      const isOnly = points.length === 1 && idx === 0;
      const isExisting = !!pt.existingNodeId;
      const num = dispNums[idx];

      const defaultLabel = isExisting
        ? pt.label || 'Existing Node'
        : `Node ${num}`;
      const displayLabel = (pt.label?.trim()) || defaultLabel;

      let bg: string;
      let size: number;
      let innerHtml: string;

      if (isOnly || isFirst) {
        bg = isExisting ? '#f59e0b' : '#22c55e';
        size = 24;
        innerHtml = isExisting
          ? '<span style="font-size:0.7rem;line-height:1">🔗</span>'
          : '<span style="font-size:0.75rem;font-weight:900;line-height:1">S</span>';
      } else if (isLast) {
        bg = isExisting ? '#f59e0b' : '#ef4444';
        size = 24;
        innerHtml = isExisting
          ? '<span style="font-size:0.7rem;line-height:1">🔗</span>'
          : '<span style="font-size:0.75rem;font-weight:900;line-height:1">E</span>';
      } else {
        bg = isExisting ? '#f59e0b' : '#6366f1';
        size = 22;
        innerHtml = isExisting
          ? '<span style="font-size:0.65rem;line-height:1">🔗</span>'
          : `<span style="font-size:0.65rem;font-weight:900;line-height:1">${num}</span>`;
      }

      const canRename = !eraseMode && !isExisting;
      const markerIcon = L.divIcon({
        html: `<div title="${displayLabel}" style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:${bg};border:2px solid #fff;border-radius:50%;color:#fff;box-shadow:0 1px 6px rgba(0,0,0,0.5);cursor:${canRename ? 'pointer' : 'default'}">${innerHtml}</div>`,
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([pt.lat, pt.lng], { icon: markerIcon });

      // Rename popup (draw mode, non-existing nodes)
      if (canRename) {
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);

          const inputId = `rn-${idx}-${Date.now()}`;
          const currentVal = pt.label?.trim() || '';
          const placeholder = `Node ${num}`;

          L.popup({ closeButton: true, maxWidth: 230, className: 'draw-rename-popup' })
            .setLatLng([pt.lat, pt.lng])
            .setContent(`
              <div style="display:flex;flex-direction:column;gap:7px;padding:2px 0;">
                <span style="font-size:0.68rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Rename · ${placeholder}</span>
                <div style="display:flex;gap:5px;">
                  <input id="${inputId}" type="text"
                    value="${currentVal.replace(/"/g, '&quot;')}"
                    placeholder="${placeholder}"
                    style="flex:1;padding:5px 9px;border-radius:5px;border:1.5px solid #6366f1;background:#1a2035;color:#e2e8f0;font-size:0.85rem;min-width:0;outline:none;"
                  />
                  <button id="${inputId}-ok" style="padding:5px 11px;background:#6366f1;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:0.82rem;font-weight:700;">✓</button>
                </div>
                <span style="font-size:0.65rem;color:#64748b;">Leave empty to keep default (${placeholder})</span>
              </div>
            `)
            .openOn(map);

          setTimeout(() => {
            const input = document.getElementById(inputId) as HTMLInputElement | null;
            const okBtn = document.getElementById(`${inputId}-ok`);
            if (!input) return;
            input.focus();
            if (input.value) input.select();

            const doSave = () => {
              const trimmed = input.value.trim();
              setPointsRef.current((prev) =>
                prev.map((p, i) => (i === idx ? { ...p, label: trimmed || undefined } : p))
              );
              map.closePopup();
            };

            input.addEventListener('keydown', (ke) => {
              if (ke.key === 'Enter') doSave();
              if (ke.key === 'Escape') map.closePopup();
            });
            okBtn?.addEventListener('click', doSave);
          }, 100);
        });
      }

      markersGroup.addLayer(marker);
    });

    // ── 5. Connecting line for current drawn path ──────────────────────────────
    pathLine.setLatLngs(lineCoords);
  }, [nodes, edges, stores, points, mapReady, tool, startNodeCounter]);

  // ── UI ──────────────────────────────────────────────────────────────────────
  const wrapperStyle: React.CSSProperties = isFullScreen
    ? { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 99999, background: 'var(--color-bg)' }
    : { width: '100%', height: '100%', position: 'relative' };

  const newPtCount = points.filter((p) => !p.existingNodeId).length;
  const existingPtCount = points.filter((p) => !!p.existingNodeId).length;

  return (
    <div style={wrapperStyle}>
      {/* Dark popup styling + responsive overrides */}
      <style>{`
        .draw-rename-popup .leaflet-popup-content-wrapper {
          background: #0d1526;
          border: 1px solid rgba(99,102,241,0.4);
          color: #e2e8f0;
          border-radius: 10px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.65);
        }
        .draw-rename-popup .leaflet-popup-tip { background: #0d1526; }
        .draw-rename-popup .leaflet-popup-close-button { color: #64748b !important; font-size: 16px !important; }
        .draw-rename-popup .leaflet-popup-close-button:hover { color: #e2e8f0 !important; }
        @media (max-width: 768px) {
          .dpm-info { top:10px!important;left:10px!important;right:10px!important;max-width:calc(100% - 20px)!important; }
          .dpm-actions { bottom:10px!important;top:auto!important;left:10px!important;right:10px!important;flex-wrap:wrap!important; }
        }
      `}</style>

      {/* Map container */}
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

      {/* Inline mode hint bar */}
      {!isFullScreen && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, background: 'rgba(11,15,26,0.95)',
          border: `1px solid ${tool === 'erase' ? 'rgba(239,68,68,0.45)' : 'var(--color-border)'}`,
          borderRadius: 6, padding: '0.3rem 0.85rem',
          fontSize: '0.7rem', fontWeight: 700,
          color: tool === 'erase' ? '#f87171' : 'var(--color-accent)',
          pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          whiteSpace: 'nowrap',
        }}>
          {tool === 'erase'
            ? '🗑️ Click a path line to erase that connection'
            : '📍 Click map → new node · Click dot → connect existing · Click badge → rename'}
        </div>
      )}

      {/* Inline mode: satellite toggle */}
      {!isFullScreen && (
        <button
          type="button"
          onClick={() => setTileMode((m) => m === 'street' ? 'satellite' : 'street')}
          title={tileMode === 'street' ? 'Switch to Satellite view' : 'Switch to Street view'}
          style={{
            position: 'absolute', top: 10, left: 10, zIndex: 1000,
            background: tileMode === 'satellite' ? 'rgba(99,102,241,0.9)' : 'var(--color-surface)',
            border: `1px solid ${tileMode === 'satellite' ? '#818cf8' : 'var(--color-border)'}`,
            width: 32, height: 32, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)', cursor: 'pointer',
            color: tileMode === 'satellite' ? '#fff' : 'var(--color-text)',
            transition: 'all 0.2s',
          }}
        >
          {tileMode === 'street' ? <Satellite size={15} /> : <Map size={15} />}
        </button>
      )}

      {/* Fullscreen overlay panels */}
      {isFullScreen && (
        <>
          {/* Info + tool toggle panel */}
          <div className="dpm-info" style={{
            position: 'absolute', top: 20, left: 20, zIndex: 100000,
            background: 'rgba(13,21,38,0.9)', backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 14, padding: '1.1rem 1.2rem',
            color: 'var(--color-text)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            maxWidth: 296, display: 'flex', flexDirection: 'column', gap: '0.7rem',
            pointerEvents: 'auto',
          }}>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Draw Path</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', marginTop: 3 }}>Waypoint Mapper</div>
            </div>

            {/* Tool toggle */}
            <div style={{ display: 'flex', gap: '0.45rem' }}>
              {(['draw', 'erase'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onToolChange(t)}
                  style={{
                    flex: 1, padding: '0.45rem 0.6rem', borderRadius: 8,
                    border: `1.5px solid ${tool === t ? (t === 'draw' ? '#6366f1' : '#ef4444') : 'rgba(255,255,255,0.1)'}`,
                    background: tool === t
                      ? (t === 'draw' ? 'rgba(99,102,241,0.18)' : 'rgba(239,68,68,0.15)')
                      : 'transparent',
                    color: tool === t
                      ? (t === 'draw' ? '#818cf8' : '#f87171')
                      : 'var(--color-muted)',
                    fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}
                >
                  {t === 'draw' ? '✏️ Draw' : '🗑️ Erase'}
                </button>
              ))}
            </div>

            {/* Stats */}
            <div style={{ padding: '0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.28rem' }}>
              {[
                { label: 'Total points', val: points.length, color: 'var(--color-accent)' },
                { label: 'New nodes', val: newPtCount, color: '#818cf8' },
                { label: 'Connected existing', val: existingPtCount, color: '#f59e0b' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-muted)' }}>{label}</span>
                  <span style={{ fontWeight: 800, color }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Context hint */}
            <div style={{ fontSize: '0.71rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>
              {tool === 'draw' ? (
                <>📍 Click map → new node<br />🔗 Click existing dot → connect<br />✏️ Click numbered badge → rename</>
              ) : (
                <>🗑️ Click any path line to erase it<br />Switch to <strong style={{ color: '#818cf8' }}>Draw</strong> to add points</>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="dpm-actions" style={{
            position: 'absolute', top: 20, right: 20, zIndex: 100000,
            display: 'flex', gap: '0.65rem', pointerEvents: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end',
          }}>
            {/* Live Field Calibrate Toggle */}
            <button
              type="button"
              onClick={() => setIsLiveCalibrating((v) => !v)}
              style={{
                padding: '0.6rem 1rem', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: '0.45rem',
                background: isLiveCalibrating
                  ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.9), rgba(59, 130, 246, 0.9))'
                  : 'rgba(13,21,38,0.9)',
                backdropFilter: 'blur(14px)',
                border: `1px solid ${isLiveCalibrating ? '#06b6d4' : 'var(--color-border)'}`,
                color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
                transition: 'all 0.25s',
              }}
              title="Real-Time Field GPS Calibrator (Walk with phone/tablet)"
            >
              <Radio size={14} className={isLiveCalibrating ? 'live-dot-pulse' : ''} />
              {isLiveCalibrating ? 'Live GPS (Active)' : 'Field Calibrate'}
            </button>

            {/* Satellite / Street toggle */}
            <button
              type="button"
              onClick={() => setTileMode((m) => m === 'street' ? 'satellite' : 'street')}
              title={tileMode === 'street' ? 'Switch to Satellite view' : 'Switch to Street view'}
              style={{
                padding: '0.6rem 1rem', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: '0.45rem',
                background: tileMode === 'satellite'
                  ? 'rgba(99,102,241,0.85)'
                  : 'rgba(13,21,38,0.9)',
                backdropFilter: 'blur(14px)',
                border: `1px solid ${tileMode === 'satellite' ? '#818cf8' : 'var(--color-border)'}`,
                color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
                transition: 'all 0.25s',
              }}
            >
              {tileMode === 'street' ? <Satellite size={14} /> : <Map size={14} />}
              {tileMode === 'street' ? 'Satellite' : 'Street'}
            </button>
            <button
              type="button"
              onClick={() => setPoints((p) => p.slice(0, -1))}
              disabled={points.length === 0}
              className="btn btn-ghost"
              style={{ background: 'rgba(13,21,38,0.9)', backdropFilter: 'blur(14px)', border: '1px solid var(--color-border)', padding: '0.6rem 1rem', borderRadius: 8, display: 'flex', alignItems: 'center', gap: '0.45rem', boxShadow: '0 4px 16px rgba(0,0,0,0.45)' }}
            >
              <RotateCcw size={14} /> Undo
            </button>
            <button
              type="button"
              onClick={() => setPoints([])}
              disabled={points.length === 0}
              className="btn btn-danger"
              style={{ padding: '0.6rem 1rem', borderRadius: 8, display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <Trash2 size={14} /> Clear
            </button>
            <button
              type="button"
              onClick={() => setIsFullScreen(false)}
              className="btn btn-primary"
              style={{ padding: '0.6rem 1.25rem', borderRadius: 8, display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <Check size={15} /> Done
            </button>
          </div>
        </>
      )}

      {/* Inline mode controls */}
      {!isFullScreen && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={() => setIsLiveCalibrating((v) => !v)}
            className="btn btn-ghost btn-sm"
            style={{
              background: isLiveCalibrating ? 'rgba(6, 182, 212, 0.9)' : 'var(--color-surface)',
              border: `1px solid ${isLiveCalibrating ? '#06b6d4' : 'var(--color-border)'}`,
              color: '#fff',
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '0.25rem 0.55rem',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
            title="Real-Time Field GPS Calibrator"
          >
            <Radio size={13} className={isLiveCalibrating ? 'live-dot-pulse' : ''} />
            <span>{isLiveCalibrating ? 'GPS Live' : 'Field Calibrate'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsFullScreen(true)}
            className="btn btn-ghost btn-sm btn-icon"
            style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              width: 32, height: 32, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
            title="Open full screen"
          >
            <Maximize2 size={15} />
          </button>
        </div>
      )}

      {/* Real-time Field Calibrator Floating HUD */}
      {isLiveCalibrating && liveCoords && (
        <div
          style={{
            position: 'absolute',
            bottom: isFullScreen ? 24 : 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            background: 'rgba(11, 15, 26, 0.94)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(6, 182, 212, 0.5)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 16px rgba(6, 182, 212, 0.25)',
            padding: '0.45rem 0.85rem',
            borderRadius: '16px',
            maxWidth: '94vw',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Radio size={14} color="#06b6d4" className="live-dot-pulse" />
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#38bdf8' }}>
              Live GPS: ±{liveCoords.accuracy}m
            </span>
          </div>

          <div style={{ height: '14px', width: '1px', background: 'rgba(255,255,255,0.15)' }} />

          {/* Snap / Drop current point */}
          <button
            type="button"
            onClick={() => {
              setPoints((prev) => [...prev, { lat: liveCoords.lat, lng: liveCoords.lng }]);
              lastRecordedWalkPointRef.current = { lat: liveCoords.lat, lng: liveCoords.lng };
            }}
            className="btn btn-sm"
            style={{
              padding: '0.3rem 0.65rem',
              fontSize: '0.73rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              cursor: 'pointer',
            }}
            title="Drop a node point at your exact physical location"
          >
            <Crosshair size={13} />
            Snap / Drop Point Here
          </button>

          {/* Walk & Trace auto-recorder */}
          <button
            type="button"
            onClick={() => setIsAutoWalkRecord((v) => !v)}
            className="btn btn-sm"
            style={{
              padding: '0.3rem 0.65rem',
              fontSize: '0.73rem',
              fontWeight: 700,
              background: isAutoWalkRecord ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
              border: `1px solid ${isAutoWalkRecord ? '#ef4444' : 'rgba(255, 255, 255, 0.15)'}`,
              color: isAutoWalkRecord ? '#f87171' : 'var(--color-text)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              cursor: 'pointer',
            }}
            title="Automatically drop waypoints every 4 meters as you walk the corridor"
          >
            <Footprints size={13} />
            {isAutoWalkRecord ? 'Tracing Active (Walk)' : 'Walk & Trace'}
          </button>

          {/* Center Map on GPS */}
          <button
            type="button"
            onClick={() => mapRef.current?.setView([liveCoords.lat, liveCoords.lng], 19)}
            className="btn btn-ghost btn-sm btn-icon"
            style={{ width: 28, height: 28, padding: 0, borderRadius: '6px' }}
            title="Center map on my live GPS"
          >
            <Crosshair size={13} />
          </button>
        </div>
      )}

      {/* Map legend */}
      <div style={{
        position: 'absolute', bottom: 10, right: 10,
        background: 'rgba(13,21,38,0.92)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 8, padding: '8px 12px', color: '#fff',
        fontSize: '0.7rem', display: 'flex', flexDirection: 'column', gap: 5,
        zIndex: 1000, pointerEvents: 'none',
      }}>
        <div style={{ fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 3, marginBottom: 2, color: 'var(--color-accent)', fontSize: '0.73rem', letterSpacing: '0.03em' }}>LEGEND</div>
        {[
          { color: '#22c55e', label: 'Start (first click)' },
          { color: '#ef4444', label: 'End (last click)' },
          { color: '#6366f1', label: 'New waypoint (click badge to rename)' },
          { color: '#f59e0b', label: 'Connected existing node' },
          { color: '#94a3b8', label: 'Existing nodes (click to connect)' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: color, border: '1.5px solid #fff', flexShrink: 0 }} />
            <span>{label}</span>
          </div>
        ))}
        {tool === 'erase' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 5 }}>
            <div style={{ width: 14, height: 0, borderTop: '3px solid #ef4444', flexShrink: 0 }} />
            <span style={{ color: '#f87171' }}>Click path to erase it</span>
          </div>
        )}
      </div>
    </div>
  );
}
