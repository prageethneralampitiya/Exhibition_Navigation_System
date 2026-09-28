import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type Store, type NavigationNode, type NavigationEdge } from '../lib/supabase';
import { extractBlocksFromNodes, matchStoreToBlock, type BlockEntity } from '../utils/blocks';
import { isFacilityStore } from '../utils/facilities';
import { calculateShortestRotation, calculateReturnToNorthRotation, shouldUpdateHeading } from '../utils/headingUp';

// ── Satellite / Street tile sources ──────────────────────────────────────────
const TILE_SOURCES = {
  street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
} as const;
type TileMode = keyof typeof TILE_SOURCES;

// Fix Leaflet default icon paths (important for vanilla leaflet in Vite)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEFAULT_ZOOM = 18.0;

interface MapViewProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  stores?: Store[];
  userLat?: number | null;
  userLng?: number | null;
  userHeading?: number | null;
  route?: NavigationNode[];
  theme?: 'dark' | 'streets' | 'light' | 'satellite';
  showGraphMesh?: boolean;
  nodes?: NavigationNode[];
  edges?: NavigationEdge[];
  onMapClick?: (lat: number, lng: number) => void;
  onSelectStore?: (storeId: string) => void;
  outdoorSegmentCount?: number;
  tourStops?: Store[];
  visitedStallIds?: string[];
  showSchoolBoundary?: boolean;
  boundaryCenter?: { lat: number; lng: number };
  boundaryRadius?: number;
  headingUpMode?: boolean;
  onPannedChange?: (isPanned: boolean) => void;
  recenterTrigger?: number;
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
  theme = 'satellite',
  showGraphMesh = false,
  nodes = [],
  edges = [],
  onMapClick,
  onSelectStore,
  outdoorSegmentCount = 0,
  tourStops = [],
  visitedStallIds = [],
  showSchoolBoundary = true,
  boundaryCenter,
  boundaryRadius,
  headingUpMode = false,
  onPannedChange,
  recenterTrigger = 0,
}: MapViewProps) {
  const viewportWrapperRef = useRef<HTMLDivElement>(null);
  const rotatorRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);

  // Heading-Up camera rotation state & refs
  const [cameraRotation, setCameraRotation] = useState<number>(0);
  const currentRotationRef = useRef<number>(0);
  const lastReliableHeadingRef = useRef<number | null>(null);
  const [rotatorSize, setRotatorSize] = useState<number>(0);
  const [isRotatedViewActive, setIsRotatedViewActive] = useState<boolean>(false);
  const isPannedAwayRef = useRef<boolean>(false);
  const isTransitioningRef = useRef<boolean>(true);
  const headingUpModeRef = useRef<boolean>(headingUpMode);
  headingUpModeRef.current = headingUpMode;
  const onPannedChangeRef = useRef(onPannedChange);
  onPannedChangeRef.current = onPannedChange;

  // Measure viewport and calculate diagonal size so full rotation is always 100% covered
  useEffect(() => {
    const el = viewportWrapperRef.current;
    if (!el) return;
    const updateSize = () => {
      const w = el.clientWidth || window.innerWidth;
      const h = el.clientHeight || window.innerHeight;
      const diag = Math.ceil(Math.hypot(w, h)) + 60;
      setRotatorSize(diag);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const zoomBounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.FeatureGroup | null>(null);
  const meshLayerRef = useRef<L.FeatureGroup | null>(null);
  const boundaryLayerRef = useRef<L.FeatureGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  // Tracks the last destination node ID whose bounds we fitted, so we only
  // call fitBounds once when a new route is first drawn — never on GPS updates.
  const lastFittedDestRef = useRef<string | null>(null);
  const isUserInteractingRef = useRef(false);
  const prevCenterRef = useRef<{ lat: number; lng: number }>({ lat: latitude, lng: longitude });
  // Satellite / street toggle state — driven by the `theme` prop from parent (default: satellite)
  const [tileMode, setTileMode] = useState<TileMode>(theme === 'satellite' ? 'satellite' : 'street');
  useEffect(() => {
    setTileMode(theme === 'satellite' ? 'satellite' : 'street');
  }, [theme]);

  // Handle Heading-Up ON / OFF transitions
  useEffect(() => {
    if (!map) return;

    if (headingUpMode) {
      setIsRotatedViewActive(true);
      isPannedAwayRef.current = false;
      onPannedChangeRef.current?.(false);

      requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        if (userLat !== null && userLng !== null) {
          map.setView([userLat, userLng], DEFAULT_ZOOM, { animate: false });
        }
      });

      const headingToUse = userHeading ?? lastReliableHeadingRef.current ?? 0;
      lastReliableHeadingRef.current = ((headingToUse % 360) + 360) % 360;

      const nextRot = calculateShortestRotation(currentRotationRef.current, headingToUse);
      currentRotationRef.current = nextRot;
      isTransitioningRef.current = true;
      setCameraRotation(nextRot);
    } else {
      isPannedAwayRef.current = false;
      onPannedChangeRef.current?.(false);

      // Smoothly rotate back to North-Up (0°) via shortest path
      const nextRot = calculateReturnToNorthRotation(currentRotationRef.current);
      currentRotationRef.current = nextRot;
      isTransitioningRef.current = true;
      setCameraRotation(nextRot);

      const timer = setTimeout(() => {
        setIsRotatedViewActive(false);
        setCameraRotation(0);
        currentRotationRef.current = 0;
        map.invalidateSize({ animate: false });
        if (userLat !== null && userLng !== null) {
          map.setView([userLat, userLng], DEFAULT_ZOOM, { animate: false });
        } else {
          map.setView([latitude, longitude], DEFAULT_ZOOM, { animate: false });
        }
      }, 360);

      return () => clearTimeout(timer);
    }
  }, [headingUpMode, map]);

  // Auto-rotate camera to follow user heading changes (with deadband & shortest path)
  useEffect(() => {
    if (!headingUpMode || !isRotatedViewActive) return;
    if (!shouldUpdateHeading(userHeading, lastReliableHeadingRef.current, 2.5)) {
      // Retain last reliable heading if temporarily unavailable or within deadband
      return;
    }

    const normHeading = ((userHeading! % 360) + 360) % 360;
    lastReliableHeadingRef.current = normHeading;

    // Calculate shortest rotation path across 359° <-> 0° boundary
    const nextRot = calculateShortestRotation(currentRotationRef.current, normHeading);
    currentRotationRef.current = nextRot;
    isTransitioningRef.current = true;
    setCameraRotation(nextRot);
  }, [headingUpMode, isRotatedViewActive, userHeading]);

  // Keep user location centered while Heading-Up mode is active and not manually panned away
  useEffect(() => {
    if (!map || !headingUpMode || !isRotatedViewActive) return;
    if (userLat !== null && userLng !== null && !isPannedAwayRef.current) {
      map.setView([userLat, userLng], DEFAULT_ZOOM, { animate: false });
    }
  }, [map, headingUpMode, isRotatedViewActive, userLat, userLng]);

  // Handle explicit re-center trigger from parent
  useEffect(() => {
    if (!map || recenterTrigger === 0) return;
    isPannedAwayRef.current = false;
    onPannedChangeRef.current?.(false);
    if (userLat !== null && userLng !== null) {
      map.setView([userLat, userLng], DEFAULT_ZOOM, { animate: true });
    }
  }, [recenterTrigger, map, userLat, userLng]);

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Create Map instance with explicit gesture and interaction configurations
    const newMap = L.map(mapContainerRef.current, {
      center: [latitude, longitude],
      zoom: DEFAULT_ZOOM,
      minZoom: 15,
      maxZoom: 21,
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
      if (zoomBounceTimerRef.current) {
        clearTimeout(zoomBounceTimerRef.current);
        zoomBounceTimerRef.current = null;
      }
      if (headingUpModeRef.current) {
        isPannedAwayRef.current = true;
        onPannedChangeRef.current?.(true);
      }
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

    // Keep control container in viewportWrapper so controls stay in screen corners and unrotated
    if (viewportWrapperRef.current && (newMap as any)._controlContainer) {
      viewportWrapperRef.current.appendChild((newMap as any)._controlContainer);
    }

    // Keep zoom indicator updated in real-time
    newMap.on('zoom', () => {
      setCurrentZoom(newMap.getZoom());
    });

    // Auto bounce-back: strictly maintain default zoom ratio 18.0
    // If someone zooms in (ratio > 18.0), automatically zoom out to 18.0
    // If someone zooms out (ratio < 18.0), automatically zoom in to 18.0
    newMap.on('zoomend', () => {
      const z = newMap.getZoom();
      setCurrentZoom(z);

      if (zoomBounceTimerRef.current) {
        clearTimeout(zoomBounceTimerRef.current);
        zoomBounceTimerRef.current = null;
      }

      if (Math.abs(z - DEFAULT_ZOOM) > 0.05) {
        zoomBounceTimerRef.current = setTimeout(() => {
          try {
            if (newMap && mapContainerRef.current && Math.abs(newMap.getZoom() - DEFAULT_ZOOM) > 0.05) {
              newMap.setZoom(DEFAULT_ZOOM, { animate: true });
            }
          } catch {
            // map may have unmounted
          }
        }, 500);
      }
    });

    // Create Layer groups
    const markersLayer = L.layerGroup().addTo(newMap);
    markersLayerRef.current = markersLayer;

    const routeLayer = L.featureGroup().addTo(newMap);
    routeLayerRef.current = routeLayer;

    const meshLayer = L.featureGroup().addTo(newMap);
    meshLayerRef.current = meshLayer;

    const boundaryLayer = L.featureGroup().addTo(newMap);
    boundaryLayerRef.current = boundaryLayer;

    setMap(newMap);

    // Clean up on unmount
    return () => {
      if (zoomBounceTimerRef.current) {
        clearTimeout(zoomBounceTimerRef.current);
        zoomBounceTimerRef.current = null;
      }
      resizeObserver.disconnect();
      newMap.off('dragstart zoomstart movestart', handleTouchOrDragStart);
      newMap.off('dragend zoomend moveend', handleTouchOrDragEnd);
      if ((newMap as any)._controlContainer && (newMap as any)._controlContainer.parentNode) {
        (newMap as any)._controlContainer.parentNode.removeChild((newMap as any)._controlContainer);
      }
      newMap.remove();
      setMap(null);
      markersLayerRef.current = null;
      routeLayerRef.current = null;
      meshLayerRef.current = null;
      if (boundaryLayerRef.current) {
        boundaryLayerRef.current.remove();
        boundaryLayerRef.current = null;
      }
      tileLayerRef.current = null;
    };
  }, []); // Run once on mount only — do NOT include lat/lng/zoom here

  // ── School Campus Boundary Layer ─────────────────────────────
  useEffect(() => {
    if (!map) return;
    if (!boundaryLayerRef.current) {
      boundaryLayerRef.current = L.featureGroup().addTo(map);
    }
    boundaryLayerRef.current.clearLayers();

    if (showSchoolBoundary) {
      // Subtle geofence circle around premises center
      if (boundaryCenter && boundaryRadius) {
        const geofenceCircle = L.circle([boundaryCenter.lat, boundaryCenter.lng], {
          radius: boundaryRadius,
          color: '#06b6d4',
          weight: 2,
          opacity: 0.6,
          dashArray: '6, 6',
          fillColor: '#06b6d4',
          fillOpacity: 0.04,
        });
        geofenceCircle.bindTooltip(`🌐 Venue Geofence (${Math.round(boundaryRadius)}m)`, {
          permanent: false,
          direction: 'top',
          className: 'school-boundary-tooltip',
        });
        boundaryLayerRef.current.addLayer(geofenceCircle);
      }
    }
  }, [map, showSchoolBoundary, boundaryCenter, boundaryRadius]);

  // 2. Tile Layer Theme Manager
  useEffect(() => {
    if (!map) return;

    // Remove existing tile layer
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    const url = tileMode === 'satellite'
      ? TILE_SOURCES.satellite
      : (theme === 'light'
        ? 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png'
        : TILE_SOURCES.street);

    const tileLayer = L.tileLayer(url, {
      maxZoom: 20,
      maxNativeZoom: 20,
      className: (theme === 'dark' && tileMode !== 'satellite') ? 'map-tiles-dark' : '',
      subdomains: tileMode === 'satellite' ? ['0', '1', '2', '3'] : ['a', 'b', 'c'],
    });
    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;

    // Move to back
    tileLayer.bringToBack();
  }, [map, theme, tileMode]);

  // 3. Update view center when the parent explicitly re-centers (no active route)
  // Only setView if the target coordinates actually changed AND user is not actively panning/zooming.
  useEffect(() => {
    if (!map) return;
    const latChanged = prevCenterRef.current.lat !== latitude;
    const lngChanged = prevCenterRef.current.lng !== longitude;
    prevCenterRef.current = { lat: latitude, lng: longitude };

    if (!headingUpMode && (latChanged || lngChanged) && route.length === 0 && !isUserInteractingRef.current) {
      map.setView([latitude, longitude], DEFAULT_ZOOM, { animate: true });
    }
  }, [map, latitude, longitude, zoom, route.length, headingUpMode]);

  // 4. Render Block Markers — one marker per building block, derived from navigation nodes
  useEffect(() => {
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    const zoomLevel = map.getZoom();

    // ── School landmark: always visible at every zoom level ──────────────────
    const fallbackSchoolStore = {
      id: 'kalawana-national-school-landmark',
      name: 'Kalawana National School',
      latitude: 6.53585,
      longitude: 80.4009,
    };

    const schoolPinSize = 30;
    const schoolPinRadius = Math.round(schoolPinSize / 2);
    const schoolIcon = L.divIcon({
      className: 'custom-map-pin-wrapper',
      html: `
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:${schoolPinSize}px;height:${schoolPinSize}px;">
          <div style="position:absolute;width:${schoolPinSize + 16}px;height:${schoolPinSize + 16}px;border-radius:50%;background:#a855f7;opacity:0.4;animation:map-pin-pulse 1.8s infinite ease-in-out;"></div>
          <div style="width:${schoolPinSize}px;height:${schoolPinSize}px;border-radius:50%;background:#a855f7;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-size:14px;z-index:10;">🏫</div>
        </div>
        <style>@keyframes map-pin-pulse{0%{transform:scale(0.6);opacity:0.7}100%{transform:scale(1.6);opacity:0}}</style>
      `,
      iconSize: [schoolPinSize, schoolPinSize],
      iconAnchor: [schoolPinRadius, schoolPinRadius],
    });
    const schoolMarker = L.marker([fallbackSchoolStore.latitude, fallbackSchoolStore.longitude], { icon: schoolIcon });
    schoolMarker.bindTooltip('🏫 Kalawana National School', {
      permanent: false,
      direction: 'top',
      offset: [0, -schoolPinRadius],
      className: 'school-landmark-tooltip',
    });
    markersLayer.addLayer(schoolMarker);

    // ── Scale guard: hide block chips beyond a wide zoom-out ─────────────────
    const centerLat = map.getCenter().lat;
    const metersPerPixel =
      (40075016.686 * Math.cos((centerLat * Math.PI) / 180)) / Math.pow(2, zoomLevel + 8);
    const SCALE_HIDE_THRESHOLD = 1.25;
    if (metersPerPixel > SCALE_HIDE_THRESHOLD) return;

    // ── Extract blocks from navigation nodes ─────────────────────────────────
    const blocks: BlockEntity[] = extractBlocksFromNodes(nodes);

    // ── Count stalls per block ────────────────────────────────────────────────
    const blockStoreCount = new Map<string, number>();
    blocks.forEach((b) => blockStoreCount.set(b.id, 0));

    stores.forEach((s) => {
      if (isFacilityStore(s)) return;
      const matched = matchStoreToBlock(s, blocks);
      if (matched && blockStoreCount.has(matched.id)) {
        blockStoreCount.set(matched.id, (blockStoreCount.get(matched.id) || 0) + 1);
      }
    });

    // ── Render one block circle marker per block ──────────────────────────────
    blocks.forEach((block) => {
      if (!block.latitude || !block.longitude) return;

      const isDestinationBlock =
        route.length > 0 &&
        route.some((n) => {
          const matched = blocks.find(
            (b) =>
              Math.abs(n.latitude - b.latitude) < 0.0003 &&
              Math.abs(n.longitude - b.longitude) < 0.0003
          );
          return matched?.id === block.id;
        });

      const stallCount = blockStoreCount.get(block.id) ?? 0;
      const color = block.color || '#06b6d4';

      // Zoom-responsive circle size (mirrors old store pin sizing)
      const BASE_ZOOM = 18;
      const zoomDelta = zoomLevel - BASE_ZOOM;
      const rawSize = 24 + zoomDelta * 3;
      const pinDiameter = Math.max(18, Math.min(32, rawSize));
      const pinRadius = Math.round(pinDiameter / 2);
      const pulseSize = pinDiameter + 16;
      const showPulse = zoomLevel >= 16;

      // Check if block has tour stops
      const blockTourStops = tourStops.filter((s) => {
        const matched = matchStoreToBlock(s, blocks);
        return matched?.id === block.id;
      });
      const hasTourStop = blockTourStops.length > 0;
      const isTourVisited = hasTourStop && blockTourStops.every((s) => visitedStallIds.includes(s.id));
      const firstUnvisitedStop = blockTourStops.find((s) => !visitedStallIds.includes(s.id));
      const tourStopIdx = firstUnvisitedStop
        ? tourStops.findIndex((s) => s.id === firstUnvisitedStop.id)
        : (hasTourStop ? tourStops.findIndex((s) => s.id === blockTourStops[0].id) : -1);

      const isCurrentTourTarget = hasTourStop && !isTourVisited;
      const showActivePulse = (isDestinationBlock || (isCurrentTourTarget && showPulse));

      const badgeSize = Math.max(12, Math.round(pinDiameter * 0.55));
      const badgeFontSize = Math.max(7, Math.round(badgeSize * 0.55));

      // Abbreviate block name to fit in circle
      const numMatch = block.name.match(/\d+/);
      const circleLabel = numMatch ? numMatch[0] : block.name.slice(0, 2).toUpperCase();

      const circleIcon = L.divIcon({
        className: 'custom-map-pin-wrapper',
        html: `
          <div style="position:relative;display:flex;align-items:center;justify-content:center;width:${pinDiameter}px;height:${pinDiameter}px;">
            ${(showActivePulse) ? `
              <div style="position:absolute;width:${pulseSize}px;height:${pulseSize}px;border-radius:50%;background:${color};opacity:0.4;animation:map-pin-pulse 1.8s infinite ease-in-out;"></div>
            ` : ''}
            <div style="width:${pinDiameter}px;height:${pinDiameter}px;border-radius:50%;background:${isDestinationBlock ? color : color};border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;color:#fff;font-size:${Math.max(8, Math.round(pinDiameter * 0.38))}px;font-weight:800;z-index:10;overflow:hidden;">
              ${circleLabel}
            </div>
            ${hasTourStop && pinDiameter >= 14 ? `
              <div style="position:absolute;top:${-Math.round(badgeSize * 0.3)}px;right:${-Math.round(badgeSize * 0.3)}px;background:${isTourVisited ? '#22c55e' : '#22d3ee'};color:${isTourVisited ? '#fff' : '#0f172a'};font-size:${badgeFontSize}px;font-weight:900;width:${badgeSize}px;height:${badgeSize}px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.45);z-index:20;">
                ${isTourVisited ? '✓' : tourStopIdx + 1}
              </div>
            ` : ''}
          </div>
          <style>@keyframes map-pin-pulse{0%{transform:scale(0.6);opacity:0.7}100%{transform:scale(1.6);opacity:0}}</style>
        `,
        iconSize: [pinDiameter, pinDiameter],
        iconAnchor: [pinRadius, pinRadius],
      });

      const marker = L.marker([block.latitude, block.longitude], { icon: circleIcon });
      marker.bindTooltip(`🏢 ${block.name}`, {
        permanent: false,
        direction: 'top',
        offset: [0, -pinRadius],
        className: 'school-landmark-tooltip',
      });
      marker.bindPopup(`
        <div style="color:#0b0f1a;padding:0.3rem;font-family:sans-serif;min-width:160px;">
          <h4 style="margin:0 0 0.25rem 0;font-weight:800;font-size:0.95rem;line-height:1.2;">🏢 ${block.name}</h4>
          <p style="margin:0 0 0.5rem 0;font-size:0.75rem;color:#64748b;">
            ${stallCount > 0 ? `${stallCount} stall${stallCount !== 1 ? 's' : ''} · ` : ''}Floor ${block.floor || '1'}
          </p>
          <div style="display:flex;flex-direction:column;gap:0.35rem;">
            <button onclick="window.__onNavigateToStore && window.__onNavigateToStore('${block.id}')" style="display:block;width:100%;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:#fff;padding:0.38rem 0.5rem;border:none;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer;text-align:center;">🧭 Navigate Here</button>
            <a href="/stores" style="display:block;background:rgba(255,255,255,0.08);border:1px solid rgba(0,0,0,0.1);color:#334155;padding:0.3rem;border-radius:6px;font-size:0.72rem;font-weight:600;text-decoration:none;text-align:center;">Browse Stalls</a>
          </div>
        </div>
      `);
      markersLayer.addLayer(marker);
    });
  }, [map, currentZoom, nodes, stores, route, tourStops, visitedStallIds]);


  // 5. Render User Location Marker (with Direction Cone)
  useEffect(() => {
    if (!map) return;

    if (userLat !== null && userLng !== null) {
      const effectiveHeading = (userHeading !== null && userHeading !== undefined && !isNaN(userHeading))
        ? userHeading
        : (headingUpMode ? lastReliableHeadingRef.current : null);
      const hasHeading = effectiveHeading !== null && effectiveHeading !== undefined;

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
                transform: rotate(${effectiveHeading}deg);
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
  }, [map, userLat, userLng, userHeading, headingUpMode]);

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
      const center = fullLine.getBounds().getCenter();
      map.setView(center, DEFAULT_ZOOM, { animate: true });
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
    <div
      ref={viewportWrapperRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div
        ref={rotatorRef}
        style={isRotatedViewActive ? {
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: `${rotatorSize || 1200}px`,
          height: `${rotatorSize || 1200}px`,
          transform: `translate(-50%, -50%) rotate(${cameraRotation}deg)`,
          transformOrigin: 'center center',
          transition: isTransitioningRef.current ? 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)' : 'none',
          willChange: 'transform',
        } : {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          transform: 'none',
        }}
      >
        <div
          ref={mapContainerRef}
          className="map-container"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: isRotatedViewActive ? 0 : 'var(--radius-lg)',
            border: isRotatedViewActive ? 'none' : '1px solid var(--color-border)',
            overflow: 'hidden',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        />
      </div>
      {map && (
        <div
          className="map-zoom-badge"
          style={{
            position: 'absolute',
            bottom: '14px',
            right: '16px',
            background: 'rgba(11, 15, 26, 0.85)',
            backdropFilter: 'blur(4px)',
            border: '1px solid var(--color-border)',
            padding: '3px 7px',
            borderRadius: '6px',
            fontSize: '0.7rem',
            fontWeight: '700',
            color: 'var(--color-text)',
            zIndex: 1000,
            pointerEvents: 'none',
            letterSpacing: '0.04em',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <span style={{ color: 'var(--color-accent)' }}>ZOOM:</span>
          <span>{currentZoom.toFixed(1)}x</span>
        </div>
      )}
    </div>
  );
}
