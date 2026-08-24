import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type NavigationNode, type NavigationEdge, type Store } from '../../lib/supabase';
import { getCampusStoreLocation } from '../KalawanaSchool3DLayer';
import { Maximize2, RotateCcw, Trash2, Check } from 'lucide-react';

// Fix Leaflet default icon paths inside Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface DrawPathMapPickerProps {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  stores: Store[];
  startNodeId: string;
  endNodeId: string;
  points: Array<{ lat: number; lng: number }>;
  setPoints: Dispatch<SetStateAction<Array<{ lat: number; lng: number }>>>;
}

export function DrawPathMapPicker({
  nodes,
  edges,
  stores,
  startNodeId,
  endNodeId,
  points,
  setPoints,
}: DrawPathMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pathLineRef = useRef<L.Polyline | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;

    // Default center: Kalawana National School Exhibition Campus
    let centerLat = 6.535472;
    let centerLng = 80.401000;

    // Load the last drawing place (most recently created node coordinates)
    if (nodes && nodes.length > 0) {
      const latestNode = [...nodes].sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
      })[0];
      
      if (latestNode && latestNode.latitude !== 0 && latestNode.longitude !== 0) {
        centerLat = latestNode.latitude;
        centerLng = latestNode.longitude;
      }
    }

    const map = L.map(containerRef.current, {
      center: [centerLat, centerLng],
      zoom: 18,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    markersGroupRef.current = markersGroup;

    const pathLine = L.polyline([], {
      color: '#6366f1',
      weight: 5,
      opacity: 0.8,
      dashArray: '8, 8',
    }).addTo(map);
    pathLineRef.current = pathLine;

    mapRef.current = map;
    setMapReady(true);

    // Map click handler to append custom path points
    map.on('click', (e) => {
      const roundedLat = Math.round(e.latlng.lat * 1000000) / 1000000;
      const roundedLng = Math.round(e.latlng.lng * 1000000) / 1000000;
      setPoints((prev) => [...prev, { lat: roundedLat, lng: roundedLng }]);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      pathLineRef.current = null;
      markersGroupRef.current = null;
      setMapReady(false);
    };
  }, [setPoints, nodes]); // Run once on mount/load

  // Pan to start node when selected/changed (if it's not a new node)
  useEffect(() => {
    if (!mapReady || !mapRef.current || startNodeId === 'new') return;
    const startNode = nodes.find((n) => n.id === startNodeId);
    if (startNode) {
      mapRef.current.panTo([startNode.latitude, startNode.longitude]);
    }
  }, [startNodeId, nodes, mapReady]);

  // Recalculate map tiles layout when dimensions transition (fullscreen toggle)
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, 150);
    }
  }, [isFullScreen]);

  // Update Map layers (draw pins and lines)
  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;
    const pathLine = pathLineRef.current;
    if (!mapReady || !map || !markersGroup || !pathLine) return;

    // Clear all old drawn layers
    markersGroup.clearLayers();

    // 1. Draw already established background paths (edges)
    edges.forEach((edge) => {
      const fromNode = nodes.find((n) => n.id === edge.from_node_id);
      const toNode = nodes.find((n) => n.id === edge.to_node_id);
      if (fromNode && toNode) {
        const edgeLine = L.polyline(
          [[fromNode.latitude, fromNode.longitude], [toNode.latitude, toNode.longitude]],
          {
            color: 'rgba(99, 102, 241, 0.45)', // Semi-transparent Indigo
            weight: 3.5,
            dashArray: '6, 6',
          }
        ).bindTooltip(`${fromNode.label} ── ${toNode.label}`, { permanent: false, direction: 'top' });

        markersGroup.addLayer(edgeLine);
      }
    });

    // 2. Draw existing background nodes (excluding selected start/end nodes)
    nodes.forEach((node) => {
      const isStart = node.id === startNodeId;
      const isEnd = node.id === endNodeId;

      if (isStart || isEnd) return;

      const isStoreNode = node.type === 'store' || !!node.store_id;
      const linkedStore = node.store_id ? stores.find(s => s.id === node.store_id) : null;
      const labelText = linkedStore ? `🏪 ${node.label} (${linkedStore.name})` : node.label;

      const circle = L.circleMarker([node.latitude, node.longitude], {
        radius: isStoreNode ? 7 : 5.5,
        fillColor: isStoreNode ? '#a855f7' : (node.type === 'entrance' ? '#22d3ee' : '#94a3b8'),
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.85,
      }).bindTooltip(labelText, { permanent: false, direction: 'top' });

      circle.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        const roundedLat = Math.round(node.latitude * 1000000) / 1000000;
        const roundedLng = Math.round(node.longitude * 1000000) / 1000000;
        setPoints((prev) => [...prev, { lat: roundedLat, lng: roundedLng }]);
      });

      markersGroup.addLayer(circle);
    });

    // 2.5. Draw existing store locations on the map canvas
    stores.forEach((store, storeIdx) => {
      const pos = getCampusStoreLocation(store, storeIdx);
      const isSchool = store.id === 'kalawana-national-school-landmark' || store.name.toLowerCase().includes('kalawana');
      const catColor = isSchool ? '#a855f7' : (store.categories?.color || '#6366f1');

      const storePin = L.divIcon({
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            background: ${catColor};
            border: 2.5px solid #ffffff;
            border-radius: 50%;
            color: #ffffff;
            font-size: ${isSchool ? '0.85rem' : '0.7rem'};
            font-weight: 800;
            box-shadow: 0 2px 8px rgba(0,0,0,0.6);
            cursor: pointer;
            overflow: hidden;
          ">
            ${isSchool ? '🏫' : (store.logo_url ? `<img src="${store.logo_url}" alt="${store.name}" style="width:100%;height:100%;object-fit:cover;" />` : (store.name[0] || '🏪'))}
          </div>
        `,
        className: 'custom-store-pin',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([pos.lat, pos.lng], { icon: storePin })
        .bindTooltip(`🏪 Store: ${store.name} (Floor ${store.floor || '1'})`, { permanent: false, direction: 'top', className: 'draw-path-store-tooltip' });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        const roundedLat = Math.round(pos.lat * 1000000) / 1000000;
        const roundedLng = Math.round(pos.lng * 1000000) / 1000000;
        setPoints((prev) => [...prev, { lat: roundedLat, lng: roundedLng }]);
      });

      markersGroup.addLayer(marker);
    });

    // 3. Determine Coordinates for START, END, and Waypoints based on 'new' selection rules
    let startCoords: [number, number] | null = null;
    let endCoords: [number, number] | null = null;
    let intermediatePoints: Array<{ lat: number; lng: number }> = [];

    // Find start node coordinates
    if (startNodeId === 'new') {
      if (points.length > 0) {
        startCoords = [points[0].lat, points[0].lng];
      }
    } else {
      const sNode = nodes.find((n) => n.id === startNodeId);
      if (sNode) {
        startCoords = [sNode.latitude, sNode.longitude];
      }
    }

    // Find end node coordinates
    if (endNodeId === 'new') {
      const lastIdx = points.length - 1;
      if (lastIdx >= 0 && (startNodeId !== 'new' || lastIdx >= 1)) {
        endCoords = [points[lastIdx].lat, points[lastIdx].lng];
      }
    } else {
      const eNode = nodes.find((n) => n.id === endNodeId);
      if (eNode) {
        endCoords = [eNode.latitude, eNode.longitude];
      }
    }

    // Filter intermediate waypoints in between Start and End
    const sIdx = startNodeId === 'new' ? 1 : 0;
    const eIdx = endNodeId === 'new' ? points.length - 1 : points.length;
    if (sIdx < eIdx) {
      intermediatePoints = points.slice(sIdx, eIdx);
    }

    // 4. Draw Start Node (Green Pin)
    if (startCoords) {
      const startPin = L.divIcon({
        html: `<div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #22c55e; border: 2px solid #fff; border-radius: 50%; color: #fff; font-size: 0.65rem; font-weight: 800; box-shadow: 0 2px 6px rgba(0,0,0,0.5)">START</div>`,
        className: 'custom-start-pin',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker(startCoords, { icon: startPin }).addTo(markersGroup);
    }

    // 5. Draw End Node (Red Pin)
    if (endCoords) {
      const endPin = L.divIcon({
        html: `<div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #ef4444; border: 2px solid #fff; border-radius: 50%; color: #fff; font-size: 0.65rem; font-weight: 800; box-shadow: 0 2px 6px rgba(0,0,0,0.5)">END</div>`,
        className: 'custom-end-pin',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker(endCoords, { icon: endPin }).addTo(markersGroup);
    }

    // 6. Draw Intermediate custom points (Numbered Cyan circles)
    intermediatePoints.forEach((pt, index) => {
      const pointMarker = L.divIcon({
        html: `<div style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: #22d3ee; border: 2.5px solid #fff; border-radius: 50%; color: #0b0f1a; font-size: 0.7rem; font-weight: 800; box-shadow: 0 2px 6px rgba(0,0,0,0.4)">${index + 1}</div>`,
        className: 'custom-waypoint-pin',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([pt.lat, pt.lng], { icon: pointMarker }).addTo(markersGroup);
    });

    // 7. Draw connecting path line
    const lineCoordinates: Array<[number, number]> = [];
    if (startCoords) lineCoordinates.push(startCoords);
    intermediatePoints.forEach((pt) => {
      lineCoordinates.push([pt.lat, pt.lng]);
    });
    if (endCoords) lineCoordinates.push(endCoords);

    pathLine.setLatLngs(lineCoordinates);
  }, [nodes, edges, stores, startNodeId, endNodeId, points, mapReady]);

  // Find existing start/end node labels for display info
  const startNode = nodes.find((n) => n.id === startNodeId);
  const endNode = nodes.find((n) => n.id === endNodeId);

  // Dynamic wrapper style for fullscreen overlay vs inline container
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
      <style>{`
        @media (max-width: 768px) {
          .fullscreen-info-panel {
            top: 10px !important;
            left: 10px !important;
            right: 10px !important;
            max-width: calc(100% - 20px) !important;
            padding: 0.75rem !important;
          }
          .fullscreen-actions-panel {
            bottom: 10px !important;
            top: auto !important;
            left: 10px !important;
            right: 10px !important;
            width: calc(100% - 20px) !important;
            justify-content: space-between !important;
            gap: 0.5rem !important;
          }
          .fullscreen-actions-panel button {
            flex: 1 !important;
            padding: 0.5rem 0.25rem !important;
            font-size: 0.75rem !important;
            justify-content: center !important;
            gap: 0.25rem !important;
          }
          .map-legend-overlay {
            bottom: 70px !important;
            right: 10px !important;
            font-size: 0.65rem !important;
            padding: 6px 10px !important;
          }
        }
      `}</style>
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

      {/* Floating Instructions Banner (only when inline) */}
      {!isFullScreen && (
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
          📍 Click map sequentially to build path waypoints
        </div>
      )}

      {/* Floating Controls Overlay for Fullscreen Mode */}
      {isFullScreen && (
        <>
          {/* Glassmorphic Info Panel (Left side) */}
          <div className="fullscreen-info-panel" style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            zIndex: 100000,
            background: 'rgba(19, 25, 41, 0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--color-border)',
            borderRadius: '12px',
            padding: '1.25rem',
            color: 'var(--color-text)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            maxWidth: '320px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            pointerEvents: 'auto',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Drawing Route Path
              </span>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                Waypoint Mapper
              </h3>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              padding: '0.75rem',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.05)',
              fontSize: '0.82rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-muted)' }}>Start Node:</span>
                <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>
                  {startNodeId === 'new' ? 'New Node (Plotted first)' : (startNode?.label || 'Not Selected')}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-muted)' }}>End Node:</span>
                <span style={{ fontWeight: 600, color: 'var(--color-danger)' }}>
                  {endNodeId === 'new' ? 'New Node (Plotted last)' : (endNode?.label || 'Not Selected')}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'var(--color-muted)', fontWeight: 600 }}>Total Clicks:</span>
                <span style={{ fontWeight: 800, color: 'var(--color-accent)', fontSize: '0.95rem' }}>
                  {points.length}
                </span>
              </div>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>
              💡 Click anywhere on the map to place nodes.
              {startNodeId === 'new' && ' First click defines the new Start Node.'}
              {endNodeId === 'new' && ' Last click defines the new End Node.'}
              {startNodeId !== 'new' && endNodeId !== 'new' && ' All clicks represent intermediate path waypoints.'}
            </div>
          </div>

          {/* Action Buttons Panel (Right side) */}
          <div className="fullscreen-actions-panel" style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 100000,
            display: 'flex',
            gap: '0.75rem',
            pointerEvents: 'auto',
          }}>
            <button
              type="button"
              onClick={() => setPoints(points.slice(0, -1))}
              disabled={points.length === 0}
              className="btn btn-ghost"
              style={{
                background: 'rgba(19, 25, 41, 0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                padding: '0.6rem 1rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: points.length === 0 ? 'var(--color-muted)' : 'var(--color-text)',
                cursor: points.length === 0 ? 'not-allowed' : 'pointer',
              }}
              title="Undo Last Click"
            >
              <RotateCcw size={15} />
              Undo
            </button>

            <button
              type="button"
              onClick={() => setPoints([])}
              disabled={points.length === 0}
              className="btn btn-danger"
              style={{
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                padding: '0.6rem 1rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                cursor: points.length === 0 ? 'not-allowed' : 'pointer',
              }}
              title="Clear All Points"
            >
              <Trash2 size={15} />
              Clear All
            </button>

            <button
              type="button"
              onClick={() => setIsFullScreen(false)}
              className="btn btn-primary"
              style={{
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                padding: '0.6rem 1.2rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <Check size={16} />
              Done Picking
            </button>
          </div>
        </>
      )}

      {/* Fullscreen Expand Button (when inline) */}
      {!isFullScreen && (
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

      {/* Standard Map Legend Overlay */}
      <div className="map-legend-overlay" style={{
        position: 'absolute',
        bottom: '10px',
        right: '10px',
        background: 'rgba(15, 23, 42, 0.9)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        padding: '8px 12px',
        color: '#fff',
        fontSize: '0.72rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        zIndex: 1000,
        pointerEvents: 'none',
      }}>
        <div style={{ fontWeight: 700, borderBottom: '1px solid rgba(255, 255, 255, 0.15)', paddingBottom: '3px', marginBottom: '2px', fontSize: '0.75rem', letterSpacing: '0.03em', color: 'var(--color-accent)' }}>
          MAP LEGEND
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}></div>
          <span>Start Node</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}></div>
          <span>End Node</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22d3ee', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}></div>
          <span>Intermediate Waypoints</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#a855f7', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px' }}>🏪</div>
          <span>Store Locations</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#94a3b8', border: '1px solid #fff' }}></div>
          <span>Existing Nodes</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '16px', height: '0px', borderTop: '2px dashed rgba(99, 102, 241, 0.8)' }}></div>
          <span>Existing Connections</span>
        </div>
      </div>
    </div>
  );
}
