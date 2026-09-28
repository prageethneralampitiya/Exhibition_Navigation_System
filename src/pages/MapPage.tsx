import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  Route,
  X,
  Search,
  Navigation,
  Store,
  ArrowLeft,
  Bell,
  Compass,
  AlertTriangle,
  Check,
  Award,
  Home,
  Radio,
  VolumeX,
  QrCode,
  ChevronDown,
  ChevronUp,
  FastForward,
  ChevronLeft,
  RotateCcw,
  DoorOpen,
} from 'lucide-react';
import { useLiveBroadcast } from '../contexts/LiveBroadcastContext';
import { StallTourSelectModal } from '../components/StallTourSelectModal';
import { useAuth } from '../contexts/AuthContext';
import { GPSPermissionBanner } from '../components/GPSPermissionBanner';
import { QuickPitstopModal } from '../components/QuickPitstopModal';
import { PremisesBypassScreen } from '../components/PremisesBypassScreen';
import {
  supabase,
  type Store as StoreType,
  type NavigationNode,
  type NavigationEdge,
} from '../lib/supabase';
import { MapView } from '../components/MapView';
import { MapView3D } from '../components/MapView3D';
import { getCampusStoreLocation } from '../components/KalawanaSchool3DLayer';
import {
  calculateShortestPathBetweenCoordinates,
  getDistance,
  getHeading,
  getAllEntrancePoints,
  findShortestDistanceEntrance,
  isEntranceNode,
  isPointNearVenueGraph,
  advanceRouteOnEarlyTurn,
  getDesignatedExitGate,
  optimizeStallVisitOrderWithExitGate,
} from '../utils/dijkstra';
import { fetchOSRMRoute } from '../utils/osrmRouting';
import { logAnalyticsEvent } from '../lib/analytics';
import { recordStallEngagement } from '../services/stallPopularityService';
import { GPSKalmanFilter } from '../utils/gpsFilter';
import { isFacilityStore } from '../utils/facilities';
import { calculateMovementBearing } from '../utils/headingUp';


const DEFAULT_DEMO_STALLS: StoreType[] = [
  {
    id: 'demo-stall-1',
    name: 'Stall #1 — Tech & AI Pavilion',
    description: 'Robotics, AI, and smart technology showcase',
    latitude: 6.535600,
    longitude: 80.401200,
    floor: '1',
    is_active: true,
    categories: { id: 'cat-tech', name: 'Technology', color: '#6366f1' }
  },
  {
    id: 'demo-stall-2',
    name: 'Stall #2 — Robotics & Drone Arena',
    description: 'Autonomous drones and industrial robotics show',
    latitude: 6.535800,
    longitude: 80.401500,
    floor: '1',
    is_active: true,
    categories: { id: 'cat-robotics', name: 'Robotics', color: '#06b6d4' }
  },
  {
    id: 'demo-stall-3',
    name: 'Stall #3 — Green Energy Expo',
    description: 'Solar power, EVs, and clean energy solutions',
    latitude: 6.535200,
    longitude: 80.401400,
    floor: '1',
    is_active: true,
    categories: { id: 'cat-energy', name: 'Green Energy', color: '#22c55e' }
  },
  {
    id: 'demo-stall-4',
    name: 'Stall #4 — Science & Innovation Lab',
    description: 'Biotech, genetics, and chemistry experiments',
    latitude: 6.535000,
    longitude: 80.400800,
    floor: '1',
    is_active: true,
    categories: { id: 'cat-science', name: 'Science & Biotech', color: '#ec4899' }
  },
  {
    id: 'demo-stall-5',
    name: 'Stall #5 — Main Food & Refreshments',
    description: 'Beverages, snacks, and catering stalls',
    latitude: 6.535700,
    longitude: 80.400500,
    floor: '1',
    is_active: true,
    categories: { id: 'cat-food', name: 'Food & Dining', color: '#f59e0b' }
  }
] as any[];

/**
 * Normalizes navigation nodes:
 * - Marks entrance nodes based on exact label or precise coordinates (~5m)
 * - NEVER overwrites coordinates of general path nodes
 */
function normalizeNavigationNodes(navigationNodes: NavigationNode[]): NavigationNode[] {
  return navigationNodes.map((n) => {
    const labelLower = (n.label || '').toLowerCase().trim();
    if (labelLower === 'uni entrance' || labelLower === 'university entrance') {
      return { ...n, latitude: 6.795359, longitude: 79.899868, type: 'entrance' };
    }
    if (labelLower === 'entrance gate' || labelLower === 'school entrance') {
      return { ...n, latitude: 6.535862, longitude: 80.400348, type: 'entrance' };
    }
    // Coordinate-based (tight ~5m threshold): only mark type, NEVER overwrite coordinates
    if (Math.abs(n.latitude - 6.795359) < 0.00005 && Math.abs(n.longitude - 79.899868) < 0.00005) {
      return { ...n, type: 'entrance' };
    }
    if (Math.abs(n.latitude - 6.535862) < 0.00005 && Math.abs(n.longitude - 80.400348) < 0.00005) {
      return { ...n, type: 'entrance' };
    }
    return n;
  });
}

// ─── Live Audio / Broadcast Controls ──────────────────────────────────────────
/**
 * Live Broadcast button in the desktop top-right header.
 * Uses standard Radio / VolumeX icon matching HomePage.
 */
function LiveAudioHeaderButton() {
  const { activeBroadcast, isPlaying, handleListen, handleMute } = useLiveBroadcast();

  if (!activeBroadcast) return null;

  return (
    <button
      id="map-header-live-audio-btn"
      onClick={isPlaying ? handleMute : handleListen}
      className="btn btn-ghost btn-sm"
      title={isPlaying ? 'Mute live broadcast' : 'Listen to live broadcast'}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.35rem 0.65rem',
        border: isPlaying
          ? '1px solid rgba(239,68,68,0.5)'
          : '1px solid rgba(255,255,255,0.15)',
        color: isPlaying ? '#f87171' : 'var(--color-muted)',
        background: isPlaying ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.04)',
        borderRadius: '6px',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      {isPlaying ? <VolumeX size={15} /> : <Radio size={15} />}
      <span>Broadcast</span>
      {isPlaying && (
        <span
          className="live-dot-pulse"
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: '#ef4444',
            display: 'inline-block',
          }}
        />
      )}
    </button>
  );
}

/**
 * Compact Live Audio icon button for mobile topbar.
 */
function LiveAudioMobileButton() {
  const { activeBroadcast, isPlaying, handleListen, handleMute } = useLiveBroadcast();

  if (!activeBroadcast) return null;

  return (
    <button
      id="map-mobile-live-audio-btn"
      onClick={isPlaying ? handleMute : handleListen}
      className="btn btn-ghost btn-sm btn-icon"
      title={isPlaying ? 'Mute live audio guide' : 'Listen to live audio guide'}
      style={{
        position: 'relative',
        width: 32,
        height: 32,
        padding: 0,
        flexShrink: 0,
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: isPlaying
          ? '1px solid rgba(239,68,68,0.5)'
          : '1px solid rgba(255,255,255,0.15)',
        color: isPlaying ? '#f87171' : 'var(--color-muted)',
        background: isPlaying ? 'rgba(239,68,68,0.12)' : 'transparent',
      }}
    >
      {isPlaying ? <VolumeX size={15} /> : <Radio size={15} />}
      {isPlaying && (
        <span
          className="live-dot-pulse"
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: '#ef4444',
            display: 'block',
          }}
        />
      )}
    </button>
  );
}

