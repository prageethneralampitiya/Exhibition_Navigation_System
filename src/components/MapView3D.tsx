import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre GL v6 + Vite: must set worker URL before any Map instance is created.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { type Store, type NavigationNode, type NavigationEdge } from '../lib/supabase';
import { createKalawanaSchool3DLayer, fetchCalibrationFromSupabase } from './KalawanaSchool3DLayer';

// Register worker — safe to call multiple times (idempotent)
maplibregl.setWorkerUrl(workerUrl as unknown as string);

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

interface MapView3DProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  stores?: Store[];
  userLat?: number | null;
  userLng?: number | null;
  route?: NavigationNode[];
  showGraphMesh?: boolean;
  nodes?: NavigationNode[];
  edges?: NavigationEdge[];
  showSchoolBoundary?: boolean;
}

export function MapView3D({
  latitude,
  longitude,
  zoom = 18,
  stores = [],
  userLat = null,
  userLng = null,
  route = [],
  showGraphMesh = false,
  nodes = [],
  edges = [],
  showSchoolBoundary = true,
}: MapView3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const storeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const lastFittedDestRef = useRef<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const isUserInteractingRef = useRef(false);
  const prevCenterRef = useRef<{ lat: number; lng: number }>({ lat: latitude, lng: longitude });

  // ── 1. Initialise MapLibre map (once on mount) ───────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const m = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [longitude, latitude],
      zoom,
      pitch: 55,
      bearing: -15,
      attributionControl: false,
      dragPan: true,
      dragRotate: true,
      scrollZoom: true,
      touchZoomRotate: true,
      doubleClickZoom: true,
      keyboard: true,
    });

    mapRef.current = m;

    m.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'bottom-right'
    );

    const handleMoveStart = (e: maplibregl.MapLibreEvent) => {
      if (e.originalEvent) {
        isUserInteractingRef.current = true;
      }
    };
    const handleMoveEnd = () => {
      setTimeout(() => {
        isUserInteractingRef.current = false;
      }, 400);
    };

    m.on('movestart', handleMoveStart);
    m.on('moveend', handleMoveEnd);

    // ResizeObserver to handle canvas resizing automatically
    const resizeObserver = new ResizeObserver(() => {
      m.resize();
    });
    resizeObserver.observe(containerRef.current);

    m.on('error', (e) => console.error('[MapView3D]', e));

    m.on('load', () => {
      // ── Dark theme overrides ─────────────────────────────────
      if (m.getLayer('background'))
        m.setPaintProperty('background', 'background-color', '#0d1117');
      if (m.getLayer('water'))
        m.setPaintProperty('water', 'fill-color', '#0a1628');
      [
        'highway_minor',
        'highway_major_inner',
        'highway_major_casing',
        'highway_motorway_inner',
        'highway_motorway_casing',
      ].forEach((id) => {
        if (m.getLayer(id)) m.setPaintProperty(id, 'line-color', '#1e2a3a');
      });
      if (m.getLayer('building')) {
        m.setPaintProperty('building', 'fill-color', '#1a2035');
        m.setPaintProperty('building', 'fill-outline-color', '#0f3460');
      }

      // ── Three.js Kalawana National School 3D Layer ──────────
      if (!m.getLayer('kalawana-school-3d')) {
        const layer = createKalawanaSchool3DLayer('kalawana-school-3d');
        m.addLayer(layer);

        // Sync global calibration from Supabase database for cross-browser consistency
        fetchCalibrationFromSupabase().then((remoteConfig) => {
          if (remoteConfig) {
            layer.setCalibration(remoteConfig, false);
          }
        });
      }

      // ── Kalawana School Grounds Perimeter Boundary ─────────
      if (!m.getSource('school-campus-boundary')) {
        m.addSource('school-campus-boundary', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [80.3992, 6.5342],
                [80.4024, 6.5342],
                [80.4024, 6.5365],
                [80.3992, 6.5365],
                [80.3992, 6.5342],
              ]],
            },
          },
        });

        m.addLayer({
          id: 'school-boundary-fill',
          type: 'fill',
          source: 'school-campus-boundary',
          paint: { 'fill-color': '#6366f1', 'fill-opacity': 0.08 },
        });

        m.addLayer({
          id: 'school-boundary-line',
          type: 'line',
          source: 'school-campus-boundary',
          paint: {
            'line-color': '#a855f7',
            'line-width': 3,
            'line-opacity': 0.9,
            'line-dasharray': [4, 2],
          },
        });
      }

      setMapLoaded(true);
    });

    return () => {
      resizeObserver.disconnect();
      m.off('movestart', handleMoveStart);
      m.off('moveend', handleMoveEnd);
      m.remove();
      mapRef.current = null;
      storeMarkersRef.current = [];
      userMarkerRef.current = null;
      lastFittedDestRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once — lat/lng on mount only

  // ── Sync School Boundary Visibility ──────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapLoaded) return;
    const visibility = showSchoolBoundary ? 'visible' : 'none';
    if (m.getLayer('school-boundary-fill')) {
      m.setLayoutProperty('school-boundary-fill', 'visibility', visibility);
    }
    if (m.getLayer('school-boundary-line')) {
      m.setLayoutProperty('school-boundary-line', 'visibility', visibility);
    }
  }, [mapLoaded, showSchoolBoundary]);

  // ── 2. Re-centre when parent signals recenter (no active route) ─
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const latChanged = prevCenterRef.current.lat !== latitude;
    const lngChanged = prevCenterRef.current.lng !== longitude;
    prevCenterRef.current = { lat: latitude, lng: longitude };

    if ((latChanged || lngChanged) && route.length === 0 && !isUserInteractingRef.current) {
      m.flyTo({ center: [longitude, latitude], zoom, duration: 600 });
    }
  }, [latitude, longitude, zoom, route.length]);

  // ── 3. Store markers ─────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapLoaded) return;

    storeMarkersRef.current.forEach((mk) => mk.remove());
    storeMarkersRef.current = [];

    stores.forEach((store) => {
      // Stores arrive pre-positioned from the parent (MapPage) — use as-is
      if (!store.latitude || !store.longitude) return;

      const isDestination =
        route.length > 0 && route[route.length - 1].store_id === store.id;
      const catColor = store.categories?.color || '#6366f1';

      const container = document.createElement('div');
      container.style.cssText = 'cursor:pointer;position:relative;display:inline-flex;width:fit-content;';

      const inner = document.createElement('div');
      inner.style.cssText = `
        width:${isDestination ? 36 : 28}px;
        height:${isDestination ? 36 : 28}px;
        border-radius:50%;
        background:${catColor};
        border:2.5px solid #fff;
        box-shadow:${isDestination ? `0 0 0 5px ${catColor}44,` : ''}0 2px 8px rgba(0,0,0,0.65);
        display:flex;align-items:center;justify-content:center;
        color:#fff;font-size:0.68rem;font-weight:800;
        overflow:hidden;
        transition:transform 0.15s ease;
      `;
      if (store.logo_url) {
        const img = document.createElement('img');
        img.src = store.logo_url;
        img.alt = store.name;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        inner.appendChild(img);
      } else {
        inner.textContent = store.name?.[0]?.toUpperCase() ?? '?';
      }

      container.appendChild(inner);

      container.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.25)'; });
      container.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });

      const popup = new maplibregl.Popup({ offset: 20, closeButton: false })
        .setHTML(`
          <div style="color:#0b0f1a;font-family:sans-serif;min-width:130px;padding:0.1rem;">
            <h4 style="margin:0 0 0.2rem;font-weight:800;font-size:0.9rem;">${store.name}</h4>
            <p style="margin:0 0 0.4rem;font-size:0.72rem;color:#64748b;">
              Floor ${store.floor || '1'} · ${store.categories?.name || 'Exhibitor'}
            </p>
            <a href="/stores/${store.id}"
              style="display:block;background:#6366f1;color:#fff;padding:0.3rem;border-radius:4px;
                     font-size:0.72rem;font-weight:700;text-decoration:none;text-align:center;">
              View Profile
            </a>
          </div>
        `);

      const marker = new maplibregl.Marker({ element: container, anchor: 'center' })
        .setLngLat([store.longitude, store.latitude])
        .setPopup(popup)
        .addTo(m);

      storeMarkersRef.current.push(marker);
    });
  }, [mapLoaded, stores, route]);

  // ── 4. User location marker ──────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapLoaded) return;

    if (userLat !== null && userLng !== null) {
      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([userLng, userLat]);
      } else {
        const el = document.createElement('div');
        el.className = 'mv3d-user-dot';
        el.style.cssText = `
          width:14px;height:14px;border-radius:50%;
          background:#22d3ee;border:2px solid #fff;
          box-shadow:0 0 6px rgba(34,211,238,0.6);
        `;
        userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([userLng, userLat])
          .addTo(m);
      }
    } else {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
    }
  }, [mapLoaded, userLat, userLng]);

  // ── 5. Route polyline ────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapLoaded) return;

    const SRC = 'route3d';
    const CASING = 'route3d-casing';
    const CORE = 'route3d-core';

    if (route.length < 2) {
      if (m.getLayer(CORE)) m.removeLayer(CORE);
      if (m.getLayer(CASING)) m.removeLayer(CASING);
      if (m.getSource(SRC)) m.removeSource(SRC);
      lastFittedDestRef.current = null;
      return;
    }

    const coords: [number, number][] = route.map((n) => [n.longitude, n.latitude]);
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: coords },
      }],
    };

    if (m.getSource(SRC)) {
      (m.getSource(SRC) as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      m.addSource(SRC, { type: 'geojson', data: geojson });
      m.addLayer({
        id: CASING,
        type: 'line',
        source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#4f46e5', 'line-width': 12, 'line-opacity': 0.35 },
      });
      m.addLayer({
        id: CORE,
        type: 'line',
        source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#6366f1', 'line-width': 6, 'line-opacity': 1.0 },
      });
    }

    // Fit bounds only when destination changes
    const destId = route[route.length - 1].id;
    if (destId !== lastFittedDestRef.current) {
      lastFittedDestRef.current = destId;
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      m.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 80, duration: 900 }
      );
    }
  }, [mapLoaded, route]);

  // ── 6. Graph mesh (admin) ────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapLoaded) return;

    if (m.getLayer('mesh-nodes')) m.removeLayer('mesh-nodes');
    if (m.getLayer('mesh-edges')) m.removeLayer('mesh-edges');
    if (m.getSource('mesh')) m.removeSource('mesh');

    if (!showGraphMesh || nodes.length === 0) return;

    const edgeFeatures = edges
      .map((edge) => {
        const from = nodes.find((n) => n.id === edge.from_node_id);
        const to = nodes.find((n) => n.id === edge.to_node_id);
        if (!from || !to) return null;
        return {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]],
          },
        };
      })
      .filter(Boolean);

    const nodeFeatures = nodes.map((node) => ({
      type: 'Feature' as const,
      properties: { type: node.type, label: node.label },
      geometry: {
        type: 'Point' as const,
        coordinates: [node.longitude, node.latitude],
      },
    }));

    m.addSource('mesh', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [...edgeFeatures, ...nodeFeatures] as never[],
      },
    });
    m.addLayer({
      id: 'mesh-edges',
      type: 'line',
      source: 'mesh',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': 'rgba(34,211,238,0.45)',
        'line-width': 2,
        'line-dasharray': [5, 5],
      },
    });
    m.addLayer({
      id: 'mesh-nodes',
      type: 'circle',
      source: 'mesh',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5.5,
        'circle-color': [
          'match', ['get', 'type'],
          'entrance', '#22d3ee',
          'poi', '#a78bfa',
          'store', '#34d399',
          'emergency', '#f43f5e',
          '#94a3b8',
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff',
        'circle-opacity': 0.9,
      },
    });
  }, [mapLoaded, showGraphMesh, nodes, edges]);

  return (
    <>
      {/* Pulsing animation for user dot */}
      <style>{`
        .mv3d-user-dot {
          animation: mv3d-ping 1.6s infinite ease-out;
        }
        @keyframes mv3d-ping {
          0%   { box-shadow: 0 0 0 0   rgba(34,211,238,0.55), 0 0 6px rgba(34,211,238,0.6); }
          70%  { box-shadow: 0 0 0 12px rgba(34,211,238,0),   0 0 6px rgba(34,211,238,0.6); }
          100% { box-shadow: 0 0 0 0   rgba(34,211,238,0),   0 0 6px rgba(34,211,238,0.6); }
        }
        /* Match Leaflet MapView style on the MapLibre controls */
        .mv3d-wrap .maplibregl-ctrl-group {
          background: rgba(10,10,26,0.85) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          backdrop-filter: blur(12px) !important;
          border-radius: 10px !important;
        }
        .mv3d-wrap .maplibregl-ctrl-group button { background: none !important; }
        .mv3d-wrap .maplibregl-ctrl-group button span { filter: invert(1) !important; }
        .mv3d-wrap .maplibregl-ctrl-compass { filter: invert(1) !important; }
      `}</style>
      <div
        ref={containerRef}
        className="mv3d-wrap"
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      />
    </>
  );
}
