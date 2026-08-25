import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type Store, type NavigationNode, type NavigationEdge } from '../lib/supabase';

// Fix Leaflet default icon paths (important for vanilla leaflet in Vite)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MapViewProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  stores?: Store[];
  userLat?: number | null;
  userLng?: number | null;
  userHeading?: number | null;
  route?: NavigationNode[];
  theme?: 'dark' | 'streets' | 'light';
  showGraphMesh?: boolean;
  nodes?: NavigationNode[];
  edges?: NavigationEdge[];
  onMapClick?: (lat: number, lng: number) => void;
  onSelectStore?: (storeId: string) => void;
  outdoorSegmentCount?: number;
  tourStops?: Store[];
  visitedStallIds?: string[];
}

export function MapView({
  latitude,
  longitude,
  zoom = 18,
  stores = [],
  userLat = null,
  userLng = null,
  userHeading = null,
  route = [],
  theme = 'dark',
  showGraphMesh = false,
  nodes = [],
  edges = [],
  onMapClick,
  onSelectStore,
  outdoorSegmentCount = 0,
  tourStops = [],
  visitedStallIds = [],
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);

  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    (window as any).__onNavigateToStore = (id: string) => {
      if (onSelectStore) {
        onSelectStore(id);
      }
    };
    return () => {
      delete (window as any).__onNavigateToStore;
    };
  }, [onSelectStore]);
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.FeatureGroup | null>(null);
  const meshLayerRef = useRef<L.FeatureGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  // Tracks the last destination node ID whose bounds we fitted, so we only
  // call fitBounds once when a new route is first drawn — never on GPS updates.
  const lastFittedDestRef = useRef<string | null>(null);
  const isUserInteractingRef = useRef(false);
  const prevCenterRef = useRef<{ lat: number; lng: number }>({ lat: latitude, lng: longitude });

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Create Map instance with explicit gesture and interaction configurations
    const newMap = L.map(mapContainerRef.current, {
      center: [latitude, longitude],
      zoom,
      zoomControl: false, // Positioned at bottomright below to avoid header overlay overlap
      attributionControl: false,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
      scrollWheelZoom: true,
      boxZoom: true,
      keyboard: true,
      bounceAtZoomLimits: false,
    });

    // Reposition zoom controls at bottom-right so top header bar doesn't block them
    L.control.zoom({ position: 'bottomright' }).addTo(newMap);

    // Track user gesture interactions to avoid snapping map during active pan/zoom
    const handleTouchOrDragStart = () => {
      isUserInteractingRef.current = true;
    };
    const handleTouchOrDragEnd = () => {
      setTimeout(() => {
        isUserInteractingRef.current = false;
      }, 400);
    };

    newMap.on('dragstart zoomstart movestart', handleTouchOrDragStart);
    newMap.on('dragend zoomend moveend', handleTouchOrDragEnd);

    // ResizeObserver to continuously handle layout / flexbox container recalculations
    const resizeObserver = new ResizeObserver(() => {
      newMap.invalidateSize({ animate: false });
    });
    resizeObserver.observe(mapContainerRef.current);

    // Click listener for custom mock positioning
    newMap.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
    });

    // Add scale bar control
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(newMap);

    // Track zoom end
    newMap.on('zoomend', () => {
      setCurrentZoom(newMap.getZoom());
    });

    // Create Layer groups
    const markersLayer = L.layerGroup().addTo(newMap);
    markersLayerRef.current = markersLayer;

    const routeLayer = L.featureGroup().addTo(newMap);
    routeLayerRef.current = routeLayer;

    const meshLayer = L.featureGroup().addTo(newMap);
    meshLayerRef.current = meshLayer;

    setMap(newMap);

    // Clean up on unmount
    return () => {
      resizeObserver.disconnect();
      newMap.off('dragstart zoomstart movestart', handleTouchOrDragStart);
      newMap.off('dragend zoomend moveend', handleTouchOrDragEnd);
      newMap.remove();
      setMap(null);
      markersLayerRef.current = null;
      routeLayerRef.current = null;
      meshLayerRef.current = null;
      tileLayerRef.current = null;
    };
  }, []); // Run once on mount only — do NOT include lat/lng/zoom here

  // 2. Tile Layer Theme Manager
  useEffect(() => {
    if (!map) return;

    // Remove existing tile layer
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    let url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
    if (theme === 'streets') {
      url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    } else if (theme === 'light') {
      url = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
    }

    const tileLayer = L.tileLayer(url, { maxZoom: 20 });
    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;

    // Move to back
    tileLayer.bringToBack();
  }, [map, theme]);

  // 3. Update view center when the parent explicitly re-centers (no active route)
  // Only setView if the target coordinates actually changed AND user is not actively panning/zooming.
  useEffect(() => {
    if (!map) return;
    const latChanged = prevCenterRef.current.lat !== latitude;
    const lngChanged = prevCenterRef.current.lng !== longitude;
    prevCenterRef.current = { lat: latitude, lng: longitude };

    if ((latChanged || lngChanged) && route.length === 0 && !isUserInteractingRef.current) {
      map.setView([latitude, longitude], zoom, { animate: true });
    }
  }, [map, latitude, longitude, zoom, route.length]);

  // 4. Render Store Markers
  useEffect(() => {
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    // Clear existing markers
    markersLayer.clearLayers();

    stores.forEach((store) => {
      if (store.latitude === null || store.longitude === null) return;

      const isSchool = store.id === 'kalawana-national-school-landmark' || store.name.toLowerCase().includes('kalawana');
      const catColor = isSchool ? '#a855f7' : (store.categories?.color || 'var(--color-primary)');
      const isDestination = route.length > 0 && route[route.length - 1].store_id === store.id;

      // Tour stop index & visited status
      const tourStopIdx = tourStops.findIndex((s) => s.id === store.id);
      const isTourStop = tourStopIdx !== -1;
      const isVisited = visitedStallIds.includes(store.id);

      // Custom HTML pin (adds pulse effect if this store is the destination or Kalawana School)
      const customIcon = L.divIcon({
        className: 'custom-map-pin-wrapper',
        html: `
          <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px;">
            ${isDestination || isSchool || (isTourStop && !isVisited) ? `
              <div style="
                position: absolute;
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: ${catColor};
                opacity: 0.4;
                animation: map-pin-pulse 1.8s infinite ease-in-out;
              "></div>
            ` : ''}
            <div style="
              width: 30px;
              height: 30px;
              border-radius: 50%;
              background: ${isVisited ? '#16a34a' : catColor};
              border: 2.5px solid #fff;
              box-shadow: 0 2px 10px rgba(0,0,0,0.6);
              display: flex;
              align-items: center;
              justify-content: center;
              color: #fff;
              font-size: ${isSchool ? '0.9rem' : '0.75rem'};
              font-weight: 800;
              z-index: 10;
              overflow: hidden;
            ">
              ${isSchool ? '🏫' : (store.logo_url ? `
                <img src="${store.logo_url}" alt="${store.name}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
              ` : `
                ${store.name[0]}
              `)}
            </div>
            ${isTourStop ? `
              <div style="
                position: absolute;
                top: -6px;
                right: -6px;
                background: ${isVisited ? '#22c55e' : '#22d3ee'};
                color: ${isVisited ? '#fff' : '#0f172a'};
                font-size: 0.65rem;
                font-weight: 900;
                width: 17px;
                height: 17px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1.5px solid #fff;
                box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                z-index: 20;
              ">
                ${isVisited ? '✓' : tourStopIdx + 1}
              </div>
            ` : ''}
          </div>
          <style>
            @keyframes map-pin-pulse {
              0% { transform: scale(0.6); opacity: 0.7; }
              100% { transform: scale(1.6); opacity: 0; }
            }
          </style>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      const marker = L.marker([store.latitude, store.longitude], { icon: customIcon });

      // Info bubble popup with detail link
      marker.bindPopup(`
        <div style="color: #0b0f1a; padding: 0.3rem; font-family: sans-serif; min-width: 160px;">
          <h4 style="margin: 0 0 0.25rem 0; font-weight: 800; font-size: 0.95rem; line-height: 1.2;">${store.name}</h4>
          <p style="margin: 0 0 0.5rem 0; font-size: 0.75rem; color: #64748b;">
            ${isSchool ? 'GCP2+5C6, Kalawana · Sri Lanka' : `Floor: ${store.floor || '1'} · ${store.categories?.name || 'Exhibitor'}`}
          </p>
          ${isSchool ? `
            <a href="/map3d" style="
              display: block;
              background: linear-gradient(135deg, #a855f7, #6366f1);
              color: #fff;
              padding: 0.4rem;
              border-radius: 6px;
              font-size: 0.75rem;
              font-weight: 700;
              text-decoration: none;
              text-align: center;
              box-shadow: 0 2px 8px rgba(168,85,247,0.3);
            ">🏫 Open 3D School Map</a>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 0.35rem;">
              <button onclick="window.__onNavigateToStore && window.__onNavigateToStore('${store.id}')" style="
                display: block;
                width: 100%;
                background: linear-gradient(135deg, #06b6d4, #3b82f6);
                color: #fff;
                padding: 0.38rem 0.5rem;
                border: none;
                border-radius: 6px;
                font-size: 0.75rem;
                font-weight: 700;
                cursor: pointer;
                text-align: center;
                box-shadow: 0 2px 6px rgba(6,182,212,0.3);
              ">🧭 Navigate Here</button>
              <a href="/stores/${store.id}" style="
                display: block;
                background: rgba(255,255,255,0.08);
                border: 1px solid rgba(0,0,0,0.1);
                color: #334155;
                padding: 0.3rem;
                border-radius: 6px;
                font-size: 0.72rem;
                font-weight: 600;
                text-decoration: none;
                text-align: center;
              ">View Profile</a>
            </div>
          `}
        </div>
      `);

      markersLayer.addLayer(marker);
    });
  }, [map, stores, route, onSelectStore, tourStops, visitedStallIds]);

  // 5. Render User Location Marker (with Direction Cone)
  useEffect(() => {
    if (!map) return;

    if (userLat !== null && userLng !== null) {
      const hasHeading = userHeading !== null && userHeading !== undefined;

      const userIcon = L.divIcon({
        className: 'user-map-pin',
        html: `
          <div style="position: relative;">
            ${hasHeading ? `
              <div class="user-direction-cone" style="
                position: absolute;
                width: 80px;
                height: 80px;
                top: -33px;
                left: -33px;
                background: conic-gradient(from 335deg, transparent 0deg, rgba(34, 211, 238, 0.4) 25deg, transparent 50deg, transparent 360deg);
                border-radius: 50%;
                transform: rotate(${userHeading}deg);
                pointer-events: none;
                z-index: -1;
              "></div>
            ` : ''}
            <div style="
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: #22d3ee;
              border: 2px solid #fff;
              box-shadow: 0 0 6px rgba(34,211,238,0.6);
            "></div>
            <div style="
              position: absolute;
              inset: -8px;
              border-radius: 50%;
              border: 2px solid rgba(34,211,238,0.4);
              animation: map-ping 1.6s infinite ease-out;
            "></div>
          </div>
        `,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([userLat, userLng]);
        userMarkerRef.current.setIcon(userIcon);
      } else {
        userMarkerRef.current = L.marker([userLat, userLng], { icon: userIcon }).addTo(map);
      }
    } else {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
    }
  }, [map, userLat, userLng, userHeading]);

  // 6. Render Route Polyline
  useEffect(() => {
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;

    // Clear existing route drawings
    routeLayer.clearLayers();

    if (!route || route.length < 2) {
      // Route was cleared — reset the fitted-destination tracker
      lastFittedDestRef.current = null;
      return;
    }

    // Split route into outdoor (OSM streets) and indoor (drawn graph) segments
    const hasOutdoor = outdoorSegmentCount > 0 && outdoorSegmentCount < route.length;
    const outdoorCoords = hasOutdoor
      ? route.slice(0, outdoorSegmentCount + 1).map((n) => [n.latitude, n.longitude] as [number, number])
      : [];
    const indoorCoords = hasOutdoor
      ? route.slice(outdoorSegmentCount).map((n) => [n.latitude, n.longitude] as [number, number])
      : route.map((n) => [n.latitude, n.longitude] as [number, number]);

    // ── Outdoor segment: warm orange dashed line (OSM streets) ────────────────
    if (hasOutdoor && outdoorCoords.length > 1) {
      // Glow casing
      routeLayer.addLayer(L.polyline(outdoorCoords, {
        color: 'rgba(251, 146, 60, 0.22)',
        weight: 14,
        lineCap: 'round',
        lineJoin: 'round',
      }));
      // Dashed orange core
      routeLayer.addLayer(L.polyline(outdoorCoords, {
        color: '#fb923c',
        weight: 5,
        opacity: 0.95,
        dashArray: '12, 8',
        lineCap: 'round',
        lineJoin: 'round',
      }));
      // Walking person icon at start of outdoor segment
      const startNode = route[0];
      const walkerIcon = L.divIcon({
        className: '',
        html: `<div style="
          background: #fb923c;
          border: 2px solid #fff;
          border-radius: 50%;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          box-shadow: 0 2px 8px rgba(251,146,60,0.5);
        ">🚶</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      routeLayer.addLayer(L.marker([startNode.latitude, startNode.longitude], { icon: walkerIcon }));
    }

    // ── Indoor segment: cyan dotted line (drawn walkway graph) ───────────────
    if (indoorCoords.length > 1) {
      // Glow casing
      routeLayer.addLayer(L.polyline(indoorCoords, {
        color: 'rgba(34, 211, 238, 0.22)',
        weight: 12,
        lineCap: 'round',
        lineJoin: 'round',
      }));
      // Dotted cyan core
      routeLayer.addLayer(L.polyline(indoorCoords, {
        color: '#22d3ee',
        weight: 6,
        opacity: 1.0,
        dashArray: '0, 14',
        lineCap: 'round',
        lineJoin: 'round',
      }));
    }

    // Junction marker between outdoor and indoor (entrance icon)
    if (hasOutdoor && outdoorSegmentCount < route.length) {
      const junctionNode = route[outdoorSegmentCount];
      const entranceIcon = L.divIcon({
        className: '',
        html: `<div style="
          background: linear-gradient(135deg, #fb923c, #22d3ee);
          border: 2px solid #fff;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        ">🏫</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      routeLayer.addLayer(L.marker([junctionNode.latitude, junctionNode.longitude], { icon: entranceIcon }));
    }

    // Only fit bounds when the DESTINATION changes (i.e. a new route is chosen).
    const allCoords = route.map((n) => [n.latitude, n.longitude] as [number, number]);
    const fullLine = L.polyline(allCoords);
    const destId = route[route.length - 1].id;
    if (destId !== lastFittedDestRef.current) {
      lastFittedDestRef.current = destId;
      map.fitBounds(fullLine.getBounds(), { padding: [60, 60] });
    }
  }, [map, route, outdoorSegmentCount]);

  // 7. Draw Graph Mesh (Admin only)
  useEffect(() => {
    const meshLayer = meshLayerRef.current;
    if (!map || !meshLayer) return;

    meshLayer.clearLayers();

    if (!showGraphMesh || nodes.length === 0) return;

    // 1. Draw connecting edges
    edges.forEach((edge) => {
      const fromNode = nodes.find((n) => n.id === edge.from_node_id);
      const toNode = nodes.find((n) => n.id === edge.to_node_id);
      if (fromNode && toNode) {
        const line = L.polyline(
          [
            [fromNode.latitude, fromNode.longitude],
            [toNode.latitude, toNode.longitude],
          ],
          {
            color: 'rgba(34, 211, 238, 0.45)', // cyan glow
            weight: 2,
            dashArray: '5, 5',
          }
        );
        meshLayer.addLayer(line);
      }
    });

    // 2. Draw nodes dots
    nodes.forEach((node) => {
      let color = '#94a3b8'; // default grey path
      if (node.type === 'entrance') color = '#22d3ee';
      else if (node.type === 'poi') color = '#a78bfa';
      else if (node.type === 'store') color = '#34d399';
      else if (node.type === 'emergency') color = '#f43f5e';

      const circle = L.circleMarker([node.latitude, node.longitude], {
        radius: 5.5,
        fillColor: color,
        color: '#fff',
        weight: 1.5,
        fillOpacity: 0.9,
      }).bindTooltip(node.label, { permanent: false, direction: 'top' });

      meshLayer.addLayer(circle);
    });
  }, [map, showGraphMesh, nodes, edges]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={mapContainerRef}
        className="map-container"
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
      {map && (
        <div style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          background: 'rgba(11, 15, 26, 0.85)',
          backdropFilter: 'blur(4px)',
          border: '1px solid var(--color-border)',
          padding: '4px 8px',
          borderRadius: '6px',
          fontSize: '0.72rem',
          fontWeight: '700',
          color: 'var(--color-text)',
          zIndex: 1000,
          pointerEvents: 'none',
          letterSpacing: '0.04em',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <span style={{ color: 'var(--color-accent)' }}>ZOOM:</span>
          <span>{currentZoom.toFixed(1)}x</span>
        </div>
      )}
    </div>
  );
}