export function MapPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    const handleUnread = (e: Event) => {
      setUnreadNotifications((e as CustomEvent).detail);
    };
    window.addEventListener('announcements-unread-count', handleUnread);
    window.dispatchEvent(new CustomEvent('request-announcements-unread-count'));

    return () => {
      window.removeEventListener('announcements-unread-count', handleUnread);
    };
  }, []);

  const handleOpenAnnouncements = () => {
    window.dispatchEvent(new CustomEvent('open-announcements-history'));
  };

  // Database Resources
  const [stores, setStores] = useState<StoreType[]>([]);
  const [nodes, setNodes] = useState<NavigationNode[]>([]);
  const [edges, setEdges] = useState<NavigationEdge[]>([]);
  const [loading, setLoading] = useState(true);

  // Geolocation tracking state
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null); // metres
  const [dismissedLowGps, setDismissedLowGps] = useState(false);
  const [, setSnappedToNode] = useState<string | null>(null); // label of entrance used as fallback start
  const [, setGpsError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(false);

  // Google Maps-style Heading-Up Navigation state
  const [isHeadingUp, setIsHeadingUp] = useState(false);
  const [recenterCount, setRecenterCount] = useState(0);
  const lastGpsCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  // Indoor QR Calibration State (locks user to checkpoint indoors)
  const [calibratedLocation, setCalibratedLocation] = useState<{
    id: string | null;
    label: string;
    lat: number;
    lng: number;
    floor: string;
    calibratedAt: number;
  } | null>(null);
  const calibratedLocationRef = useRef<typeof calibratedLocation>(null);
  useEffect(() => {
    calibratedLocationRef.current = calibratedLocation;
  }, [calibratedLocation]);

  // Kalman Filter for coordinates smoothing
  const filterRef = useRef(new GPSKalmanFilter(0.8, 1.8));

  // Selected mock starting node (if GPS is disabled)
  const [mockStartNodeId, setMockStartNodeId] = useState('');

  // Destination / Navigation states
  const [selectedDestinationStoreId, setSelectedDestinationStoreId] = useState('');
  const [selectedDestinationNodeId, setSelectedDestinationNodeId] = useState('');
  const [calculatedRoute, setCalculatedRoute] = useState<NavigationNode[]>([]);
  const [totalDistance, setTotalDistance] = useState(0); // in meters
  const [, setGuideSteps] = useState<string[]>([]);
  const [navigationActive, setNavigationActive] = useState(false);
  // Number of leading nodes in calculatedRoute that came from outdoor OSM routing
  // 0 means all nodes are from the internal drawn graph (user is inside campus)
  const [outdoorSegmentCount, setOutdoorSegmentCount] = useState(0);
  const [showMesh, setShowMesh] = useState(false);

  // Settings & Guided Tour states
  const [exhibitionSettings, setExhibitionSettings] = useState<{
    entrance_latitude: number;
    entrance_longitude: number;
    entrance_threshold_meters: number;
    premises_center_latitude: number;
    premises_center_longitude: number;
    school_boundary_enabled: boolean;
    allow_boundary_bypass?: boolean;
    google_maps_url?: string;
    exit_gate_node_id?: string | null;
    exit_latitude?: number | null;
    exit_longitude?: number | null;
    exit_gate_label?: string | null;
  }>({
    entrance_latitude: 6.53586,
    entrance_longitude: 80.40035,
    entrance_threshold_meters: 20.0,
    premises_center_latitude: 6.535472,
    premises_center_longitude: 80.401000,
    premises_radius_meters: 150.0,
    school_boundary_enabled: true,
    allow_boundary_bypass: true,
    google_maps_url: '',
    exit_gate_node_id: null,
    exit_latitude: null,
    exit_longitude: null,
    exit_gate_label: null,
  });
  const exhibitionSettingsRef = useRef(exhibitionSettings);
  useEffect(() => {
    exhibitionSettingsRef.current = exhibitionSettings;
  }, [exhibitionSettings]);

  const [isFarAway, setIsFarAway] = useState(false);
  const [showChecklistPrompt, setShowChecklistPrompt] = useState(false);

  // LocalStorage persistence for Visited History Tracker
  const LOCAL_STORAGE_VISITED_KEY = 'exhibition_visited_stalls_v1';
  const [visitedStallIds, setVisitedStallIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_VISITED_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_VISITED_KEY, JSON.stringify(visitedStallIds));
    } catch (e) {
      console.warn('Could not save visited stalls to localStorage:', e);
    }
  }, [visitedStallIds]);

  const [guidedTourActive, setGuidedTourActive] = useState(false);
  const [tourStops, setTourStops] = useState<StoreType[]>([]);
  const [currentTourStopIndex, setCurrentTourStopIndex] = useState(0);
  const [arrivedStopPrompt, setArrivedStopPrompt] = useState<StoreType | null>(null);
  const lastPromptedStopIdRef = useRef<string | null>(null);
  const [showTourCompletedModal, setShowTourCompletedModal] = useState(false);
  const [completedTourStats, setCompletedTourStats] = useState<{ totalStalls: number; totalVisited: number }>({
    totalStalls: 0,
    totalVisited: 0,
  });
  const [showTourStallsModal, setShowTourStallsModal] = useState(false);

  // Pitstop Detour State (temporary detour to washroom, canteen, water, first aid)
  interface ActivePitstopDetour {
    originalType: 'single' | 'tour';
    originalDestinationStoreId: string;
    originalDestinationNodeId: string;
    originalTourStops: StoreType[];
    originalTourStopIndex: number;
    facility: StoreType;
  }
  const [activePitstopDetour, setActivePitstopDetour] = useState<ActivePitstopDetour | null>(null);
  const [showPitstopModal, setShowPitstopModal] = useState(false);

  const handleOpenTourPlanner = () => {
    setShowChecklistPrompt(true);
  };

  const [bypassBoundaryCheck, setBypassBoundaryCheckState] = useState(false);
  const bypassBoundaryCheckRef = useRef(false);

  const setBypassBoundaryCheck = useCallback((val: boolean) => {
    bypassBoundaryCheckRef.current = val;
    setBypassBoundaryCheckState(val);
  }, []);

  // Tracks if the user has been prompted about guided tours on startup
  const hasPromptedRef = useRef(false);

  // Cached OSRM street route so GPS jitters don't cause rate-limiting or route flickering
  const lastOSRMRouteRef = useRef<{
    nodes: NavigationNode[];
    guideSteps: string[] | null;
    totalDistance: number | null;
    startLat: number;
    startLng: number;
    destId: string;
  } | null>(null);

  // Last GPS position used for tour route calculation — prevents recalculating on every minor GPS jitter
  const lastTourRoutePositionRef = useRef<{ lat: number; lng: number; stopId: string } | null>(null);
  // Minimum distance the user must move (metres) before the tour leg route updates
  const TOUR_REROUTE_THRESHOLD_METERS = 5;

  // Bottom sheet drag state (Google Maps style: 'hidden' | 'normal' | 'expanded')
  type NavSheetState = 'hidden' | 'normal' | 'expanded';
  const [navSheetState, setNavSheetState] = useState<NavSheetState>('normal');
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetDragStartY = useRef<number | null>(null);
  const sheetDragDelta = useRef<number>(0);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Don't drag when interacting with buttons, links, or inputs
    if (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select')) {
      return;
    }
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    sheetDragStartY.current = clientY;
    sheetDragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleSheetTouchMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (sheetDragStartY.current === null) return;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const delta = clientY - sheetDragStartY.current;
    sheetDragDelta.current = delta;

    if (sheetRef.current) {
      // Elastic resistance while dragging
      const damp = delta * 0.75;
      const clamped = Math.max(-200, Math.min(damp, 200));
      sheetRef.current.style.transform = `translateY(${clamped}px)`;
    }
  }, []);

  const handleSheetTouchEnd = useCallback(() => {
    if (sheetDragStartY.current === null) return;
    const delta = sheetDragDelta.current;
    sheetDragStartY.current = null;
    sheetDragDelta.current = 0;

    if (sheetRef.current) {
      sheetRef.current.style.transition = 'all 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
      sheetRef.current.style.transform = '';
    }

    // Downward swipe (> 40px) -> collapse to hidden (or from expanded to normal)
    if (delta > 40) {
      setNavSheetState(curr => (curr === 'expanded' ? 'normal' : 'hidden'));
    }
    // Upward drag (< -40px) -> expand (from hidden to normal, or from normal to expanded)
    else if (delta < -40) {
      setNavSheetState(curr => (curr === 'hidden' ? 'normal' : 'expanded'));
    }
  }, []);


  // Search dropdown trigger query
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Leaflet map center anchor — default: Kalawana National School
  const [mapCenterLat, setMapCenterLat] = useState(6.535472);
  const [mapCenterLng, setMapCenterLng] = useState(80.401000);
  // Tracks whether the map has already been centered on a real GPS fix,
  // so the node/store fallback doesn't overwrite it.
  const hasGPSCenteredRef = useRef(false);

  // Geolocation watch listener ID
  const geoWatchIdRef = useRef<number | null>(null);
  const lastLoggedDestinationRef = useRef('');

  // Cache key and TTL (15 minutes) for navigation graph and stores to protect Supabase under 500+ concurrent visitors
  const NAV_RESOURCES_CACHE_KEY = 'invex_nav_resources_v2';
  const NAV_RESOURCES_CACHE_TTL = 15 * 60 * 1000;

  useEffect(() => {
    loadNavigationResources();
    startLocationTracking();

    // High concurrency optimization: Only connect WebSocket if user is admin.
    // Regular visitors (500+ users) will not consume Supabase's 200 Realtime connection quota.
    let graphChannel: ReturnType<typeof supabase.channel> | null = null;
    if (profile?.role === 'admin') {
      graphChannel = supabase
        .channel('map-graph-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'navigation_nodes' }, refreshGraphData)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'navigation_edges' }, refreshGraphData)
        .subscribe();
    }

    const gpsFilter = filterRef.current;
    return () => {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
      gpsFilter.reset();
      if (graphChannel) {
        supabase.removeChannel(graphChannel);
      }
    };

  }, [profile?.role]);

  async function loadNavigationResources() {
    try {
      setLoading(true);

      const isPrivileged = profile?.role === 'admin' || profile?.role === 'store_admin';
      const cached = !isPrivileged ? sessionStorage.getItem(NAV_RESOURCES_CACHE_KEY) : null;
      let activeStores: StoreType[] = [];
      let navigationNodes: NavigationNode[] = [];
      let navigationEdges: NavigationEdge[] = [];

      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (
            Date.now() - (parsed.timestamp || 0) < NAV_RESOURCES_CACHE_TTL &&
            Array.isArray(parsed.stores) &&
            Array.isArray(parsed.nodes) &&
            Array.isArray(parsed.edges)
          ) {
            activeStores = parsed.stores;
            navigationNodes = parsed.nodes;
            navigationEdges = parsed.edges;
          }
        } catch {
          sessionStorage.removeItem(NAV_RESOURCES_CACHE_KEY);
        }
      }

      if (activeStores.length === 0) {
        const [storesRes, nodesRes, edgesRes] = await Promise.all([
          supabase
            .from('stores')
            .select(`
              *,
              categories:category_id (id, name, color),
              exhibitions:exhibition_id (id, title)
            `)
            .eq('is_active', true),
          supabase.from('navigation_nodes').select('*'),
          supabase.from('navigation_edges').select('*'),
        ]);

        activeStores = storesRes.data || [];
        navigationNodes = nodesRes.data || [];
        navigationEdges = edgesRes.data || [];

        if (!isPrivileged && activeStores.length > 0) {
          try {
            sessionStorage.setItem(NAV_RESOURCES_CACHE_KEY, JSON.stringify({
              stores: activeStores,
              nodes: navigationNodes,
              edges: navigationEdges,
              timestamp: Date.now(),
            }));
          } catch {}
        }
      }

      // Ensure Kalawana National School landmark is always present on the map
      const kalawanaSchoolStore: StoreType = {
        id: 'kalawana-national-school-landmark',
        name: 'Kalawana National School',
        description: 'Kalawana National School (Central College) · GCP2+5C6, Kalawana',
        latitude: 6.535850,
        longitude: 80.400900,
        floor_level: 1,
        is_active: true,
        categories: {
          id: 'school-cat',
          name: 'Education / School',
          color: '#a855f7',
        },
      } as any;

      if (!activeStores.some((s) => s.name.toLowerCase().includes('kalawana'))) {
        activeStores.unshift(kalawanaSchoolStore);
      }

      // If database has no custom active stores, populate fallback demo exhibition stalls
      const realStores = activeStores.filter((s) => s.id !== 'kalawana-national-school-landmark');
      const storesToProcess = realStores.length > 0 ? activeStores : [kalawanaSchoolStore, ...DEFAULT_DEMO_STALLS];

      const processedStores: StoreType[] = storesToProcess.map((store, index) => {
        if (store.id === 'kalawana-national-school-landmark') return store;
        const storeIndex = Math.max(0, index - 1);
        const pos = getCampusStoreLocation(store, storeIndex);
        return {
          ...store,
          latitude: (store.latitude != null && !isNaN(store.latitude)) ? store.latitude : pos.lat,
          longitude: (store.longitude != null && !isNaN(store.longitude)) ? store.longitude : pos.lng,
        };
      });

      setStores(processedStores);

      const normalizedNodes = normalizeNavigationNodes(navigationNodes);


      // Sort navigation nodes naturally in ascending order (Node 1, Node 2, ...)
      const sortedNodes = [...normalizedNodes].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
      );
      setNodes(sortedNodes);
      setEdges(navigationEdges);

      // Identify primary map entrance node / Node 1
      const entranceNode =
        sortedNodes.find((n) => isEntranceNode(n)) ||
        sortedNodes.find((n) => (n.label || '').toLowerCase().includes('start')) ||
        sortedNodes.find((n) => (n.label || '').toLowerCase().includes('kml-1')) ||
        sortedNodes.find((n) => (n.label || '').toLowerCase().includes('gate')) ||
        sortedNodes.find((n) => (n.label || '').toLowerCase().includes('entrance')) ||
        sortedNodes.find((n) => (n.label || '').toLowerCase().includes('node 1')) ||
        sortedNodes[0];

      // Fetch settings announcement row
      const { data: settingsData } = await supabase
        .from('announcements')
        .select('message')
        .eq('type', 'settings')
        .eq('is_active', true)
        .limit(1);

      if (settingsData && settingsData.length > 0) {
        try {
          const parsed = JSON.parse(settingsData[0].message);
          setExhibitionSettings({
            entrance_latitude: entranceNode?.latitude ?? parsed.entrance_latitude ?? 6.53586,
            entrance_longitude: entranceNode?.longitude ?? parsed.entrance_longitude ?? 80.40035,
            entrance_threshold_meters: parsed.entrance_threshold_meters ?? 20.0,
            premises_center_latitude: parsed.premises_center_latitude ?? 6.535472,
            premises_center_longitude: parsed.premises_center_longitude ?? 80.401000,
            premises_radius_meters: parsed.premises_radius_meters ?? 150.0,
            school_boundary_enabled: parsed.show_school_boundary !== undefined
              ? parsed.show_school_boundary !== false
              : parsed.school_boundary_enabled !== false,
            allow_boundary_bypass: parsed.allow_boundary_bypass !== false,
            google_maps_url: parsed.google_maps_url || '',
            exit_gate_node_id: parsed.exit_gate_node_id ?? null,
            exit_latitude: parsed.exit_latitude ?? null,
            exit_longitude: parsed.exit_longitude ?? null,
            exit_gate_label: parsed.exit_gate_label ?? null,
          });
        } catch (jsonErr) {
          console.warn('Error parsing settings JSON:', jsonErr);
        }
      } else if (entranceNode) {
        setExhibitionSettings((prev) => ({
          ...prev,
          entrance_latitude: entranceNode.latitude,
          entrance_longitude: entranceNode.longitude,
        }));
      }

      // Set default mock start node selection
      if (entranceNode) {
        setMockStartNodeId(entranceNode.id);
      }

      // Default map center: Kalawana National School (6.535472, 80.401000)
      if (!hasGPSCenteredRef.current) {
        setMapCenterLat(entranceNode?.latitude ?? 6.535472);
        setMapCenterLng(entranceNode?.longitude ?? 80.401000);
      }
    } catch (err) {
      console.warn('Network error or rate-limit fetching navigation data; engaging offline fallback:', err);
      setStores((prev) => (prev.length > 0 ? prev : DEFAULT_DEMO_STALLS));
    } finally {
      setLoading(false);
    }
  }

  /** Lightweight graph refresh — only re-fetches nodes + edges, not stores/settings.
   *  Called by the realtime subscription whenever the admin saves new path nodes. */
  async function refreshGraphData() {
    try {
      sessionStorage.removeItem(NAV_RESOURCES_CACHE_KEY);
      const [nodesRes, edgesRes] = await Promise.all([
        supabase.from('navigation_nodes').select('*'),
        supabase.from('navigation_edges').select('*'),
      ]);

      const navigationNodes = nodesRes.data || [];
      const navigationEdges = edgesRes.data || [];

      const normalizedNodes = normalizeNavigationNodes(navigationNodes);

      const sortedNodes = [...normalizedNodes].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
      );

      setNodes(sortedNodes);
      setEdges(navigationEdges);
    } catch (err) {
      console.warn('Graph auto-refresh failed:', err);
    }
  }

  // Device orientation / compass callback for direction tracking
  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const e = event as any;
    if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
      setUserHeading(e.webkitCompassHeading);
    } else if (event.alpha !== null) {
      setUserHeading(360 - event.alpha);
    }
  }, []);

  useEffect(() => {
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, [handleOrientation]);

  // Geolocation trigger
  function startLocationTracking() {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      setMockMode(true);
      return;
    }

    // Trigger iOS orientation permission request if available
    const DeviceEvent = window.DeviceOrientationEvent as any;
    if (DeviceEvent && typeof DeviceEvent.requestPermission === 'function') {
      DeviceEvent.requestPermission()
        .then((state: string) => {
          if (state === 'granted') {
            console.log('Compass permission granted on auto-start');
          }
        })
        .catch((err: any) => console.warn('Compass permission auto-start request ignored/rejected:', err));
    }

    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude: rawLat, longitude: rawLng, accuracy, heading: gpsHeading } = position.coords;
        const { lat, lng } = filterRef.current.filter(rawLat, rawLng, accuracy, position.timestamp || Date.now());

        // Detect user movement direction/bearing from hardware GPS or coordinate delta
        if (gpsHeading !== null && gpsHeading !== undefined && !isNaN(gpsHeading) && gpsHeading >= 0) {
          setUserHeading(gpsHeading);
        } else if (lastGpsCoordsRef.current) {
          const dist = getDistance(lastGpsCoordsRef.current.lat, lastGpsCoordsRef.current.lng, lat, lng);
          if (dist >= 1.2) {
            const bearing = calculateMovementBearing(lastGpsCoordsRef.current.lat, lastGpsCoordsRef.current.lng, lat, lng);
            setUserHeading(bearing);
            lastGpsCoordsRef.current = { lat, lng };
          }
        } else {
          lastGpsCoordsRef.current = { lat, lng };
        }

        // If the visitor calibrated at an indoor QR checkpoint, suppress poor GPS jumps (>12m)
        if (calibratedLocationRef.current && accuracy && accuracy > 12) {
          return;
        }

        setUserLat(lat);
        setUserLng(lng);
        setGpsAccuracy(accuracy ?? null);
        if (accuracy && accuracy <= 15) {
          setDismissedLowGps(false);
        }
        setGpsError(null);
        setMockMode(false);

        // On the first real GPS fix, center the map on the user and mark it
        // so the node/store fallback in loadNavigationResources never overrides it.
        if (!hasGPSCenteredRef.current) {
          hasGPSCenteredRef.current = true;
          setMapCenterLat(lat);
          setMapCenterLng(lng);
        }

        // Proximity and Premises Bounds Checks
        const currentSettings = exhibitionSettingsRef.current;
        if (currentSettings.school_boundary_enabled === false) {
          setIsFarAway(false);
        } else {
          const distToCenter = getDistance(lat, lng, currentSettings.premises_center_latitude, currentSettings.premises_center_longitude);
          const far = distToCenter > currentSettings.premises_radius_meters;

          if (bypassBoundaryCheckRef.current) {
            setIsFarAway(false);
          } else {
            setIsFarAway(far);
          }
        }
      },
      (error) => {
        console.warn('GPS location tracking error:', error.message);
        setGpsError('GPS permission denied or signal lost. Switch to mockup selector.');
        setMockMode(true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // Handle proximity checks in mock location mode
  useEffect(() => {
    if (mockMode && mockStartNodeId && nodes.length > 0) {
      const node = nodes.find(n => n.id === mockStartNodeId);
      if (node) {
        setUserLat(node.latitude);
        setUserLng(node.longitude);
        if (exhibitionSettings.school_boundary_enabled === false) {
          setIsFarAway(false);
        } else {
          const distToCenter = getDistance(node.latitude, node.longitude, exhibitionSettings.premises_center_latitude, exhibitionSettings.premises_center_longitude);
          const far = distToCenter > exhibitionSettings.premises_radius_meters;

          if (bypassBoundaryCheckRef.current) {
            setIsFarAway(false);
          } else {
            setIsFarAway(far);
          }
        }
      }
    }
  }, [mockMode, mockStartNodeId, nodes, exhibitionSettings, bypassBoundaryCheck]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (mockMode && profile?.role === 'admin') {
      if (userLat !== null && userLng !== null) {
        const dist = getDistance(userLat, userLng, lat, lng);
        if (dist > 0.5) {
          const bearing = calculateMovementBearing(userLat, userLng, lat, lng);
          setUserHeading(bearing);
        }
      }
      setUserLat(lat);
      setUserLng(lng);

      if (exhibitionSettings.school_boundary_enabled === false) {
        setIsFarAway(false);
      } else {
        const distToCenter = getDistance(lat, lng, exhibitionSettings.premises_center_latitude, exhibitionSettings.premises_center_longitude);
        const far = distToCenter > exhibitionSettings.premises_radius_meters;

        if (bypassBoundaryCheckRef.current) {
          setIsFarAway(false);
        } else {
          setIsFarAway(far);
        }
      }
    }
  }, [mockMode, exhibitionSettings, profile?.role, userLat, userLng]);

  const handleSelectMockLocation = (presetOrNodeId: string) => {
    setMockMode(true);
    setMockStartNodeId(presetOrNodeId);

    const allEntrances = getAllEntrancePoints(nodes, exhibitionSettings);

    if (presetOrNodeId === 'entrance') {
      const currentLat = userLat ?? mapCenterLat;
      const currentLng = userLng ?? mapCenterLng;
      const best = findShortestDistanceEntrance(allEntrances, currentLat, currentLng, currentLat, currentLng);
      setUserLat(best.latitude);
      setUserLng(best.longitude);
      setIsFarAway(false);
      if (best.node) setMockStartNodeId(best.node.id);
    } else if (presetOrNodeId === 'center') {
      const lat = exhibitionSettings.premises_center_latitude;
      const lng = exhibitionSettings.premises_center_longitude;
      setUserLat(lat);
      setUserLng(lng);
      setIsFarAway(false);
    } else if (presetOrNodeId === 'outside') {
      const lat = exhibitionSettings.premises_center_latitude + 0.006;
      const lng = exhibitionSettings.premises_center_longitude + 0.006;
      setUserLat(lat);
      setUserLng(lng);
      if (exhibitionSettings.school_boundary_enabled !== false && !bypassBoundaryCheckRef.current) {
        setIsFarAway(true);
      } else {
        setIsFarAway(false);
      }
    } else {
      const matchedEntrance = allEntrances.find(e => e.id === presetOrNodeId);
      if (matchedEntrance) {
        setUserLat(matchedEntrance.latitude);
        setUserLng(matchedEntrance.longitude);
        setIsFarAway(false);
        if (matchedEntrance.node) setMockStartNodeId(matchedEntrance.node.id);
        return;
      }
      const node = nodes.find(n => n.id === presetOrNodeId);
      if (node) {
        setUserLat(node.latitude);
        setUserLng(node.longitude);
        setIsFarAway(false);
      }
    }
  };

  /** Compute navigation route strictly for the current single active leg of the guided tour */
  const routeToTourStop = async (
    fromLat: number,
    fromLng: number,
    targetStore: StoreType,
    stopIndex: number,
    totalStops: number
  ) => {
    const storeIdx = stores.findIndex((s) => s.id === targetStore.id);
    const campusLoc = getCampusStoreLocation(targetStore, storeIdx >= 0 ? storeIdx : 0);
    const targetLat = targetStore.latitude ?? campusLoc.lat;
    const targetLng = targetStore.longitude ?? campusLoc.lng;

    const allEntrances = getAllEntrancePoints(nodes, exhibitionSettings);
    const bestEntrance = findShortestDistanceEntrance(allEntrances, fromLat, fromLng, targetLat, targetLng);
    const closestEntrance = bestEntrance.node || nodes.find(n => n.id === bestEntrance.id) || null;
    const entranceLat = bestEntrance.latitude;
    const entranceLng = bestEntrance.longitude;
    const entranceLabel = bestEntrance.label;

    const VENUE_RADIUS = exhibitionSettings.premises_radius_meters || 150;
    const isNearGraph = isPointNearVenueGraph(fromLat, fromLng, nodes, edges, 65);
    const isOutsideVenue = !isNearGraph && getDistance(fromLat, fromLng, entranceLat, entranceLng) > VENUE_RADIUS;
    const isTargetNearGraph = isPointNearVenueGraph(targetLat, targetLng, nodes, edges, 65);
    const isTargetIsolated = !isTargetNearGraph && getDistance(targetLat, targetLng, entranceLat, entranceLng) > 500;

    const storeTargetVirtualNode: NavigationNode = {
      id: `store-stop-${targetStore.id}`,
      label: targetStore.name,
      latitude: targetLat,
      longitude: targetLng,
      floor: targetStore.floor || '1',
      type: 'store',
      store_id: targetStore.id,
      created_at: new Date().toISOString(),
    };

    const sequencedRouteNodes: NavigationNode[] = [];
    let outdoorSegmentLen = 0;
    let totalDistVal = 0;
    const isExitGate = targetStore.id === 'venue-exit-gate-stop';
    const actualStallsCount = tourStops.filter((s) => s.id !== 'venue-exit-gate-stop').length || totalStops;
    const steps: string[] = isExitGate
      ? [`🚪 Final Step: Proceed to Exit Gate (${targetStore.name})`]
      : [`📍 Tour Stop ${stopIndex + 1} of ${actualStallsCount}: ${targetStore.name}`];

    if (isTargetIsolated) {
      // Standalone store outside any entrance venue: direct OSRM
      const osrmResult = await fetchOSRMRoute(
        fromLat,
        fromLng,
        targetLat,
        targetLng,
        'Your Location',
        targetStore.name
      );
      if (osrmResult && osrmResult.nodes.length > 1) {
        sequencedRouteNodes.push(...osrmResult.nodes);
        outdoorSegmentLen = osrmResult.nodes.length;
        if (osrmResult.guideSteps && osrmResult.guideSteps.length > 0) {
          steps.push(...osrmResult.guideSteps);
        }
        totalDistVal += osrmResult.totalDistanceMeters ?? 0;
      } else {
        const outdoorVirtual: NavigationNode = {
          id: 'tour-outdoor-virtual',
          label: 'Your Location',
          latitude: fromLat,
          longitude: fromLng,
          floor: '1',
          type: 'poi',
          store_id: null,
          created_at: new Date().toISOString()
        };
        sequencedRouteNodes.push(outdoorVirtual, storeTargetVirtualNode);
        outdoorSegmentLen = 2;
        totalDistVal += getDistance(fromLat, fromLng, targetLat, targetLng);
      }
      steps.push(isExitGate ? `Arrive at Exit Gate: ${targetStore.name}` : `Arrive at Stop ${stopIndex + 1}: ${targetStore.name}`);
    } else if (isOutsideVenue) {
      // User is outside the venue of this stop: route via OSRM to the shortest distance entrance gate, then node paths inside
      const osrmResult = await fetchOSRMRoute(
        fromLat,
        fromLng,
        entranceLat,
        entranceLng,
        'Your Location',
        entranceLabel
      );

      if (osrmResult && osrmResult.nodes.length > 1) {
        const outdoorNodes = osrmResult.nodes.slice(0, -1);
        sequencedRouteNodes.push(...outdoorNodes);
        outdoorSegmentLen = outdoorNodes.length;
        if (osrmResult.guideSteps && osrmResult.guideSteps.length > 0) {
          steps.push(...osrmResult.guideSteps);
        }
        totalDistVal += osrmResult.totalDistanceMeters ?? 0;
      } else {
        const outdoorVirtual: NavigationNode = {
          id: 'tour-outdoor-virtual',
          label: 'Your Location',
          latitude: fromLat,
          longitude: fromLng,
          floor: '1',
          type: 'poi',
          store_id: null,
          created_at: new Date().toISOString()
        };
        sequencedRouteNodes.push(outdoorVirtual);
        outdoorSegmentLen = 1;
        totalDistVal += getDistance(fromLat, fromLng, entranceLat, entranceLng);
      }

      // Entrance gate handoff point
      const gateNode: NavigationNode = closestEntrance ? {
        ...closestEntrance,
        label: closestEntrance.label || entranceLabel,
      } : {
        id: bestEntrance.id,
        label: entranceLabel,
        latitude: entranceLat,
        longitude: entranceLng,
        floor: '1',
        type: 'entrance',
        store_id: null,
        created_at: new Date().toISOString()
      };
      sequencedRouteNodes.push(gateNode);
      steps.push(`🏫 Enter through ${entranceLabel}`);

      // From entrance gate to target store using the node paths (Dijkstra)
      const indoorP = calculateShortestPathBetweenCoordinates(
        entranceLat,
        entranceLng,
        targetLat,
        targetLng,
        nodes,
        edges,
        closestEntrance?.id || null
      );

      if (indoorP && indoorP.length > 0) {
        const skipFirst = indoorP[0].id === gateNode.id ||
          getDistance(indoorP[0].latitude, indoorP[0].longitude, gateNode.latitude, gateNode.longitude) < 2;
        const remainingIndoor = skipFirst ? indoorP.slice(1) : indoorP;
        sequencedRouteNodes.push(...remainingIndoor);

        for (let i = 0; i < remainingIndoor.length - 1; i++) {
          const from = remainingIndoor[i];
          const to = remainingIndoor[i + 1];
          const d = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
          totalDistVal += d;
          const h = getHeading(from.latitude, from.longitude, to.latitude, to.longitude);
          steps.push(`Head ${h} towards ${to.label} (${Math.round(d)}m)`);
        }

        const lastNode = sequencedRouteNodes[sequencedRouteNodes.length - 1];
        if (getDistance(lastNode.latitude, lastNode.longitude, targetLat, targetLng) > 1.5) {
          sequencedRouteNodes.push(storeTargetVirtualNode);
          totalDistVal += getDistance(lastNode.latitude, lastNode.longitude, targetLat, targetLng);
        }
      } else {
        sequencedRouteNodes.push(storeTargetVirtualNode);
        totalDistVal += getDistance(entranceLat, entranceLng, targetLat, targetLng);
      }
      steps.push(isExitGate ? `Arrive at Exit Gate: ${targetStore.name}` : `Arrive at Stop ${stopIndex + 1}: ${targetStore.name}`);
    } else {
      // ── INSIDE VENUE ────────────────────────────────────────────────────────
      // Inside the venue: use venue node paths directly to tour stall
      const startVirtualNode: NavigationNode = {
        id: 'tour-start-point',
        label: 'Your Location',
        latitude: fromLat,
        longitude: fromLng,
        floor: '1',
        type: 'entrance',
        store_id: null,
        created_at: new Date().toISOString(),
      };
      sequencedRouteNodes.push(startVirtualNode);

      const p = calculateShortestPathBetweenCoordinates(
        fromLat,
        fromLng,
        targetLat,
        targetLng,
        nodes,
        edges
      );

      if (p && p.length > 0) {
        if (sequencedRouteNodes.length > 0 && p[0].id === sequencedRouteNodes[sequencedRouteNodes.length - 1].id) {
          sequencedRouteNodes.push(...p.slice(1));
        } else {
          sequencedRouteNodes.push(...p);
        }

        const lastWalkwayNode = p[p.length - 1];
        const distToStore = getDistance(lastWalkwayNode.latitude, lastWalkwayNode.longitude, targetLat, targetLng);
        if (distToStore > 1.5) {
          sequencedRouteNodes.push(storeTargetVirtualNode);
        }
      } else {
        sequencedRouteNodes.push(storeTargetVirtualNode);
      }

      for (let i = 0; i < sequencedRouteNodes.length - 1; i++) {
        const from = sequencedRouteNodes[i];
        const to = sequencedRouteNodes[i + 1];
        const dist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
        totalDistVal += dist;
        if (to.type === 'store' || to.id.startsWith('store-stop-')) {
          steps.push(isExitGate ? `Arrive at: ${to.label} (${Math.round(dist)}m)` : `Arrive at: ${to.label} (${Math.round(dist)}m)`);
        } else {
          const h = getHeading(from.latitude, from.longitude, to.latitude, to.longitude);
          steps.push(`Head ${h} towards ${to.label} (${Math.round(dist)}m)`);
        }
      }
    }

    setOutdoorSegmentCount(outdoorSegmentLen);
    setCalculatedRoute(sequencedRouteNodes);
    setTotalDistance(Math.round(totalDistVal));
    setGuideSteps(steps);
    setNavigationActive(true);
  };

  const generateGuidedTourRouteForStores = (targetStores: StoreType[]) => {
    // 1. Determine starting point coordinates
    let startLatVal = userLat;
    let startLngVal = userLng;

    if (startLatVal === null || startLngVal === null) {
      if (mockStartNodeId) {
        const startNode = nodes.find((n) => n.id === mockStartNodeId);
        if (startNode) {
          startLatVal = startNode.latitude;
          startLngVal = startNode.longitude;
        }
      }
      if (startLatVal === null || startLngVal === null) {
        const entranceNode =
          nodes.find(
            (n) =>
              n.type === 'entrance' ||
              n.label.toLowerCase().includes('node 1') ||
              n.label.toLowerCase().includes('entrance')
          ) || nodes[0];
        if (entranceNode) {
          startLatVal = entranceNode.latitude;
          startLngVal = entranceNode.longitude;
        } else {
          startLatVal = exhibitionSettings.entrance_latitude || 6.53586;
          startLngVal = exhibitionSettings.entrance_longitude || 80.40035;
        }
      }
    }

    if (targetStores.length === 0) {
      alert('Please select at least one stall to visit on your tour!');
      return;
    }

    // Ensure valid coordinates for all target stalls
    const preparedStores: StoreType[] = targetStores.map((st, idx) => {
      const sIdx = stores.findIndex(s => s.id === st.id);
      const campusLoc = getCampusStoreLocation(st, sIdx >= 0 ? sIdx : idx);
      return {
        ...st,
        latitude: st.latitude ?? campusLoc.lat,
        longitude: st.longitude ?? campusLoc.lng,
      };
    });

    setLoading(true);

    // 2. Identify designated Exit Gate for this venue
    const designatedExitGate = getDesignatedExitGate(nodes, exhibitionSettings);

    // 3. Solve Fixed-Endpoint TSP (Start -> Stalls in optimal sequence -> Exit Gate)
    // to strictly MINIMIZE the visitor's total walking distance!
    const tourOptimization = optimizeStallVisitOrderWithExitGate(
      {
        id: 'tour-user-start',
        label: 'Tour Start',
        latitude: startLatVal,
        longitude: startLngVal,
      },
      designatedExitGate,
      preparedStores,
      nodes,
      edges
    );

    // 4. Create virtual Exit Gate store representation as final tour destination
    const exitGateStore: StoreType = {
      id: 'venue-exit-gate-stop',
      name: designatedExitGate.label || 'Exit Gate',
      description: 'Designated Exhibition Exit Gate — Conclude your visit here',
      floor: designatedExitGate.floor || '1',
      latitude: designatedExitGate.latitude,
      longitude: designatedExitGate.longitude,
      logo_url: null,
      category_id: null,
      exhibition_id: null,
      opening_time: null,
      closing_time: null,
      phone: null,
      email: null,
      website: null,
      is_active: true,
      created_by: null,
      store_admin_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const orderedTourStops: StoreType[] = [
      ...tourOptimization.orderedStalls,
      exitGateStore,
    ];

    setLoading(false);

    if (orderedTourStops.length > 0) {
      setTourStops(orderedTourStops);
      setCurrentTourStopIndex(0);
      lastPromptedStopIdRef.current = null;
      lastTourRoutePositionRef.current = null;
      setArrivedStopPrompt(null);
      setSelectedDestinationStoreId('');
      setSelectedDestinationNodeId('');
      setGuidedTourActive(true);
      setNavigationActive(true);
      setNavSheetState('normal');

      // Center map on starting position or first stop
      if (orderedTourStops[0].latitude && orderedTourStops[0].longitude) {
        setMapCenterLat(orderedTourStops[0].latitude);
        setMapCenterLng(orderedTourStops[0].longitude);
      }

      // Route strictly to Stop 1 (the first/closest stall)
      routeToTourStop(startLatVal, startLngVal, orderedTourStops[0], 0, orderedTourStops.length);
    } else {
      alert('Could not compute routing path. Please check network graph or stall locations.');
    }
  };


  const handleMarkStopVisited = (storeToMark: StoreType) => {
    const updatedVisited = Array.from(new Set([...visitedStallIds, storeToMark.id]));
    setVisitedStallIds(updatedVisited);
    setArrivedStopPrompt(null);

    // If guided tour is active
    if (guidedTourActive && tourStops.length > 0) {
      const actualStalls = tourStops.filter((s) => s.id !== 'venue-exit-gate-stop');

      // 1. If user marks the Exit Gate as visited, the whole tour is finished!
      if (storeToMark.id === 'venue-exit-gate-stop') {
        setGuidedTourActive(false);
        setCalculatedRoute([]);
        setNavigationActive(false);
        setCompletedTourStats({
          totalStalls: actualStalls.length,
          totalVisited: updatedVisited.filter((id) =>
            actualStalls.some((s) => s.id === id)
          ).length,
        });
        setShowTourCompletedModal(true);
        return;
      }

      // 2. Check if all actual stalls (excluding exit gate) are now visited
      const allStallsVisited = actualStalls.every((s) => updatedVisited.includes(s.id));

      if (allStallsVisited) {
        // All stalls have been visited! Transition tour directly to the Exit Gate!
        const exitGateIndex = tourStops.findIndex((s) => s.id === 'venue-exit-gate-stop');
        if (exitGateIndex >= 0) {
          setCurrentTourStopIndex(exitGateIndex);
          const fromLat = userLat !== null ? userLat : (storeToMark.latitude || 6.535472);
          const fromLng = userLng !== null ? userLng : (storeToMark.longitude || 80.401000);
          routeToTourStop(fromLat, fromLng, tourStops[exitGateIndex], exitGateIndex, tourStops.length);
          return;
        } else {
          setGuidedTourActive(false);
          setCalculatedRoute([]);
          setNavigationActive(false);
          setCompletedTourStats({
            totalStalls: actualStalls.length,
            totalVisited: updatedVisited.filter((id) => actualStalls.some((s) => s.id === id)).length,
          });
          setShowTourCompletedModal(true);
          return;
        }
      }

      // 3. Otherwise advance to the next unvisited stall sequentially
      let nextIndex = currentTourStopIndex + 1;
      while (nextIndex < tourStops.length && updatedVisited.includes(tourStops[nextIndex].id)) {
        nextIndex++;
      }
      if (nextIndex < tourStops.length) {
        setCurrentTourStopIndex(nextIndex);
        const fromLat = userLat !== null ? userLat : (storeToMark.latitude || 6.535472);
        const fromLng = userLng !== null ? userLng : (storeToMark.longitude || 80.401000);
        routeToTourStop(fromLat, fromLng, tourStops[nextIndex], nextIndex, tourStops.length);
      } else {
        // Check for any remaining unvisited stall from beginning of tour
        const remainingIndex = tourStops.findIndex((s) => !updatedVisited.includes(s.id));
        if (remainingIndex >= 0) {
          setCurrentTourStopIndex(remainingIndex);
          const fromLat = userLat !== null ? userLat : (storeToMark.latitude || 6.535472);
          const fromLng = userLng !== null ? userLng : (storeToMark.longitude || 80.401000);
          routeToTourStop(fromLat, fromLng, tourStops[remainingIndex], remainingIndex, tourStops.length);
        } else {
          setGuidedTourActive(false);
          setCalculatedRoute([]);
          setNavigationActive(false);
          setCompletedTourStats({
            totalStalls: actualStalls.length,
            totalVisited: updatedVisited.filter((id) => actualStalls.some((s) => s.id === id)).length,
          });
          setShowTourCompletedModal(true);
        }
      }
    } else {
      // Outside guided tour mode
      if (selectedDestinationStoreId === storeToMark.id) {
        setSelectedDestinationStoreId('');
      }
    }
  };

  const handleMarkCurrentStopVisited = () => {
    if (tourStops[currentTourStopIndex]) {
      handleMarkStopVisited(tourStops[currentTourStopIndex]);
    }
  };

  /** Skip the current stall and advance directly to the next planned stall without marking it visited */
  const handleSkipCurrentStop = () => {
    if (!guidedTourActive || tourStops.length === 0) return;

    const currentStop = tourStops[currentTourStopIndex];
    const actualStalls = tourStops.filter((s) => s.id !== 'venue-exit-gate-stop');

    if (currentStop?.id === 'venue-exit-gate-stop') {
      // Skipping exit gate completes the tour
      setGuidedTourActive(false);
      setCalculatedRoute([]);
      setNavigationActive(false);
      setCompletedTourStats({
        totalStalls: actualStalls.length,
        totalVisited: visitedStallIds.filter((id) => actualStalls.some((s) => s.id === id)).length,
      });
      setShowTourCompletedModal(true);
      return;
    }

    const nextIndex = currentTourStopIndex + 1;
    if (nextIndex < tourStops.length) {
      setCurrentTourStopIndex(nextIndex);
      lastTourRoutePositionRef.current = null;
      lastPromptedStopIdRef.current = null;
      setArrivedStopPrompt(null);

      const fromLat = userLat !== null ? userLat : (currentStop?.latitude || 6.535472);
      const fromLng = userLng !== null ? userLng : (currentStop?.longitude || 80.401000);
      routeToTourStop(fromLat, fromLng, tourStops[nextIndex], nextIndex, tourStops.length);
    } else {
      // Skipping final item completes the tour
      setGuidedTourActive(false);
      setCalculatedRoute([]);
      setNavigationActive(false);
      setCompletedTourStats({
        totalStalls: actualStalls.length,
        totalVisited: visitedStallIds.filter((id) => actualStalls.some((s) => s.id === id)).length,
      });
      setShowTourCompletedModal(true);
    }
  };

  /** Navigate back to the previous stall in the tour */
  const handlePreviousStop = () => {
    if (!guidedTourActive || tourStops.length === 0 || currentTourStopIndex <= 0) return;
    const prevIndex = currentTourStopIndex - 1;
    setCurrentTourStopIndex(prevIndex);
    lastTourRoutePositionRef.current = null;
    lastPromptedStopIdRef.current = null;
    setArrivedStopPrompt(null);

    const currentStop = tourStops[currentTourStopIndex];
    const fromLat = userLat !== null ? userLat : (currentStop?.latitude || 6.535472);
    const fromLng = userLng !== null ? userLng : (currentStop?.longitude || 80.401000);
    routeToTourStop(fromLat, fromLng, tourStops[prevIndex], prevIndex, tourStops.length);
  };

  /** Jump directly to any stall in the active tour sequence */
  const handleJumpToTourStop = (index: number, forceReroute = false) => {
    if (!guidedTourActive || index < 0 || index >= tourStops.length) return;
    if (index === currentTourStopIndex && !forceReroute) return;
    setCurrentTourStopIndex(index);
    lastTourRoutePositionRef.current = null;
    lastPromptedStopIdRef.current = null;
    setArrivedStopPrompt(null);

    const currentStop = tourStops[currentTourStopIndex];
    const fromLat = userLat !== null ? userLat : (currentStop?.latitude || 6.535472);
    const fromLng = userLng !== null ? userLng : (currentStop?.longitude || 80.401000);
    routeToTourStop(fromLat, fromLng, tourStops[index], index, tourStops.length);
  };

  /** Unmark a stall as visited (e.g. if pressed accidentally, or to revisit) */
  const handleUnmarkStopVisited = (storeId: string, shouldNavigateThere: boolean = false) => {
    setVisitedStallIds((prev) => prev.filter((id) => id !== storeId));

    if (shouldNavigateThere) {
      if (guidedTourActive && tourStops.length > 0) {
        const stopIdx = tourStops.findIndex((s) => s.id === storeId);
        if (stopIdx >= 0) {
          handleJumpToTourStop(stopIdx, true);
        }
      } else {
        setSelectedDestinationStoreId(storeId);
        setSelectedDestinationNodeId('');
        setNavigationActive(true);
        const storeObj = stores.find((s) => s.id === storeId);
        if (storeObj && storeObj.latitude && storeObj.longitude) {
          setMapCenterLat(storeObj.latitude);
          setMapCenterLng(storeObj.longitude);
        }
      }
    }
  };

  const handleCancelTour = () => {
    setGuidedTourActive(false);
    setCalculatedRoute([]);
    setNavigationActive(false);
    setTourStops([]);
    setCurrentTourStopIndex(0);
    setArrivedStopPrompt(null);
    lastPromptedStopIdRef.current = null;
    lastTourRoutePositionRef.current = null;
    setActivePitstopDetour(null);
    navigate('/');
  };

  // Pitstop Detour Handlers
  const handleSelectPitstopFacility = (facility: StoreType) => {
    setActivePitstopDetour({
      originalType: guidedTourActive ? 'tour' : 'single',
      originalDestinationStoreId: selectedDestinationStoreId,
      originalDestinationNodeId: selectedDestinationNodeId,
      originalTourStops: [...tourStops],
      originalTourStopIndex: currentTourStopIndex,
      facility,
    });

    // Temporarily pause guided tour mode if active and navigate to facility
    if (guidedTourActive) {
      setGuidedTourActive(false);
    }
    setSelectedDestinationStoreId(facility.id);
    setSelectedDestinationNodeId('');
    setNavigationActive(true);
    setNavSheetState('normal');
  };

  const handleResumeOriginalRoute = () => {
    if (!activePitstopDetour) return;

    const detour = activePitstopDetour;
    setActivePitstopDetour(null);

    if (detour.originalType === 'tour' && detour.originalTourStops.length > 0) {
      setTourStops(detour.originalTourStops);
      setCurrentTourStopIndex(detour.originalTourStopIndex);
      setGuidedTourActive(true);
      setNavigationActive(true);
      const targetStop = detour.originalTourStops[detour.originalTourStopIndex];
      if (targetStop) {
        setSelectedDestinationStoreId(targetStop.id);
        setSelectedDestinationNodeId('');
        const fromLat = userLat !== null ? userLat : (detour.facility.latitude || 6.535472);
        const fromLng = userLng !== null ? userLng : (detour.facility.longitude || 80.401000);
        routeToTourStop(fromLat, fromLng, targetStop, detour.originalTourStopIndex, detour.originalTourStops.length);
      }
    } else {
      setSelectedDestinationStoreId(detour.originalDestinationStoreId);
      setSelectedDestinationNodeId(detour.originalDestinationNodeId);
      setNavigationActive(true);
    }
  };

  // Automatic Proximity Arrival Detector (7m radius) — works in tour mode and general exploration
  const TOUR_ARRIVAL_THRESHOLD_METERS = 7;
  useEffect(() => {
    if (userLat === null || userLng === null) return;
    if (stores.length === 0) return;

    const realStores = stores.filter((s) => s.id !== 'kalawana-national-school-landmark');
    if (realStores.length === 0) return;

    // Find the closest unvisited store within TOUR_ARRIVAL_THRESHOLD_METERS (7m)
    let closestStore: StoreType | null = null;
    let closestDist = Infinity;

    for (let idx = 0; idx < realStores.length; idx++) {
      const store = realStores[idx];
      if (visitedStallIds.includes(store.id)) continue;

      const campusPos = getCampusStoreLocation(store, idx);
      const targetLat = store.latitude ?? campusPos.lat;
      const targetLng = store.longitude ?? campusPos.lng;

      if (targetLat != null && targetLng != null) {
        const d = getDistance(userLat, userLng, targetLat, targetLng);
        if (d <= TOUR_ARRIVAL_THRESHOLD_METERS && d < closestDist) {
          closestDist = d;
          closestStore = store;
        }
      }
    }

    if (closestStore) {
      if (lastPromptedStopIdRef.current !== closestStore.id) {
        lastPromptedStopIdRef.current = closestStore.id;
        setArrivedStopPrompt(closestStore);
      }
    } else if (lastPromptedStopIdRef.current) {
      // If user moved away (> 14m) from the last prompted store, reset ref and dismiss the card
      // so they can be prompted again upon returning
      const lastStore = realStores.find((s) => s.id === lastPromptedStopIdRef.current);
      if (lastStore) {
        const sIdx = realStores.indexOf(lastStore);
        const campusPos = getCampusStoreLocation(lastStore, sIdx >= 0 ? sIdx : 0);
        const tLat = lastStore.latitude ?? campusPos.lat;
        const tLng = lastStore.longitude ?? campusPos.lng;
        if (tLat != null && tLng != null && getDistance(userLat, userLng, tLat, tLng) > 14) {
          lastPromptedStopIdRef.current = null;
          // Auto-dismiss the prompt card — user has walked away from this stall
          setArrivedStopPrompt(null);
        }
      }
    }
  }, [userLat, userLng, visitedStallIds, stores]);

  // Handle deep-linking navigation targets via query parameters & QR code indoor calibration
  useEffect(() => {
    // 1. QR Code Indoor Location Calibration Check
    const calParam = searchParams.get('calibrate');
    if (calParam) {
      const latStr = searchParams.get('lat');
      const lngStr = searchParams.get('lng');
      const lat = latStr ? parseFloat(latStr) : NaN;
      const lng = lngStr ? parseFloat(lngStr) : NaN;
      const label = searchParams.get('label') || 'Checkpoint';
      const floor = searchParams.get('floor') || '1';
      const id = searchParams.get('id');

      if (!isNaN(lat) && !isNaN(lng)) {
        const calInfo = {
          id,
          label,
          lat,
          lng,
          floor,
          calibratedAt: Date.now(),
        };
        setCalibratedLocation(calInfo);
        calibratedLocationRef.current = calInfo;

        setUserLat(lat);
        setUserLng(lng);
        setMapCenterLat(lat);
        setMapCenterLng(lng);
        setBypassBoundaryCheck(true);
        hasGPSCenteredRef.current = true;
        setMockMode(false);

        // Remove calibration params from URL cleanly to avoid re-triggering on refresh
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('calibrate');
        nextParams.delete('lat');
        nextParams.delete('lng');
        nextParams.delete('label');
        nextParams.delete('floor');
        nextParams.delete('id');
        setSearchParams(nextParams, { replace: true });
      }
    }

    // Deep link directly to a pre-selected tour of stalls (from HomePage or link)
    const tourStallsParam = searchParams.get('tourStalls');
    if (tourStallsParam && stores.length > 0) {
      const stallIds = tourStallsParam.split(',').map((s) => s.trim()).filter(Boolean);
      const matchedStores = stores.filter((s) => stallIds.includes(s.id));
      if (matchedStores.length > 0) {
        generateGuidedTourRouteForStores(matchedStores);
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('tourStalls');
      setSearchParams(nextParams, { replace: true });
    }

    const toParam = searchParams.get('to');
    const toNodeParam = searchParams.get('toNode');
    if (toParam && stores.length > 0) {
      setSelectedDestinationStoreId(toParam);
      setSelectedDestinationNodeId('');
      setSearchParams({});
    } else if (toNodeParam && nodes.length > 0) {
      setSelectedDestinationNodeId(toNodeParam);
      setSelectedDestinationStoreId('');
      setSearchParams({});
    }
  }, [searchParams, stores, nodes, setSearchParams, setBypassBoundaryCheck]);

  // Main pathfinder computation trigger
  useEffect(() => {
    if (selectedDestinationStoreId || selectedDestinationNodeId) {
      calculateRoutePath();
    } else if (guidedTourActive && tourStops.length > 0) {
      setNavigationActive(true);
      // Maintain guided tour route and update current leg as user walks with GPS.
      // Throttle: only recalculate when stop changes OR user moved >= TOUR_REROUTE_THRESHOLD_METERS.
      const currentStop = tourStops[currentTourStopIndex];
      if (currentStop) {
        let fromLat = userLat;
        let fromLng = userLng;
        if (fromLat === null || fromLng === null) {
          if (mockStartNodeId) {
            const mockNode = nodes.find((n) => n.id === mockStartNodeId);
            if (mockNode) {
              fromLat = mockNode.latitude;
              fromLng = mockNode.longitude;
            }
          }
        }
        if (fromLat !== null && fromLng !== null) {
          const lastPos = lastTourRoutePositionRef.current;
          const stopChanged = !lastPos || lastPos.stopId !== currentStop.id;
          const movedEnough = !lastPos || getDistance(fromLat, fromLng, lastPos.lat, lastPos.lng) >= TOUR_REROUTE_THRESHOLD_METERS;
          if (stopChanged || movedEnough) {
            lastTourRoutePositionRef.current = { lat: fromLat, lng: fromLng, stopId: currentStop.id };
            routeToTourStop(fromLat, fromLng, currentStop, currentTourStopIndex, tourStops.length);
          }
        }
      }
    } else if (!guidedTourActive) {
      lastTourRoutePositionRef.current = null;
      setCalculatedRoute([]);
      setTotalDistance(0);
      setGuideSteps([]);
      setNavigationActive(false);
      setOutdoorSegmentCount(0);
      lastLoggedDestinationRef.current = '';
      lastOSRMRouteRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDestinationStoreId, selectedDestinationNodeId, userLat, userLng, mockMode, mockStartNodeId, nodes, edges, guidedTourActive, currentTourStopIndex, tourStops]);

  // Compute route path
  async function calculateRoutePath() {
    if (!selectedDestinationStoreId && !selectedDestinationNodeId) return;

    let targetLat: number | null = null;
    let targetLng: number | null = null;
    let targetLabel = '';

    // 1. Find destination target coordinates
    if (selectedDestinationStoreId) {
      const destinationStore = stores.find((s) => s.id === selectedDestinationStoreId);
      if (!destinationStore) return;
      targetLabel = destinationStore.name;
      const storeIdx = stores.findIndex(s => s.id === selectedDestinationStoreId);
      const campusLoc = getCampusStoreLocation(destinationStore, storeIdx >= 0 ? storeIdx : 0);
      targetLat = destinationStore.latitude ?? campusLoc.lat;
      targetLng = destinationStore.longitude ?? campusLoc.lng;
    } else if (selectedDestinationNodeId) {
      const destinationNode = nodes.find((n) => n.id === selectedDestinationNodeId);
      if (!destinationNode) return;
      targetLabel = destinationNode.label;
      targetLat = destinationNode.latitude;
      targetLng = destinationNode.longitude;
    }

    const destId = selectedDestinationStoreId || selectedDestinationNodeId;
    if (destId && destId !== lastLoggedDestinationRef.current) {
      lastLoggedDestinationRef.current = destId;
      logAnalyticsEvent('route_calculation', destId, targetLabel);
      recordStallEngagement(destId, targetLabel, 'route');
    }

    if (targetLat === null || targetLng === null) {
      console.warn('Destination target is missing coordinates.');
      return;
    }

    // 2. Determine starting coordinates
    let startLat = mapCenterLat;
    let startLng = mapCenterLng;
    let startLabel = 'Starting Entrance';

    if (userLat !== null && userLng !== null) {
      startLat = userLat;
      startLng = userLng;
      startLabel = 'Your Location';
    } else if (mockStartNodeId) {
      const mockNode = nodes.find((n) => n.id === mockStartNodeId);
      if (mockNode) {
        startLat = mockNode.latitude;
        startLng = mockNode.longitude;
        startLabel = mockNode.label;
      }
    } else if (nodes.length > 0) {
      const entrances = nodes.filter((n) => n.type === 'entrance');
      const fallbackNode = entrances.length > 0 ? entrances[0] : nodes[0];
      startLat = fallbackNode.latitude;
      startLng = fallbackNode.longitude;
      startLabel = fallbackNode.label;
    }

    // 3. Hybrid routing pipeline:
    //   a. Detect if user is outside campus boundary
    //   b. If outside → OSRM outdoor street route from user to nearest entrance node
    //   c. Inside campus → Dijkstra through drawn edges, starting from entrance
    //   d. Assemble: [OSM nodes] → [Graph nodes] → [Store real coords]

    // 3. Find entrance with the shortest distance among all entrances
    const allEntrances = getAllEntrancePoints(nodes, exhibitionSettings);
    const bestEntrance = findShortestDistanceEntrance(allEntrances, startLat, startLng, targetLat, targetLng);
    const closestEntrance = bestEntrance.node || nodes.find(n => n.id === bestEntrance.id) || null;
    const entranceLat = bestEntrance.latitude;
    const entranceLng = bestEntrance.longitude;
    const entranceLabel = bestEntrance.label;

    const VENUE_RADIUS = exhibitionSettings.premises_radius_meters || 150;
    const distFromEntrance = getDistance(startLat, startLng, entranceLat, entranceLng);
    const isNearGraph = isPointNearVenueGraph(startLat, startLng, nodes, edges, 65);
    const isOutsideVenue = !isNearGraph && distFromEntrance > VENUE_RADIUS;
    setIsFarAway(isOutsideVenue); // keep UI state in sync

    const isTargetNearGraph = isPointNearVenueGraph(targetLat, targetLng, nodes, edges, 65);
    const targetDistFromEntrance = getDistance(targetLat, targetLng, entranceLat, entranceLng);
    const isTargetIsolated = !isTargetNearGraph && targetDistFromEntrance > 500;

    const destEndVirtualNode: NavigationNode = {
      id: 'actual-end-virtual',
      label: targetLabel,
      latitude: targetLat,
      longitude: targetLng,
      floor: null,
      type: 'store',
      store_id: selectedDestinationStoreId || null,
      created_at: new Date().toISOString()
    };
    const userStartVirtualNode: NavigationNode = {
      id: 'actual-start-virtual',
      label: startLabel,
      latitude: startLat,
      longitude: startLng,
      floor: null,
      type: 'poi',
      store_id: null,
      created_at: new Date().toISOString()
    };

    if (isTargetIsolated) {
      const destKey = selectedDestinationStoreId || selectedDestinationNodeId || 'target-isolated';
      const cached = lastOSRMRouteRef.current;
      const canUseCache =
        cached &&
        cached.destId === destKey &&
        getDistance(startLat, startLng, cached.startLat, cached.startLng) < 35;

      let outdoorNodes: NavigationNode[] = [];
      let osrmGuideSteps: string[] | null = null;
      let osrmTotalDistance: number | null = null;

      if (canUseCache) {
        outdoorNodes = cached.nodes;
        osrmGuideSteps = cached.guideSteps;
        osrmTotalDistance = cached.totalDistance;
      } else {
        const osrmResult = await fetchOSRMRoute(
          startLat,
          startLng,
          targetLat,
          targetLng,
          startLabel,
          targetLabel
        );
        if (osrmResult && osrmResult.nodes.length > 1) {
          outdoorNodes = osrmResult.nodes;
          osrmGuideSteps = osrmResult.guideSteps;
          osrmTotalDistance = osrmResult.totalDistanceMeters;
          lastOSRMRouteRef.current = {
            nodes: outdoorNodes,
            guideSteps: osrmGuideSteps,
            totalDistance: osrmTotalDistance,
            startLat,
            startLng,
            destId: destKey,
          };
        } else if (cached && cached.destId === destKey) {
          outdoorNodes = cached.nodes;
          osrmGuideSteps = cached.guideSteps;
          osrmTotalDistance = cached.totalDistance;
        } else {
          outdoorNodes = [userStartVirtualNode, destEndVirtualNode];
        }
      }

      const outRoute: NavigationNode[] = [...outdoorNodes];
      const lastNode = outRoute[outRoute.length - 1];
      if (!lastNode || getDistance(lastNode.latitude, lastNode.longitude, targetLat, targetLng) > 5) {
        outRoute.push(destEndVirtualNode);
      }

      setOutdoorSegmentCount(outRoute.length);
      setCalculatedRoute(outRoute);
      setNavigationActive(true);

      const steps: string[] = [];
      if (osrmGuideSteps && osrmGuideSteps.length > 0) {
        steps.push(...osrmGuideSteps);
      }
      steps.push(`Arrive at ${targetLabel}`);
      const distanceMeters = osrmTotalDistance ?? getDistance(startLat, startLng, targetLat, targetLng);
      setTotalDistance(Math.round(distanceMeters));
      setGuideSteps(steps);
      return;
    }

    let graphPath: NavigationNode[] = [];

    const storeNode = selectedDestinationStoreId ? nodes.find((n) => n.store_id === selectedDestinationStoreId) : null;
    const storeNodeHasEdges = storeNode ? edges.some((e) => e.from_node_id === storeNode.id || e.to_node_id === storeNode.id) : false;
    const destNode = selectedDestinationNodeId ? nodes.find((n) => n.id === selectedDestinationNodeId) : null;
    const destNodeHasEdges = destNode ? edges.some((e) => e.from_node_id === destNode.id || e.to_node_id === destNode.id) : false;

    // Only pass explicitDestNodeId if it is actually connected to the edge graph,
    // otherwise calculateShortestPathBetweenCoordinates will snap its coordinates to the nearest walkway
    const explicitDestNodeId = (destNodeHasEdges ? selectedDestinationNodeId : null) ||
      (storeNodeHasEdges ? storeNode?.id : null) ||
      null;

    if (nodes.length > 0 && edges.length > 0) {
      if (isOutsideVenue) {
        // Outside venue: compute indoor path from best entrance gate to the target store
        const entranceNodeHasEdges = closestEntrance ? edges.some((e) => e.from_node_id === closestEntrance.id || e.to_node_id === closestEntrance.id) : false;
        graphPath = calculateShortestPathBetweenCoordinates(
          entranceLat,
          entranceLng,
          targetLat,
          targetLng,
          nodes,
          edges,
          entranceNodeHasEdges ? closestEntrance?.id : null,
          explicitDestNodeId
        );

        if (graphPath.length <= 1) {
          graphPath = calculateShortestPathBetweenCoordinates(
            entranceLat,
            entranceLng,
            targetLat,
            targetLng,
            nodes,
            edges
          );
        }
      } else {
        // Strictly route inside venue along drawn walkway graph with dual edge-snapping
        // Only pass mockStartNodeId if user has no active GPS fix and is explicitly in mock mode
        const isMockActive = mockMode && (userLat === null || userLng === null);
        const mockNodeHasEdges = (isMockActive && mockStartNodeId)
          ? edges.some((e) => e.from_node_id === mockStartNodeId || e.to_node_id === mockStartNodeId)
          : false;

        const effectiveStartNodeId = (mockNodeHasEdges && mockStartNodeId !== explicitDestNodeId)
          ? mockStartNodeId
          : null;

        graphPath = calculateShortestPathBetweenCoordinates(
          startLat,
          startLng,
          targetLat,
          targetLng,
          nodes,
          edges,
          effectiveStartNodeId,
          explicitDestNodeId
        );

        // If constrained routing yielded empty or a single trivial node while target is separated, retry with pure coordinate snapping
        const straightDist = getDistance(startLat, startLng, targetLat, targetLng);
        if (graphPath.length <= 1 && straightDist > 15) {
          graphPath = calculateShortestPathBetweenCoordinates(
            startLat,
            startLng,
            targetLat,
            targetLng,
            nodes,
            edges
          );
        }
      }
    }

    setSnappedToNode(null);

    // 4. Outdoor segment via OSRM (only when user is outside venue)
    let outdoorNodes: NavigationNode[] = [];
    let osrmGuideSteps: string[] | null = null;
    let osrmTotalDistance: number | null = null;
    if (isOutsideVenue) {
      const destKey = `entrance-${bestEntrance.id}`;
      const cached = lastOSRMRouteRef.current;
      const canUseCache =
        cached &&
        cached.destId === destKey &&
        getDistance(startLat, startLng, cached.startLat, cached.startLng) < 35;

      if (canUseCache) {
        outdoorNodes = cached.nodes;
        osrmGuideSteps = cached.guideSteps;
        osrmTotalDistance = cached.totalDistance;
      } else {
        const osrmResult = await fetchOSRMRoute(
          startLat, startLng,
          entranceLat, entranceLng,
          startLabel,
          entranceLabel
        );

        if (osrmResult && osrmResult.nodes.length > 1) {
          outdoorNodes = osrmResult.nodes.slice(0, -1);
          osrmGuideSteps = osrmResult.guideSteps;
          osrmTotalDistance = osrmResult.totalDistanceMeters;
          lastOSRMRouteRef.current = {
            nodes: outdoorNodes,
            guideSteps: osrmGuideSteps,
            totalDistance: osrmTotalDistance,
            startLat,
            startLng,
            destId: destKey,
          };
        } else if (cached && cached.destId === destKey) {
          outdoorNodes = cached.nodes;
          osrmGuideSteps = cached.guideSteps;
          osrmTotalDistance = cached.totalDistance;
        } else {
          outdoorNodes = [{
            id: 'outdoor-start-virtual',
            label: startLabel,
            latitude: startLat,
            longitude: startLng,
            floor: null,
            type: 'poi',
            store_id: null,
            created_at: new Date().toISOString()
          }];
        }
      }
    }

    // 5. Assemble final route:
    const finalRoute: NavigationNode[] = [];
    let newOutdoorSegmentCount = 0;

    if (isOutsideVenue) {
      if (outdoorNodes.length > 0) {
        finalRoute.push(...outdoorNodes);
        newOutdoorSegmentCount = outdoorNodes.length;
      }

      const gateNode: NavigationNode = closestEntrance ? {
        ...closestEntrance,
        label: closestEntrance.label || entranceLabel,
      } : {
        id: bestEntrance.id,
        label: entranceLabel,
        latitude: entranceLat,
        longitude: entranceLng,
        floor: '1',
        type: 'entrance',
        store_id: null,
        created_at: new Date().toISOString()
      };

      const lastOutdoorNode = finalRoute[finalRoute.length - 1];
      const alreadyAtEntrance = lastOutdoorNode &&
        getDistance(lastOutdoorNode.latitude, lastOutdoorNode.longitude, gateNode.latitude, gateNode.longitude) < 5;
      if (!alreadyAtEntrance) {
        finalRoute.push(gateNode);
      }

      if (graphPath.length > 0) {
        const firstIndoor = graphPath[0];
        const skipFirst = firstIndoor.id === gateNode.id ||
          getDistance(firstIndoor.latitude, firstIndoor.longitude, gateNode.latitude, gateNode.longitude) < 2;
        finalRoute.push(...(skipFirst ? graphPath.slice(1) : graphPath));

        const lastIndoorNode = finalRoute[finalRoute.length - 1];
        if (getDistance(lastIndoorNode.latitude, lastIndoorNode.longitude, targetLat, targetLng) > 1.5) {
          finalRoute.push(destEndVirtualNode);
        }
      } else {
        finalRoute.push(destEndVirtualNode);
      }
    } else {
      if (graphPath.length > 0) {
        const distToFirstNode = getDistance(startLat, startLng, graphPath[0].latitude, graphPath[0].longitude);
        if (distToFirstNode > 1.5) {
          finalRoute.push(userStartVirtualNode);
        }
        finalRoute.push(...graphPath);

        const distFromLastNode = getDistance(
          graphPath[graphPath.length - 1].latitude,
          graphPath[graphPath.length - 1].longitude,
          targetLat, targetLng
        );
        if (distFromLastNode > 1.5) {
          finalRoute.push(destEndVirtualNode);
        }
      } else {
        // Last-resort fallback: attempt pure coordinate snapping without node constraints
        const retryPath = calculateShortestPathBetweenCoordinates(startLat, startLng, targetLat, targetLng, nodes, edges);
        if (retryPath && retryPath.length > 0) {
          finalRoute.push(userStartVirtualNode, ...retryPath, destEndVirtualNode);
        } else {
          finalRoute.push(userStartVirtualNode, destEndVirtualNode);
        }
      }
    }

    // Adaptive Early-Turn / Corner-Cutting Calibration:
    // If the visitor already turned early or cut the corner onto a forward leg,
    // advance the route automatically to avoid backtracking.
    let adaptiveRoute = finalRoute;
    if (userLat !== null && userLng !== null && finalRoute.length > 2) {
      const earlyTurnResult = advanceRouteOnEarlyTurn(userLat, userLng, finalRoute, 8);
      if (earlyTurnResult.didAdvance) {
        adaptiveRoute = earlyTurnResult.updatedRoute;
        if (earlyTurnResult.skippedNodes.length > 0) {
          const skipped = earlyTurnResult.skippedNodes[0];
          logAnalyticsEvent(
            'path_deviation',
            skipped.id,
            skipped.label,
            { lat: userLat, lng: userLng }
          );
        }
      }
    }

    setOutdoorSegmentCount(newOutdoorSegmentCount);
    setCalculatedRoute(adaptiveRoute);
    setNavigationActive(true);

    if (adaptiveRoute.length > 0) {
      let distanceMeters = 0;
      const steps: string[] = [];

      if (isOutsideVenue) {
        if (osrmGuideSteps && osrmGuideSteps.length > 0) {
          steps.push(...osrmGuideSteps);
        }
        steps.push(`🏫 Enter through ${entranceLabel}`);

        const indoorNodesSlice = adaptiveRoute.slice(newOutdoorSegmentCount);
        for (let i = 0; i < indoorNodesSlice.length - 1; i++) {
          const from = indoorNodesSlice[i];
          const to = indoorNodesSlice[i + 1];
          const segDist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
          if (segDist > 1) {
            const heading = getHeading(from.latitude, from.longitude, to.latitude, to.longitude);
            steps.push(`Head ${heading} towards ${to.label} (${Math.round(segDist)}m)`);
          }
        }
        steps.push(`Arrive at ${targetLabel}`);

        distanceMeters = osrmTotalDistance ?? 0;
        for (let i = newOutdoorSegmentCount; i < adaptiveRoute.length - 1; i++) {
          const from = adaptiveRoute[i];
          const to = adaptiveRoute[i + 1];
          distanceMeters += getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
        }
      } else {
        for (let i = 0; i < adaptiveRoute.length - 1; i++) {
          const from = adaptiveRoute[i];
          const to = adaptiveRoute[i + 1];
          const segDist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
          distanceMeters += segDist;
          if (segDist > 1) {
            const heading = getHeading(from.latitude, from.longitude, to.latitude, to.longitude);
            if (to.type === 'store' || to.id.startsWith('dest-store-')) {
              steps.push(`Turn ${heading} into ${targetLabel} (${Math.round(segDist)}m)`);
            } else {
              steps.push(`Walk ${heading} along pathway to ${to.label} (${Math.round(segDist)}m)`);
            }
          }
        }
        steps.push(`Arrive at ${targetLabel}`);
      }

      setTotalDistance(Math.round(distanceMeters));
      setGuideSteps(steps);
    }
  } // end calculateRoutePath


  const handleRecenterLocation = () => {
    // Explicitly request iOS orientation permission on user gesture (click)
    const DeviceEvent = window.DeviceOrientationEvent as any;
    if (DeviceEvent && typeof DeviceEvent.requestPermission === 'function') {
      DeviceEvent.requestPermission()
        .then((state: string) => {
          if (state === 'granted') {
            console.log('Compass permission granted via Recenter click gesture');
          }
        })
        .catch(console.error);
    }

    if (calibratedLocationRef.current) {
      setMapCenterLat(calibratedLocationRef.current.lat);
      setMapCenterLng(calibratedLocationRef.current.lng);
      setRecenterCount((c) => c + 1);
      return;
    }

    if (!mockMode && userLat !== null && userLng !== null) {
      setMapCenterLat(userLat);
      setMapCenterLng(userLng);
    } else if (mockMode && mockStartNodeId) {
      const node = nodes.find((n) => n.id === mockStartNodeId);
      if (node) {
        setMapCenterLat(node.latitude);
        setMapCenterLng(node.longitude);
      }
    }
    // Re-center and resume heading-up mode tracking
    setRecenterCount((c) => c + 1);
  };

  const handleToggleHeadingUp = () => {
    // If turning ON, also trigger compass permissions on iOS if needed
    if (!isHeadingUp) {
      const DeviceEvent = window.DeviceOrientationEvent as any;
      if (DeviceEvent && typeof DeviceEvent.requestPermission === 'function') {
        DeviceEvent.requestPermission().catch(console.error);
      }
      setIsHeadingUp(true);
      if (userLat !== null && userLng !== null) {
        setMapCenterLat(userLat);
        setMapCenterLng(userLng);
      }
      setRecenterCount((c) => c + 1);
    } else {
      setIsHeadingUp(false);
    }
  };

  const handleToggleBoundaryVisibility = async () => {
    const nextState = !exhibitionSettings.school_boundary_enabled;
    setExhibitionSettings((prev) => ({
      ...prev,
      school_boundary_enabled: nextState,
    }));

    try {
      const { data: settingsRes } = await supabase
        .from('announcements')
        .select('*')
        .eq('type', 'settings')
        .limit(1);

      let parsed: any = {};
      let settingsId: string | null = null;
      if (settingsRes && settingsRes.length > 0) {
        settingsId = settingsRes[0].id;
        try {
          parsed = JSON.parse(settingsRes[0].message);
        } catch (e) {
          console.error(e);
        }
      }

      parsed.school_boundary_enabled = nextState;
      parsed.show_school_boundary = nextState;

      const payload = {
        title: 'System Exhibition Settings',
        message: JSON.stringify(parsed),
        type: 'settings',
        is_active: true,
      };

      if (settingsId) {
        await supabase
          .from('announcements')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', settingsId);
      } else {
        await supabase.from('announcements').insert(payload);
      }
    } catch (err) {
      console.error('Error toggling boundary visibility:', err);
    }
  };

  // Enhanced search across stall name, category, and description/location
  const filteredSearchStores = storeSearchQuery.trim()
    ? stores.filter((st) => {
      const q = storeSearchQuery.toLowerCase();
      return (
        st.name.toLowerCase().includes(q) ||
        (st.description || '').toLowerCase().includes(q) ||
        (st.categories?.name || '').toLowerCase().includes(q)
      );
    })
    : [];

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  return (
    <>
      <GPSPermissionBanner />
      <div className="map-page-wrapper">

        {/* Top Floating Control Bar */}
        <header className="glass map-topbar" style={{
          position: 'absolute',
          top: '0',
          left: '0',
          right: '0',
          zIndex: 1000,
          padding: '0.6rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          borderRadius: '0',
          borderBottom: '1px solid var(--color-border)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}>
          {/* Left: Back + Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
            <Link to="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface2)', width: 32, height: 32, borderRadius: '6px', color: 'var(--color-text)', flexShrink: 0 }}>
              <ArrowLeft size={16} />
            </Link>
            <div className="map-brand-text" style={{ minWidth: 0, overflow: 'hidden' }}>
              <h2 style={{ fontSize: '0.88rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span className="map-title-full">Interactive Floor Map</span>
                <span className="map-title-short">Floor Map</span>
              </h2>
              <span className="map-brand-subtitle" style={{ fontSize: '0.65rem', color: 'var(--color-muted)' }}>
                Exhibition Navigation System
              </span>
            </div>
          </div>

          {/* Right: desktop nav links */}
          <div className="map-topbar-links" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
            {/* Announcements Bell */}
            <button
              onClick={handleOpenAnnouncements}
              className="btn btn-ghost btn-sm btn-icon"
              style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '30px', width: '30px', padding: 0 }}
              title="View Announcements"
            >
              <Bell size={14} />
              {unreadNotifications > 0 && (
                <span style={{
                  position: 'absolute', top: '1px', right: '1px',
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: '#ef4444', boxShadow: '0 0 4px #ef4444',
                }} />
              )}
            </button>
            {profile?.role === 'admin' && (
              <>
                <button
                  onClick={handleToggleBoundaryVisibility}
                  className="btn btn-ghost btn-sm"
                  style={{
                    padding: '0.35rem 0.65rem',
                    border: `1px solid ${exhibitionSettings.school_boundary_enabled ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255, 255, 255, 0.15)'}`,
                    color: exhibitionSettings.school_boundary_enabled ? '#c084fc' : 'var(--color-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                  title="Admin: Click to toggle boundary visibility on map"
                >
                  🏫 Boundary: {exhibitionSettings.school_boundary_enabled ? 'ON' : 'OFF'}
                </button>
                <a href="/admin/" className="btn btn-ghost btn-sm" style={{ padding: '0.35rem 0.65rem', border: '1px dashed var(--color-warning)', color: 'var(--color-warning)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  Admin
                </a>
              </>
            )}
            <LiveAudioHeaderButton />
          </div>

          {/* Mobile-only: boundary toggle + live audio + bell icon inline */}
          <div className="map-topbar-mobile-icons" style={{ display: 'none', gap: '0.3rem', alignItems: 'center', flexShrink: 0 }}>
            {profile?.role === 'admin' && (
              <button
                onClick={handleToggleBoundaryVisibility}
                className="btn btn-ghost btn-sm"
                style={{
                  padding: '0.25rem 0.45rem',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: `1px solid ${exhibitionSettings.school_boundary_enabled ? '#a855f7' : 'rgba(255,255,255,0.2)'}`,
                  color: exhibitionSettings.school_boundary_enabled ? '#c084fc' : '#94a3b8',
                  flexShrink: 0,
                }}
                title="Toggle boundary on map"
              >
                🏫 {exhibitionSettings.school_boundary_enabled ? 'ON' : 'OFF'}
              </button>
            )}
            <LiveAudioMobileButton />
            <button
              onClick={handleOpenAnnouncements}
              className="btn btn-ghost btn-sm btn-icon"
              style={{ position: 'relative', width: 32, height: 32, padding: 0, borderRadius: '6px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Announcements"
            >
              <Bell size={16} />
              {unreadNotifications > 0 && (
                <span style={{ position: 'absolute', top: '2px', right: '2px', width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }} />
              )}
            </button>
          </div>
        </header>

        {/* Mobile bottom quick-nav bar */}
        <nav className="map-mobile-bottomnav" style={{
          display: 'none',
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1001,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          background: 'rgba(11,15,26,0.92)',
          borderTop: '1px solid var(--color-border)',
          padding: '0.4rem 0.5rem',
          paddingBottom: 'calc(0.4rem + var(--safe-bottom, 0px))',
          justifyContent: 'space-around',
          alignItems: 'center',
          gap: '0.25rem',
        }}>
          {/* Mobile Footer: Change Stall button */}
          <button
            onClick={handleOpenTourPlanner}
            className="btn btn-ghost btn-sm"
            style={{
              flex: 1,
              flexDirection: 'column',
              gap: '0.2rem',
              padding: '0.35rem 0.5rem',
              fontSize: '0.68rem',
              minHeight: 'unset',
              color: 'var(--color-accent)',
              borderRadius: '8px',
            }}
            title="Change selected tour stalls"
          >
            <Compass size={18} />
            <span>Change Stall</span>
          </button>

          {/* Mobile Footer: Stalls button (lists visited & revisit options) */}
          <button
            onClick={() => setShowTourStallsModal(true)}
            className="btn btn-ghost btn-sm"
            style={{
              flex: 1,
              position: 'relative',
              flexDirection: 'column',
              gap: '0.2rem',
              padding: '0.35rem 0.5rem',
              fontSize: '0.68rem',
              minHeight: 'unset',
              color: '#fff',
              borderRadius: '8px',
            }}
            title="View tour stalls and visited status"
          >
            <Store size={18} />
            <span>Tour Stalls</span>
            {visitedStallIds.length > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '1px',
                  right: '18px',
                  background: '#22c55e',
                  color: '#fff',
                  fontSize: '0.58rem',
                  fontWeight: 800,
                  borderRadius: '10px',
                  padding: '0.05rem 0.35rem',
                }}
              >
                {visitedStallIds.length}
              </span>
            )}
          </button>

          {profile?.role === 'admin' && (
            <a href="/admin/" className="btn btn-ghost btn-sm" style={{ flex: 1, flexDirection: 'column', gap: '0.2rem', padding: '0.35rem 0.5rem', fontSize: '0.68rem', color: 'var(--color-warning)', minHeight: 'unset', display: 'inline-flex', alignItems: 'center', borderRadius: '8px' }}>
              <Navigation size={18} />
              <span>Admin</span>
            </a>
          )}
        </nav>

        {/* Full Screen Map Canvas Container */}
        <div style={{ flex: 1, width: '100%', height: '100%', position: 'relative' }}>
          {/* 3D Map View hidden from UI, preserved in codebase */}
          <div style={{ display: 'none' }}>
            <MapView3D
              latitude={mapCenterLat}
              longitude={mapCenterLng}
              stores={stores}
              userLat={userLat}
              userLng={userLng}
              route={calculatedRoute}
              showGraphMesh={showMesh}
              nodes={nodes}
              edges={edges}
              showSchoolBoundary={exhibitionSettings.school_boundary_enabled}
            />
          </div>
          <MapView
            latitude={mapCenterLat}
            longitude={mapCenterLng}
            stores={stores}
            userLat={userLat}
            userLng={userLng}
            userHeading={userHeading}
            route={calculatedRoute}
            theme="satellite"
            showGraphMesh={showMesh}
            nodes={nodes}
            edges={edges}
            onMapClick={handleMapClick}
            outdoorSegmentCount={outdoorSegmentCount}
            tourStops={guidedTourActive ? tourStops : []}
            visitedStallIds={visitedStallIds}
            showSchoolBoundary={exhibitionSettings.school_boundary_enabled}
            boundaryCenter={{
              lat: exhibitionSettings.premises_center_latitude,
              lng: exhibitionSettings.premises_center_longitude,
            }}
            boundaryRadius={exhibitionSettings.premises_radius_meters}
            headingUpMode={isHeadingUp}
            recenterTrigger={recenterCount}
            onSelectStore={(id) => {
              // Check if the ID is a navigation node (block) first
              const matchedNode = nodes.find(n => n.id === id);
              if (matchedNode) {
                setSelectedDestinationNodeId(id);
                setSelectedDestinationStoreId('');
                setStoreSearchQuery(matchedNode.label || '');
              } else {
                setSelectedDestinationStoreId(id);
                setSelectedDestinationNodeId('');
                const st = stores.find(s => s.id === id);
                if (st) setStoreSearchQuery(st.name);
              }
            }}
          />

          {/* Right Floating Controls Stack (Recenter, Auto-Rotation Compass, Quick Pitstop) */}
          <div
            className="map-floating-actions-stack"
            style={{
              position: 'absolute',
              right: '14px',
              bottom: (navigationActive || guidedTourActive)
                ? (navSheetState === 'hidden'
                    ? 'calc(74px + var(--safe-bottom, 0px))'
                    : navSheetState === 'expanded'
                      ? 'calc(min(65vh, 480px) + 20px)'
                      : 'calc(255px + var(--safe-bottom, 0px))')
                : 'calc(166px + var(--safe-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column-reverse',
              alignItems: 'flex-end',
              gap: '10px',
              zIndex: 1005,
              pointerEvents: 'none',
              transition: 'bottom 0.32s cubic-bezier(0.32, 0.72, 0, 1), right 0.3s ease',
            }}
          >
            {/* 1. Floating Recenter Location Button (Bottom) */}
            <button
              onClick={handleRecenterLocation}
              className="btn btn-primary map-recenter-btn"
              style={{
                pointerEvents: 'auto',
                borderRadius: '50%',
                width: '46px',
                height: '46px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(99,102,241,0.45)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              title="Recenter Map on Current Location"
              aria-label="Recenter Map"
            >
              <Navigation size={18} style={{ transform: 'rotate(45deg)' }} />
            </button>

            {/* 2. Floating Auto-Rotation / Compass Heading Button (Middle) */}
            <button
              id="heading-up-toggle-btn"
              onClick={handleToggleHeadingUp}
              className={`btn map-heading-toggle-btn ${isHeadingUp ? 'active-heading-up' : ''}`}
              style={{
                pointerEvents: 'auto',
                borderRadius: '50%',
                width: '46px',
                height: '46px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isHeadingUp
                  ? 'linear-gradient(135deg, #06b6d4, #3b82f6)'
                  : 'rgba(15, 23, 42, 0.9)',
                border: isHeadingUp
                  ? '2px solid #22d3ee'
                  : '1px solid rgba(255, 255, 255, 0.25)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                color: isHeadingUp ? '#fff' : 'var(--color-text)',
                boxShadow: isHeadingUp
                  ? '0 0 16px rgba(34, 211, 238, 0.6), 0 4px 12px rgba(0,0,0,0.4)'
                  : '0 4px 12px rgba(0,0,0,0.35)',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background 0.25s, transform 0.2s',
              }}
              title={
                isHeadingUp
                  ? 'Auto-Rotation ON: Map rotates to follow your heading (Click for North-Up)'
                  : 'Auto-Rotation OFF: North is Up (Click to enable Auto-Rotation)'
              }
              aria-label="Toggle Auto-Rotation Heading-Up Mode"
            >
              <div style={{ position: 'relative', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Compass
                  size={22}
                  style={{
                    transform: isHeadingUp ? `rotate(${-(userHeading ?? 0)}deg)` : 'none',
                    transition: 'transform 0.3s ease',
                    color: isHeadingUp ? '#fff' : 'var(--color-accent)',
                  }}
                />
                {isHeadingUp && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-6px',
                      right: '-6px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#22d3ee',
                      boxShadow: '0 0 6px #22d3ee',
                    }}
                  />
                )}
              </div>
            </button>

            {/* 3. Floating Quick Pitstop Button (Top of Stack) */}
            {(navigationActive || guidedTourActive || activePitstopDetour) && (
              <button
                id="quick-pitstop-fab-btn"
                className={`quick-pitstop-fab ${activePitstopDetour ? 'active-detour' : ''}`}
                onClick={() => {
                  if (activePitstopDetour) {
                    handleResumeOriginalRoute();
                  } else {
                    setShowPitstopModal(true);
                  }
                }}
                style={{
                  pointerEvents: 'auto',
                  flexShrink: 0,
                }}
                title={
                  activePitstopDetour
                    ? 'Finished your pitstop? Click to resume your original route'
                    : 'Need a quick pitstop? (Washroom, Canteen, Water, First Aid)'
                }
              >
                <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>
                  {activePitstopDetour ? '✓' : '🚻'}
                </span>
                <span>
                  {activePitstopDetour ? 'Resume' : 'Pitstop'}
                </span>
              </button>
            )}
          </div>

          {/* Left Floating Controls Stack (Search & Alerts) */}
          <div
            className="map-left-controls-stack"
            style={{
              position: 'absolute',
              top: '4.85rem',
              left: '1rem',
              width: '320px',
              zIndex: 999,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
              pointerEvents: 'none',
            }}
          >

            {/* Floating Search Panel */}
            <div
              className="map-search-panel"
              style={{
                width: '100%',
                maxHeight: '350px',
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: 'auto',
              }}
            >
              <div className="glass" style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '12px' }}>
                <Search size={16} color="var(--color-muted)" />
                <input
                  type="text"
                  placeholder="Search target store/booth..."
                  className="search-input"
                  style={{ background: 'transparent', border: 'none', width: '100%', outline: 'none', padding: '0.25rem 0' }}
                  value={storeSearchQuery}
                  onChange={(e) => setStoreSearchQuery(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                />
                {storeSearchQuery && (
                  <button
                    onClick={() => {
                      setStoreSearchQuery('');
                      setSelectedDestinationStoreId('');
                    }}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    <X size={14} color="var(--color-muted)" />
                  </button>
                )}
              </div>

              {/* Live dropdown results */}
              {isSearchFocused && filteredSearchStores.length > 0 && (
                <div className="glass" style={{
                  marginTop: '0.35rem',
                  background: 'var(--color-surface)',
                  borderRadius: '8px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  padding: '0.25rem 0',
                  display: 'flex',
                  flexDirection: 'column',
                }}>
                  {filteredSearchStores.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => {
                        setSelectedDestinationStoreId(st.id);
                        setStoreSearchQuery(st.name);
                        setIsSearchFocused(false);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        textAlign: 'left',
                        padding: '0.65rem 1rem',
                        color: 'var(--color-text)',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span>{st.name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>Floor {st.floor || '1'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Boundary Check Bypassed Badge */}
            {bypassBoundaryCheck && exhibitionSettings.school_boundary_enabled !== false && (
              <div className="glass" style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '20px',
                background: 'rgba(234, 179, 8, 0.15)',
                border: '1px solid rgba(234, 179, 8, 0.4)',
                color: '#fde047',
                fontSize: '0.75rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                backdropFilter: 'blur(8px)',
                pointerEvents: 'auto',
                width: 'fit-content',
                boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
              }}>
                <span>⚠️ Premises Boundary Bypassed</span>
                <button
                  onClick={() => setBypassBoundaryCheck(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    lineHeight: 1
                  }}
                  title="Restore boundary check"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Calibrated Indoor Location Banner (QR Scan Checkpoint) */}
          {calibratedLocation && (
            <div
              className="glass"
              style={{
                position: 'absolute',
                top: '4.75rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                padding: '0.55rem 1.1rem',
                borderRadius: '24px',
                background: 'rgba(16, 185, 129, 0.22)',
                border: '1px solid rgba(52, 211, 153, 0.6)',
                color: '#ecfdf5',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                maxWidth: '92vw',
                animation: 'fadeIn 0.25s ease-out',
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'rgba(16, 185, 129, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <QrCode size={15} color="#34d399" />
              </div>
              <div style={{ minWidth: 0, lineHeight: 1.3 }}>
                <div style={{ fontWeight: 700, color: '#34d399', fontSize: '0.82rem' }}>
                  Position Calibrated via QR Code
                </div>
                <div style={{ fontSize: '0.73rem', color: '#a7f3d0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Location: <strong>{calibratedLocation.label}</strong> (Floor {calibratedLocation.floor})
                </div>
              </div>
              <button
                onClick={() => setCalibratedLocation(null)}
                className="btn btn-ghost btn-sm"
                style={{
                  padding: '0.2rem 0.55rem',
                  fontSize: '0.7rem',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.12)',
                  color: '#fff',
                  marginLeft: '0.25rem',
                  flexShrink: 0,
                  border: 'none',
                }}
                title="Dismiss calibration notification"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Low GPS Signal Strength Notification Banner (Non-intrusive top-of-display badge) */}
          {!mockMode && !calibratedLocation && gpsAccuracy !== null && gpsAccuracy > 18 && !dismissedLowGps && (
            <div
              className="glass animate-fade-in"
              style={{
                position: 'absolute',
                top: '4.75rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                padding: '0.4rem 0.85rem',
                borderRadius: '24px',
                background: 'rgba(245, 158, 11, 0.2)',
                border: '1px solid rgba(245, 158, 11, 0.55)',
                color: '#fef3c7',
                fontSize: '0.78rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                maxWidth: '92vw',
                pointerEvents: 'auto',
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'rgba(245, 158, 11, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={13} color="#fbbf24" />
              </div>
              <div style={{ minWidth: 0, lineHeight: 1 }}>
                <span style={{ fontWeight: 700, color: '#fbbf24', fontSize: '0.78rem' }}>
                  Low Accuracy
                </span>
              </div>
              <button
                onClick={() => setDismissedLowGps(true)}
                className="btn btn-ghost btn-sm"
                style={{
                  padding: '0.15rem 0.45rem',
                  fontSize: '0.68rem',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.12)',
                  color: '#fff',
                  marginLeft: '0.2rem',
                  flexShrink: 0,
                  border: 'none',
                  cursor: 'pointer',
                }}
                title="Dismiss warning"
              >
                ✕
              </button>
            </div>
          )}

          {/* Active Mock Location Top Banner (Admin Only) */}
          {mockMode && profile?.role === 'admin' && (
            <div className="glass map-mock-active-banner" style={{
              position: 'absolute',
              top: '1rem',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 999,
              padding: '0.45rem 1.1rem',
              borderRadius: '20px',
              background: 'rgba(245, 158, 11, 0.18)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#fbbf24',
              fontSize: '0.8rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              backdropFilter: 'blur(10px)',
              whiteSpace: 'nowrap',
            }}>
              <span className="desktop-mock-text">📍 Mock Location Mode Active — Tap map to set location</span>
              <span className="mobile-mock-text" style={{ display: 'none' }}>📍 Mock GPS Active (Tap map)</span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem', color: '#fff', background: 'rgba(255,255,255,0.12)', borderRadius: '12px', flexShrink: 0 }}
                onClick={() => setMockMode(false)}
              >
                Use Real GPS
              </button>
            </div>
          )}

          {/* Right Floating Controls Stack (Admin Testing Tools & Mock GPS only) */}
          {profile?.role === 'admin' && (
            <div
              className="map-right-controls-stack"
              style={{
                position: 'absolute',
                top: '4.85rem',
                right: '1rem',
                width: '220px',
                zIndex: 999,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
                maxHeight: 'calc(100vh - 6.5rem)',
                overflowY: 'auto',
                pointerEvents: 'none',
                scrollbarWidth: 'none',
              }}
            >
              {/* Map Controls (Testing Tools & Mesh) */}
              <div className="glass map-controls-panel" style={{
                width: '100%',
                pointerEvents: 'auto',
                padding: '0.75rem',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="checkbox"
                    id="mesh-toggle"
                    checked={showMesh}
                    onChange={(e) => setShowMesh(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="mesh-toggle" style={{ fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                    Show Path Nodes
                  </label>
                </div>

              {/* Testing / Mock Location Mode Toggle Button */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Testing Tools
                </label>
                <button
                  className="btn btn-sm"
                  style={{
                    width: '100%',
                    fontSize: '0.78rem',
                    padding: '0.35rem 0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    background: mockMode ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${mockMode ? 'rgba(245, 158, 11, 0.5)' : 'var(--color-border)'}`,
                    color: mockMode ? '#fbbf24' : 'var(--color-text)',
                    fontWeight: 700
                  }}
                  onClick={() => {
                    setMockMode(prev => {
                      const next = !prev;
                      if (next && (userLat === null || userLng === null)) {
                        const entranceNode =
                          nodes.find(
                            (n) =>
                              n.type === 'entrance' ||
                              n.label.toLowerCase().includes('node 1') ||
                              n.label.toLowerCase().includes('entrance')
                          ) || nodes[0];
                        if (entranceNode) {
                          setUserLat(entranceNode.latitude);
                          setUserLng(entranceNode.longitude);
                        } else {
                          setUserLat(exhibitionSettings.entrance_latitude || 6.53586);
                          setUserLng(exhibitionSettings.entrance_longitude || 80.40035);
                        }
                        setIsFarAway(false);
                      }
                      return next;
                    });
                  }}
                >
                  <Navigation size={13} />
                  <span>{mockMode ? '📍 Mock Location ON' : '🎯 Enable Mock GPS'}</span>
                </button>
              </div>
            </div>

            {/* Interactive Mock Location Control Panel */}
            {mockMode && (
              <div className="glass map-mock-panel" style={{
                width: '100%',
                pointerEvents: 'auto',
                padding: '0.85rem',
                borderRadius: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                background: 'rgba(15, 23, 42, 0.92)',
                backdropFilter: 'blur(14px)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 800, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    📍 SET MOCK LOCATION
                  </span>
                  <button
                    onClick={() => setMockMode(false)}
                    style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
                    title="Exit Mock Mode"
                  >
                    ✕ Exit
                  </button>
                </div>

                {/* Quick Location Presets */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.62rem', color: 'var(--color-muted)', fontWeight: 700, marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                    Quick Presets
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                    {getAllEntrancePoints(nodes, exhibitionSettings).map((ent) => (
                      <button
                        key={ent.id}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem', justifyContent: 'flex-start', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        onClick={() => handleSelectMockLocation(ent.id)}
                        title={ent.label}
                      >
                        🚪 {ent.label}
                      </button>
                    ))}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem', justifyContent: 'flex-start' }}
                      onClick={() => handleSelectMockLocation('center')}
                    >
                      🏛️ Venue Center
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem', justifyContent: 'flex-start', color: '#f87171' }}
                      onClick={() => handleSelectMockLocation('outside')}
                    >
                      ⚠️ Far Outside
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem', justifyContent: 'flex-start', color: '#22c55e' }}
                      onClick={() => {
                        if (nodes.length > 0) handleSelectMockLocation(nodes[0].id);
                      }}
                    >
                      📍 Node #1
                    </button>
                  </div>
                </div>

                {/* Node Dropdown Select */}
                {nodes.length > 0 && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.62rem', color: 'var(--color-muted)', fontWeight: 700, marginBottom: '0.25rem', textTransform: 'uppercase' }}>
                      Select Navigation Node
                    </label>
                    <select
                      className="form-select"
                      style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem', width: '100%' }}
                      value={mockStartNodeId}
                      onChange={(e) => handleSelectMockLocation(e.target.value)}
                    >
                      <option value="">-- Choose Node --</option>
                      {nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.label} ({node.type})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ fontSize: '0.68rem', color: 'var(--color-accent)', background: 'rgba(34, 211, 238, 0.08)', padding: '0.35rem 0.5rem', borderRadius: '6px', lineHeight: 1.4 }}>
                  💡 <strong>Tip:</strong> Tap anywhere on the map to set your user marker to that exact location!
                </div>
              </div>
            )}
          </div>
          )}

          {/* Bottom Navigation Panel — Google Maps-style draggable bottom sheet */}
          {(navigationActive || guidedTourActive) && (
            <div
              ref={sheetRef}
              className={`glass map-nav-panel map-nav-${navSheetState}`}
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
              onMouseDown={handleSheetTouchStart}
              onMouseMove={handleSheetTouchMove}
              onMouseUp={handleSheetTouchEnd}
            >
              {/* Drag handle bar at top */}
              <div
                className="nav-sheet-handle"
                onClick={() => {
                  setNavSheetState(curr => (curr === 'hidden' ? 'normal' : curr === 'normal' ? 'expanded' : 'normal'));
                }}
                title={navSheetState === 'hidden' ? 'Tap or drag up to expand' : 'Swipe down to hide'}
              >
                <div className="nav-sheet-handle-bar" />
              </div>

              {/* State: HIDDEN (Compact Peeking View) */}
              {navSheetState === 'hidden' ? (
                <div
                  onClick={() => setNavSheetState('normal')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    cursor: 'pointer',
                    padding: '0.1rem 0.25rem 0.25rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0, flex: 1 }}>
                    <div style={{
                      width: 28, height: 28,
                      borderRadius: '50%',
                      background: guidedTourActive ? 'linear-gradient(135deg, #a855f7, #6366f1)' : 'rgba(99,102,241,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', flexShrink: 0,
                    }}>
                      {guidedTourActive ? <Compass size={15} /> : <Route size={15} />}
                    </div>
                    <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.86rem', color: '#fff' }}>
                        {guidedTourActive && tourStops.length > 0
                          ? (tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop'
                              ? `🚪 Exit Gate: ${tourStops[currentTourStopIndex]?.name}`
                              : tourStops[currentTourStopIndex]?.name || 'Next Stall')
                          : selectedDestinationStoreId
                            ? (stores.find(s => s.id === selectedDestinationStoreId)?.name || 'Exhibitor')
                            : (nodes.find(n => n.id === selectedDestinationNodeId)?.label || 'Destination')}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', marginLeft: '0.5rem', fontWeight: 600 }}>
                        {totalDistance} m
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                    {guidedTourActive && (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkCurrentStopVisited();
                          }}
                          style={{
                            fontSize: '0.72rem',
                            padding: '0.22rem 0.6rem',
                            background: tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop'
                              ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                              : 'linear-gradient(135deg, #22c55e, #16a34a)',
                            border: 'none',
                            fontWeight: 700,
                            borderRadius: '6px',
                          }}
                        >
                          {tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop' ? 'Exit 🎉' : (currentTourStopIndex + 1 < tourStops.length ? 'Next ✓' : 'Finish 🎉')}
                        </button>
                        {currentTourStopIndex + 1 < tourStops.length && tourStops[currentTourStopIndex]?.id !== 'venue-exit-gate-stop' && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSkipCurrentStop();
                            }}
                            style={{
                              fontSize: '0.7rem',
                              padding: '0.2rem 0.5rem',
                              background: 'rgba(255, 255, 255, 0.08)',
                              border: '1px solid rgba(255, 255, 255, 0.15)',
                              color: 'var(--color-text)',
                              fontWeight: 600,
                              borderRadius: '6px',
                            }}
                            title="Skip this stall"
                          >
                            Skip ⏭️
                          </button>
                        )}
                      </>
                    )}
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                      <ChevronUp size={16} /> Drag up
                    </span>
                  </div>
                </div>
              ) : (
                /* State: NORMAL or EXPANDED */
                <>
                  {guidedTourActive && tourStops.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                      {/* Top Info Header Row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', minWidth: 0, flex: 1 }}>
                          <div style={{
                            width: 38, height: 38,
                            background: tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop'
                              ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                              : 'linear-gradient(135deg, #a855f7, #6366f1)',
                            borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', flexShrink: 0,
                            boxShadow: tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop'
                              ? '0 4px 12px rgba(245, 158, 11, 0.4)'
                              : '0 4px 12px rgba(168, 85, 247, 0.4)'
                          }}>
                            {tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop' ? (
                              <DoorOpen size={20} />
                            ) : (
                              <Compass size={20} />
                            )}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{
                              fontSize: '0.65rem',
                              fontWeight: 800,
                              color: tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop' ? '#fbbf24' : '#22d3ee',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em'
                            }}>
                              {tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop'
                                ? '🚪 FINAL DESTINATION · EXIT GATE'
                                : `🎪 GUIDED TOUR · STOP ${currentTourStopIndex + 1} OF ${tourStops.filter(s => s.id !== 'venue-exit-gate-stop').length} (STALLS)`}
                            </div>
                            <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: '0.05rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tourStops[currentTourStopIndex]?.name || 'Next Stall'}
                            </h3>
                            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: 0 }}>
                              <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{totalDistance} m</span>
                              {' · '}Est: {totalDistance < 80 ? '< 1 min' : `${Math.ceil(totalDistance / 80)} min`} walking
                            </p>
                          </div>
                        </div>

                        {/* Minimize / Expand Toggle Icon Button */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setNavSheetState('hidden')}
                            style={{
                              padding: '0.3rem 0.4rem',
                              borderRadius: '8px',
                              color: 'var(--color-muted)',
                              border: '1px solid var(--color-border)',
                              background: 'rgba(255,255,255,0.04)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.2rem',
                              fontSize: '0.72rem',
                            }}
                            title="Swipe down or tap to minimize"
                            aria-label="Minimize detail tab"
                          >
                            <ChevronDown size={15} />
                            <span>Hide</span>
                          </button>
                        </div>
                      </div>

                      {/* Clean Dedicated Action Buttons Row: Next Stall, Skip Store, Prev, Stalls, End */}
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', width: '100%', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                        {/* Next Stall Button */}
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={handleMarkCurrentStopVisited}
                          style={{
                            flex: '1 1 120px',
                            fontSize: '0.82rem',
                            padding: '0.45rem 0.8rem',
                            background: tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop'
                              ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                              : 'linear-gradient(135deg, #22c55e, #16a34a)',
                            border: 'none',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem',
                            borderRadius: '10px',
                            boxShadow: tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop'
                              ? '0 2px 8px rgba(245, 158, 11, 0.35)'
                              : '0 2px 8px rgba(34, 197, 94, 0.35)',
                          }}
                          title={tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop' ? 'Complete tour and exit exhibition' : 'Mark stall as visited and route to next stall'}
                        >
                          {tourStops[currentTourStopIndex]?.id === 'venue-exit-gate-stop' ? (
                            <>
                              <DoorOpen size={15} />
                              <span>Exit Exhibition 🎉</span>
                            </>
                          ) : (
                            <>
                              <Check size={15} />
                              <span>{currentTourStopIndex + 1 < tourStops.length ? (tourStops[currentTourStopIndex + 1]?.id === 'venue-exit-gate-stop' ? 'Done → Proceed to Exit 🚪' : 'Next Stall ✓') : 'Finish Tour 🎉'}</span>
                            </>
                          )}
                        </button>

                        {/* Skip Store Button */}
                        {currentTourStopIndex + 1 < tourStops.length && tourStops[currentTourStopIndex]?.id !== 'venue-exit-gate-stop' && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={handleSkipCurrentStop}
                            style={{
                              flex: '1 1 100px',
                              fontSize: '0.8rem',
                              padding: '0.45rem 0.75rem',
                              background: 'rgba(255, 255, 255, 0.06)',
                              border: '1px solid rgba(255, 255, 255, 0.15)',
                              color: 'var(--color-text)',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.35rem',
                              borderRadius: '10px',
                            }}
                            title="Skip this store and route directly to the next stall"
                          >
                            <FastForward size={14} />
                            <span>Skip Store</span>
                          </button>
                        )}

                        {/* Previous Stall Button */}
                        {currentTourStopIndex > 0 && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={handlePreviousStop}
                            style={{
                              padding: '0.45rem 0.65rem',
                              fontSize: '0.78rem',
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid var(--color-border)',
                              borderRadius: '10px',
                              color: 'var(--color-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.2rem',
                            }}
                            title="Go back to previous stall"
                          >
                            <ChevronLeft size={14} />
                            <span>Prev</span>
                          </button>
                        )}

                        {/* Change / Add Stalls Button */}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={handleOpenTourPlanner}
                          style={{
                            padding: '0.45rem 0.65rem',
                            fontSize: '0.78rem',
                            background: 'rgba(99, 102, 241, 0.1)',
                            border: '1px solid rgba(99, 102, 241, 0.3)',
                            borderRadius: '10px',
                            color: 'var(--color-primary-h)',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                          title="Open stall planner to change or select stalls"
                        >
                          <Compass size={13} />
                          <span>Change Stall</span>
                        </button>

                        {/* Stalls List Button (Visited Tracker & Revisit) */}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setShowTourStallsModal(true)}
                          style={{
                            padding: '0.45rem 0.65rem',
                            fontSize: '0.78rem',
                            background: 'rgba(34, 211, 238, 0.1)',
                            border: '1px solid rgba(34, 211, 238, 0.3)',
                            borderRadius: '10px',
                            color: 'var(--color-accent)',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                          title="View all stalls, visited tracker, and revisit options"
                        >
                          <Store size={13} />
                          <span>Stalls ({visitedStallIds.filter((id) => tourStops.some((s) => s.id === id)).length}/{tourStops.length})</span>
                        </button>

                        {/* Cancel / End Tour Button */}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={handleCancelTour}
                          style={{
                            padding: '0.45rem 0.75rem',
                            border: '1px solid rgba(244, 63, 94, 0.3)',
                            borderRadius: '10px',
                            fontSize: '0.78rem',
                            color: 'var(--color-danger)',
                            background: 'rgba(244, 63, 94, 0.08)',
                            fontWeight: 600,
                          }}
                          title="Exit guided tour"
                        >
                          ✕ End
                        </button>
                      </div>

                      {/* Tour Stops Sequence Progress Pills (Clickable to jump to any stop!) */}
                      <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.15rem', scrollbarWidth: 'none' }}>
                        {tourStops.map((stop, sIdx) => {
                          const isCurrent = sIdx === currentTourStopIndex;
                          const isPast = sIdx < currentTourStopIndex || visitedStallIds.includes(stop.id);
                          return (
                            <div
                              key={stop.id}
                              onClick={() => handleJumpToTourStop(sIdx)}
                              style={{
                                padding: '0.22rem 0.55rem',
                                borderRadius: '8px',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                background: isCurrent
                                  ? 'rgba(34, 211, 238, 0.22)'
                                  : isPast
                                    ? 'rgba(34, 197, 94, 0.15)'
                                    : 'rgba(255, 255, 255, 0.05)',
                                border: `1px solid ${
                                  isCurrent
                                    ? '#22d3ee'
                                    : isPast
                                      ? '#22c55e'
                                      : 'var(--color-border)'
                                }`,
                                color: isCurrent ? '#22d3ee' : isPast ? '#22c55e' : 'var(--color-muted)',
                                boxShadow: isCurrent ? '0 0 10px rgba(34, 211, 238, 0.35)' : 'none',
                              }}
                              title={`Jump directly to Stop ${sIdx + 1}: ${stop.name}`}
                            >
                              <span>{isPast ? '✓' : sIdx + 1}</span>
                              <span>{stop.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* Single Navigation View */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', minWidth: 0, flex: 1 }}>
                          <div style={{ width: 38, height: 38, background: 'rgba(99,102,241,0.18)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary-h)', flexShrink: 0 }}>
                            <Route size={18} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {isFarAway
                                ? `🏫 Head to School Entrance`
                                : `Navigating to ${selectedDestinationStoreId
                                  ? (stores.find((s) => s.id === selectedDestinationStoreId)?.name || 'Exhibitor')
                                  : (nodes.find((n) => n.id === selectedDestinationNodeId)?.label || 'Facility')}`}
                            </h3>
                            <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: 0 }}>
                              <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{totalDistance} m</span>
                              {' · '}Est: {totalDistance < 80 ? '< 1 min' : `${Math.ceil(totalDistance / 80)} min`}
                              {!mockMode && gpsAccuracy !== null && (
                                <span style={{
                                  marginLeft: '0.4rem',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  padding: '0.05rem 0.35rem',
                                  borderRadius: '4px',
                                  color: gpsAccuracy <= 5 ? '#22c55e' : gpsAccuracy <= 15 ? '#eab308' : '#f97316',
                                  background: 'rgba(255,255,255,0.06)',
                                }}>
                                  📍 ±{Math.round(gpsAccuracy)}m
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Minimize toggle */}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setNavSheetState('hidden')}
                          style={{
                            padding: '0.3rem 0.4rem',
                            borderRadius: '8px',
                            color: 'var(--color-muted)',
                            border: '1px solid var(--color-border)',
                            background: 'rgba(255,255,255,0.04)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.2rem',
                            fontSize: '0.72rem',
                          }}
                          title="Swipe down or tap to minimize"
                          aria-label="Minimize detail tab"
                        >
                          <ChevronDown size={15} />
                          <span>Hide</span>
                        </button>
                      </div>

                      {/* Single Navigation Actions Row */}
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setSelectedDestinationStoreId('');
                            setSelectedDestinationNodeId('');
                            setStoreSearchQuery('');
                            setNavSheetState('normal');
                            setActivePitstopDetour(null);
                          }}
                          style={{
                            flex: 1,
                            padding: '0.45rem 0.75rem',
                            border: '1px solid var(--color-border)',
                            borderRadius: '10px',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                          }}
                        >
                          ✕ Clear Route
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Active Pitstop Detour Floating Banner (Top) */}
          {activePitstopDetour && (
            <div
              id="pitstop-active-banner"
              style={{
                position: 'fixed',
                top: '5rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1040,
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.5rem 1rem',
                borderRadius: '30px',
                background: 'rgba(15, 23, 42, 0.94)',
                border: '1.5px solid #38bdf8',
                boxShadow: '0 8px 30px rgba(0,0,0,0.6), 0 0 16px rgba(56,189,248,0.3)',
                backdropFilter: 'blur(12px)',
                maxWidth: '92vw',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#f8fafc', minWidth: 0 }}>
                <span style={{ fontSize: '1.1rem' }}>🚻</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Detour: <strong style={{ color: '#38bdf8' }}>{activePitstopDetour.facility.name}</strong>
                </span>
              </div>
              <button
                onClick={handleResumeOriginalRoute}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  borderRadius: '20px',
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 8px rgba(34, 197, 94, 0.4)',
                }}
              >
                <span>Resume Route ➔</span>
              </button>
            </div>
          )}

          {/* Quick Pitstop Modal */}
          <QuickPitstopModal
            isOpen={showPitstopModal}
            onClose={() => setShowPitstopModal(false)}
            userLat={userLat}
            userLng={userLng}
            stores={stores}
            onSelectFacility={handleSelectPitstopFacility}
          />

          {/* Geofence Boundary Notice & Splash-style Bypass Screen */}
          {isFarAway && exhibitionSettings.school_boundary_enabled !== false && !bypassBoundaryCheck && (
            <PremisesBypassScreen
              onBypass={() => {
                setBypassBoundaryCheck(true);
                setIsFarAway(false);
                hasPromptedRef.current = true;
              }}
              allowBypass={exhibitionSettings.allow_boundary_bypass !== false}
              isAdmin={profile?.role === 'admin'}
              onMockMode={() => setMockMode(true)}
              googleMapsUrl={exhibitionSettings.google_maps_url}
              premisesLat={exhibitionSettings.premises_center_latitude}
              premisesLng={exhibitionSettings.premises_center_longitude}
              distanceKm={
                userLat && userLng
                  ? getDistance(
                      userLat,
                      userLng,
                      exhibitionSettings.premises_center_latitude,
                      exhibitionSettings.premises_center_longitude
                    ) / 1000
                  : null
              }
            />
          )}



          {/* Proximity Arrival Prompt during Guided Tour */}
          {arrivedStopPrompt && (
            <div
              className="glass animate-fade-in"
              style={{
                position: 'fixed',
                top: '5.5rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10000,
                maxWidth: '92vw',
                width: '380px',
                padding: '1.1rem 1.25rem',
                borderRadius: '16px',
                background: 'rgba(15, 23, 42, 0.95)',
                border: '1.5px solid rgba(34, 211, 238, 0.55)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
                backdropFilter: 'blur(16px)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: arrivedStopPrompt.id === 'venue-exit-gate-stop'
                      ? 'rgba(245, 158, 11, 0.2)'
                      : 'rgba(34, 211, 238, 0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: arrivedStopPrompt.id === 'venue-exit-gate-stop' ? '#fbbf24' : '#22d3ee',
                    flexShrink: 0,
                  }}
                >
                  {arrivedStopPrompt.id === 'venue-exit-gate-stop' ? <DoorOpen size={20} /> : <Store size={20} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      color: arrivedStopPrompt.id === 'venue-exit-gate-stop' ? '#fbbf24' : '#22d3ee',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {arrivedStopPrompt.id === 'venue-exit-gate-stop'
                      ? '🚪 Arrived at Exit Gate'
                      : guidedTourActive && tourStops.length > 0 && tourStops[currentTourStopIndex]?.id === arrivedStopPrompt.id
                        ? `🎯 Arrived at Stop ${currentTourStopIndex + 1} of ${tourStops.filter(s => s.id !== 'venue-exit-gate-stop').length}`
                        : '📍 Near Exhibition Stall'}
                  </span>
                  <h4
                    style={{
                      margin: '0.1rem 0 0',
                      fontSize: '1rem',
                      fontWeight: 800,
                      color: '#fff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {arrivedStopPrompt.name}
                  </h4>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-muted)', lineHeight: 1.45 }}>
                {arrivedStopPrompt.id === 'venue-exit-gate-stop' ? (
                  <>You have reached the designated <strong>{arrivedStopPrompt.name}</strong>! Ready to complete your tour and exit?</>
                ) : guidedTourActive && tourStops.length > 0 && tourStops[currentTourStopIndex]?.id === arrivedStopPrompt.id ? (
                  <>Have you finished visiting <strong>{arrivedStopPrompt.name}</strong>? Mark as visited to see the route to the next stop!</>
                ) : (
                  <>Visiting <strong>{arrivedStopPrompt.name}</strong>? Mark as visited to track your exhibition progress!</>
                )}
              </p>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.1rem' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1, fontSize: '0.78rem' }}
                  onClick={() => setArrivedStopPrompt(null)}
                >
                  {arrivedStopPrompt.id === 'venue-exit-gate-stop'
                    ? 'Stay on Map'
                    : guidedTourActive && tourStops.length > 0 && tourStops[currentTourStopIndex]?.id === arrivedStopPrompt.id
                      ? 'Still Visiting'
                      : 'Not Now'}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  style={{
                    flex: 1.4,
                    fontSize: '0.78rem',
                    background: arrivedStopPrompt.id === 'venue-exit-gate-stop'
                      ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                      : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    border: 'none',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    boxShadow: arrivedStopPrompt.id === 'venue-exit-gate-stop'
                      ? '0 2px 8px rgba(245, 158, 11, 0.35)'
                      : '0 2px 8px rgba(34, 197, 94, 0.35)',
                  }}
                  onClick={() => {
                    handleMarkStopVisited(arrivedStopPrompt);
                  }}
                >
                  {arrivedStopPrompt.id === 'venue-exit-gate-stop' ? (
                    <>
                      <DoorOpen size={14} />
                      <span>Exit & Finish 🎉</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      {guidedTourActive && tourStops.length > 0 && tourStops[currentTourStopIndex]?.id === arrivedStopPrompt.id
                        ? (currentTourStopIndex + 1 < tourStops.length ? 'Visited → Next Stop' : 'Finish Tour 🎉')
                        : 'Mark as Visited ✓'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Professional Tour Completion Modal */}
          {showTourCompletedModal && (
            <div
              className="animate-fade-in"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(11, 15, 26, 0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                zIndex: 20000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1.5rem',
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: '460px',
                  background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
                  borderRadius: '24px',
                  border: '1.5px solid rgba(168, 85, 247, 0.4)',
                  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7), 0 0 32px rgba(168, 85, 247, 0.25)',
                  padding: '2rem 1.75rem',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '1.25rem',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Decorative top ambient glow */}
                <div
                  style={{
                    position: 'absolute',
                    top: '-60px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '200px',
                    height: '120px',
                    background: 'radial-gradient(ellipse, rgba(168, 85, 247, 0.45), transparent 70%)',
                    pointerEvents: 'none',
                  }}
                />

                {/* Celebration Award Badge */}
                <div
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #a855f7, #6366f1, #22d3ee)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    boxShadow: '0 8px 28px rgba(168, 85, 247, 0.55)',
                  }}
                >
                  <Award size={40} />
                </div>

                <div>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      color: '#22d3ee',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      background: 'rgba(34, 211, 238, 0.12)',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '12px',
                      border: '1px solid rgba(34, 211, 238, 0.3)',
                      display: 'inline-block',
                      marginBottom: '0.65rem',
                    }}
                  >
                    ✨ Tour Completed Successfully
                  </span>
                  <h2
                    style={{
                      fontSize: '1.65rem',
                      fontWeight: 900,
                      color: '#fff',
                      margin: '0 0 0.4rem',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    Thank You For Visiting Us!
                  </h2>
                  <p
                    style={{
                      fontSize: '0.88rem',
                      color: 'var(--color-muted)',
                      margin: 0,
                      lineHeight: 1.55,
                      maxWidth: '380px',
                    }}
                  >
                    You have successfully visited all planned exhibition stalls across our campus. We hope you had an inspiring and memorable experience!
                  </p>
                </div>

                {/* Summary Highlights */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.75rem',
                    width: '100%',
                    margin: '0.25rem 0',
                  }}
                >
                  <div
                    style={{
                      padding: '0.85rem 0.75rem',
                      background: 'rgba(255, 255, 255, 0.04)',
                      borderRadius: '14px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.2rem',
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', fontWeight: 600 }}>Stalls Visited</span>
                    <span style={{ fontSize: '1.35rem', fontWeight: 900, color: '#22c55e' }}>
                      {completedTourStats.totalVisited} / {completedTourStats.totalStalls}
                    </span>
                  </div>

                  <div
                    style={{
                      padding: '0.85rem 0.75rem',
                      background: 'rgba(255, 255, 255, 0.04)',
                      borderRadius: '14px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.2rem',
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', fontWeight: 600 }}>Tour Progress</span>
                    <span style={{ fontSize: '1.35rem', fontWeight: 900, color: '#a855f7' }}>100% Done</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
                  <button
                    className="btn btn-primary"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '12px',
                      fontSize: '0.92rem',
                      fontWeight: 800,
                      background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                      border: 'none',
                      boxShadow: '0 4px 16px rgba(168, 85, 247, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}
                    onClick={() => setShowTourCompletedModal(false)}
                  >
                    <Check size={18} />
                    Done & Explore Map
                  </button>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Link
                      to="/"
                      className="btn btn-ghost"
                      style={{
                        flex: 1,
                        padding: '0.6rem',
                        borderRadius: '10px',
                        fontSize: '0.82rem',
                        border: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        textDecoration: 'none',
                      }}
                    >
                      <Home size={15} />
                      Home
                    </Link>
                    <Link
                      to="/stores"
                      className="btn btn-ghost"
                      style={{
                        flex: 1,
                        padding: '0.6rem',
                        borderRadius: '10px',
                        fontSize: '0.82rem',
                        border: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        textDecoration: 'none',
                      }}
                    >
                      <Store size={15} />
                      All Stores
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tour Stalls & Visited Tracker Modal / Bottom Drawer */}
          {showTourStallsModal && (
            <div
              className="animate-fade-in"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(11, 15, 26, 0.85)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                zIndex: 10050,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                padding: '0',
              }}
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowTourStallsModal(false);
              }}
            >
              <div
                className="glass"
                style={{
                  width: '100%',
                  maxWidth: '560px',
                  maxHeight: '85vh',
                  background: 'linear-gradient(170deg, rgba(26, 34, 53, 0.98), rgba(15, 23, 42, 0.99))',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  borderRadius: '24px 24px 0 0',
                  boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.75)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* Drawer Top Pull Pill */}
                <div
                  style={{
                    width: '36px',
                    height: '4px',
                    background: 'rgba(255, 255, 255, 0.25)',
                    borderRadius: '2px',
                    margin: '0.6rem auto 0.2rem',
                    flexShrink: 0,
                  }}
                />

                {/* Header */}
                <div
                  style={{
                    padding: '0.75rem 1.25rem 0.85rem',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #06b6d4, #6366f1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      <Store size={18} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800 }}>
                        {guidedTourActive ? 'Exhibition Tour Stalls' : 'Exhibition Stalls'}
                      </h3>
                      <p style={{ margin: 0, fontSize: '0.73rem', color: 'var(--color-muted)' }}>
                        <span style={{ color: '#22c55e', fontWeight: 700 }}>
                          {(guidedTourActive && tourStops.length > 0 ? tourStops : stores.filter(s => s.id !== 'kalawana-national-school-landmark' && !isFacilityStore(s))).filter(s => visitedStallIds.includes(s.id)).length}
                        </span> of {(guidedTourActive && tourStops.length > 0 ? tourStops : stores.filter(s => s.id !== 'kalawana-national-school-landmark' && !isFacilityStore(s))).length} Stalls Visited
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <button
                      onClick={() => {
                        setShowTourStallsModal(false);
                        handleOpenTourPlanner();
                      }}
                      className="btn btn-ghost btn-sm"
                      style={{
                        fontSize: '0.74rem',
                        padding: '0.3rem 0.65rem',
                        color: 'var(--color-accent)',
                        border: '1px solid rgba(34, 211, 238, 0.3)',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                      }}
                    >
                      <Compass size={13} />
                      <span>Change Stall</span>
                    </button>
                    <button
                      onClick={() => setShowTourStallsModal(false)}
                      className="btn btn-ghost btn-sm btn-icon"
                      style={{ width: 30, height: 30, padding: 0 }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Stalls List */}
                <div
                  style={{
                    flex: '1 1 auto',
                    overflowY: 'auto',
                    padding: '0.85rem 1rem 2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.65rem',
                  }}
                >
                  {(guidedTourActive && tourStops.length > 0 ? tourStops : stores.filter(s => s.id !== 'kalawana-national-school-landmark' && !isFacilityStore(s))).map((stall, idx) => {
                    const isVisited = visitedStallIds.includes(stall.id);
                    const isCurrent = guidedTourActive && idx === currentTourStopIndex;
                    const isExitGate = stall.id === 'venue-exit-gate-stop';

                    return (
                      <div
                        key={stall.id}
                        style={{
                          background: isExitGate
                            ? isCurrent
                              ? 'rgba(168, 85, 247, 0.14)'
                              : 'rgba(168, 85, 247, 0.06)'
                            : isCurrent
                              ? 'rgba(34, 211, 238, 0.08)'
                              : isVisited
                                ? 'rgba(34, 197, 94, 0.06)'
                                : 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${
                            isExitGate
                              ? isCurrent
                                ? 'rgba(168, 85, 247, 0.55)'
                                : 'rgba(168, 85, 247, 0.25)'
                              : isCurrent
                                ? 'rgba(34, 211, 238, 0.45)'
                                : isVisited
                                  ? 'rgba(34, 197, 94, 0.3)'
                                  : 'rgba(255, 255, 255, 0.08)'
                          }`,
                          borderRadius: '14px',
                          padding: '0.75rem 0.85rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.55rem',
                          flexShrink: 0,
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {/* Top: Stall Info & Status Badge */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: '8px',
                                background: isExitGate
                                  ? 'rgba(168, 85, 247, 0.2)'
                                  : isVisited
                                    ? 'rgba(34, 197, 94, 0.2)'
                                    : isCurrent
                                      ? 'rgba(34, 211, 238, 0.2)'
                                      : 'rgba(255, 255, 255, 0.06)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: isExitGate ? '#c084fc' : isVisited ? '#22c55e' : isCurrent ? '#22d3ee' : 'var(--color-muted)',
                                fontWeight: 800,
                                fontSize: isExitGate ? '0.9rem' : '0.75rem',
                                flexShrink: 0,
                              }}
                            >
                              {isExitGate ? '🚪' : isVisited ? '✓' : idx + 1}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: isExitGate ? '#e9d5ff' : isVisited ? '#e2e8f0' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {stall.name}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: isExitGate ? '#c084fc' : 'var(--color-muted)' }}>
                                {isExitGate ? 'Final Venue Exit • Tour End' : stall.floor ? `🏢 ${stall.floor}` : 'Exhibition Hall'}
                              </div>
                            </div>
                          </div>

                          {/* Status Badge */}
                          <div style={{ flexShrink: 0 }}>
                            {isVisited ? (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  color: '#22c55e',
                                  background: 'rgba(34, 197, 94, 0.15)',
                                  border: '1px solid rgba(34, 197, 94, 0.35)',
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: '6px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                }}
                              >
                                {isExitGate ? '✓ Tour Completed' : '✓ Visited'}
                              </span>
                            ) : isCurrent ? (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  color: isExitGate ? '#c084fc' : '#22d3ee',
                                  background: isExitGate ? 'rgba(168, 85, 247, 0.15)' : 'rgba(34, 211, 238, 0.15)',
                                  border: `1px solid ${isExitGate ? 'rgba(168, 85, 247, 0.35)' : 'rgba(34, 211, 238, 0.35)'}`,
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: '6px',
                                }}
                              >
                                {isExitGate ? '🚪 Exiting Venue' : '📍 Active Stop'}
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  color: isExitGate ? '#c084fc' : 'var(--color-muted)',
                                  background: isExitGate ? 'rgba(168, 85, 247, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                  border: isExitGate ? '1px solid rgba(168, 85, 247, 0.25)' : 'none',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '6px',
                                }}
                              >
                                {isExitGate ? '🚪 Exit Gate' : 'Upcoming'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions Row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          {isVisited ? (
                            <>
                              {/* Revisit Button */}
                              <button
                                onClick={() => {
                                  handleUnmarkStopVisited(stall.id, true);
                                  setShowTourStallsModal(false);
                                }}
                                className="btn btn-sm"
                                style={{
                                  flex: 1,
                                  fontSize: '0.74rem',
                                  padding: '0.35rem 0.6rem',
                                  background: 'rgba(34, 211, 238, 0.12)',
                                  border: '1px solid rgba(34, 211, 238, 0.35)',
                                  color: '#22d3ee',
                                  fontWeight: 700,
                                  borderRadius: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.3rem',
                                }}
                                title="Revisit this stop (routes here now and marks unvisited)"
                              >
                                <RotateCcw size={13} />
                                <span>Revisit</span>
                              </button>

                              {/* Mark as Not Visited Button (undo accidental click) */}
                              <button
                                onClick={() => handleUnmarkStopVisited(stall.id, false)}
                                className="btn btn-ghost btn-sm"
                                style={{
                                  flex: 1,
                                  fontSize: '0.72rem',
                                  padding: '0.35rem 0.6rem',
                                  background: 'rgba(245, 158, 11, 0.08)',
                                  border: '1px solid rgba(245, 158, 11, 0.25)',
                                  color: '#fbbf24',
                                  fontWeight: 600,
                                  borderRadius: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.25rem',
                                }}
                                title="If pressed visited by accident, tap to mark as not visited"
                              >
                                ✕ Mark as Not Visited
                              </button>
                            </>
                          ) : (
                            <>
                              {/* Navigate Here Button */}
                              <button
                                onClick={() => {
                                  if (guidedTourActive) {
                                    handleJumpToTourStop(idx, true);
                                  } else {
                                    setSelectedDestinationStoreId(stall.id);
                                    setSelectedDestinationNodeId('');
                                    setNavigationActive(true);
                                    if (stall.latitude && stall.longitude) {
                                      setMapCenterLat(stall.latitude);
                                      setMapCenterLng(stall.longitude);
                                    }
                                  }
                                  setShowTourStallsModal(false);
                                }}
                                className="btn btn-sm"
                                style={{
                                  flex: 1,
                                  fontSize: '0.74rem',
                                  padding: '0.35rem 0.6rem',
                                  background: isExitGate
                                    ? 'linear-gradient(135deg, #a855f7, #6366f1)'
                                    : isCurrent
                                      ? 'linear-gradient(135deg, #06b6d4, #3b82f6)'
                                      : 'rgba(255, 255, 255, 0.06)',
                                  border: isExitGate || isCurrent ? 'none' : '1px solid rgba(255, 255, 255, 0.15)',
                                  color: '#fff',
                                  fontWeight: 600,
                                  borderRadius: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.3rem',
                                }}
                              >
                                <Navigation size={13} />
                                <span>{isExitGate ? (isCurrent ? 'Navigating to Exit' : 'Exit Venue Now') : isCurrent ? 'Navigating Here' : 'Navigate Here'}</span>
                              </button>

                              {/* Mark Visited Button */}
                              <button
                                onClick={() => handleMarkStopVisited(stall)}
                                className="btn btn-sm"
                                style={{
                                  flex: 1,
                                  fontSize: '0.74rem',
                                  padding: '0.35rem 0.6rem',
                                  background: isExitGate
                                    ? 'linear-gradient(135deg, #10b981, #059669)'
                                    : 'linear-gradient(135deg, #22c55e, #16a34a)',
                                  border: 'none',
                                  color: '#fff',
                                  fontWeight: 700,
                                  borderRadius: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.3rem',
                                }}
                              >
                                <Check size={13} />
                                <span>{isExitGate ? 'Finish Tour & Exit' : 'Mark Visited'}</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Guided Tour Planner: Stalls Grouped under Blocks in Ascending Order */}
          <StallTourSelectModal
            isOpen={showChecklistPrompt}
            onClose={() => setShowChecklistPrompt(false)}
            stores={stores}
            nodes={nodes}
            initialSelectedStoreIds={tourStops.length > 0 ? tourStops.map((s) => s.id) : undefined}
            onConfirmTour={(selectedIds) => {
              setShowChecklistPrompt(false);
              const selectedStores = stores.filter((s) => selectedIds.includes(s.id));
              generateGuidedTourRouteForStores(selectedStores);
            }}
          />
        </div>
      </div>
    </>
  );
}
