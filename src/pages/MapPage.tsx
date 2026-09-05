import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Route,
  X,
  Search,
  Navigation,
  CalendarDays,
  Store,
  ArrowLeft,
  Bell,
  Compass,
  AlertTriangle,
  CheckSquare,
  Check,
  Award,
  Home,
} from 'lucide-react';
import { AdminModal } from '../components/admin/AdminModal';
import { useAuth } from '../contexts/AuthContext';
import { GPSPermissionBanner } from '../components/GPSPermissionBanner';
import {
  supabase,
  type Store as StoreType,
  type NavigationNode,
  type NavigationEdge,
} from '../lib/supabase';
import { MapView } from '../components/MapView';
import { MapView3D } from '../components/MapView3D';
import { getCampusStoreLocation } from '../components/KalawanaSchool3DLayer';
import { calculateShortestPathBetweenCoordinates, findClosestNode, findClosestPointOnGraph, getDistance, getHeading } from '../utils/dijkstra';
import { fetchOSRMRoute } from '../utils/osrmRouting';
import { logAnalyticsEvent } from '../lib/analytics';
import { GPSKalmanFilter } from '../utils/gpsFilter';

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

export function MapPage() {
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
  const [snappedToNode, setSnappedToNode] = useState<string | null>(null); // label of entrance used as fallback start
  const [, setGpsError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(false);

  // Kalman Filter for coordinates smoothing
  const filterRef = useRef(new GPSKalmanFilter(0.8, 1.8));

  // Selected mock starting node (if GPS is disabled)
  const [mockStartNodeId, setMockStartNodeId] = useState('');

  // Destination / Navigation states
  const [selectedDestinationStoreId, setSelectedDestinationStoreId] = useState('');
  const [selectedDestinationNodeId, setSelectedDestinationNodeId] = useState('');
  const [calculatedRoute, setCalculatedRoute] = useState<NavigationNode[]>([]);
  const [totalDistance, setTotalDistance] = useState(0); // in meters
  const [guideSteps, setGuideSteps] = useState<string[]>([]);
  const [navigationActive, setNavigationActive] = useState(false);
  // Number of leading nodes in calculatedRoute that came from outdoor OSM routing
  // 0 means all nodes are from the internal drawn graph (user is inside campus)
  const [outdoorSegmentCount, setOutdoorSegmentCount] = useState(0);
  const [mapTheme, setMapTheme] = useState<'dark' | 'streets' | 'light' | '3d'>('light');
  const [showMesh, setShowMesh] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // Settings & Guided Tour states
  const [exhibitionSettings, setExhibitionSettings] = useState({
    entrance_latitude: 6.53586,
    entrance_longitude: 80.40035,
    entrance_threshold_meters: 20.0,
    premises_center_latitude: 6.535472,
    premises_center_longitude: 80.401000,
    premises_radius_meters: 150.0,
    school_boundary_enabled: true,
  });
  const exhibitionSettingsRef = useRef(exhibitionSettings);
  useEffect(() => {
    exhibitionSettingsRef.current = exhibitionSettings;
  }, [exhibitionSettings]);

  const [isFarAway, setIsFarAway] = useState(false);
  const [showChecklistPrompt, setShowChecklistPrompt] = useState(false);
  const [checklistSearchQuery, setChecklistSearchQuery] = useState('');

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
  const [tourSelectedStallIds, setTourSelectedStallIds] = useState<string[]>([]);
  const [arrivedStopPrompt, setArrivedStopPrompt] = useState<StoreType | null>(null);
  const lastPromptedStopIdRef = useRef<string | null>(null);
  const [showTourCompletedModal, setShowTourCompletedModal] = useState(false);
  const [completedTourStats, setCompletedTourStats] = useState<{ totalStalls: number; totalVisited: number }>({
    totalStalls: 0,
    totalVisited: 0,
  });

  const handleOpenTourPlanner = () => {
    const activeList = stores.filter(s => s.id !== 'kalawana-national-school-landmark');
    const listToUse = activeList.length > 0 ? activeList : DEFAULT_DEMO_STALLS;
    // By default, select all available stalls to visit on the tour
    setTourSelectedStallIds(listToUse.map(s => s.id));
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

  // Bottom sheet drag state (Google Maps style)
  const [navSheetExpanded, setNavSheetExpanded] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetDragStartY = useRef<number | null>(null);
  const sheetDragDelta = useRef<number>(0);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    sheetDragStartY.current = e.touches[0].clientY;
    sheetDragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    if (sheetDragStartY.current === null) return;
    const delta = e.touches[0].clientY - sheetDragStartY.current;
    sheetDragDelta.current = delta;
    // Resist drag past limits
    const clamped = navSheetExpanded
      ? Math.max(0, Math.min(delta, 300))   // expanded: only allow dragging DOWN
      : Math.max(-300, Math.min(delta, 0)); // collapsed: only allow dragging UP
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${clamped}px)`;
    }
  }, [navSheetExpanded]);

  const handleSheetTouchEnd = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const delta = sheetDragDelta.current;
    sheetDragStartY.current = null;
    sheetDragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
      sheetRef.current.style.transform = 'translateY(0)';
    }
    if (delta < -60) setNavSheetExpanded(true);   // dragged up → expand
    if (delta > 60)  setNavSheetExpanded(false);  // dragged down → collapse
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

  useEffect(() => {
    loadNavigationResources();
    startLocationTracking();

    const gpsFilter = filterRef.current;
    return () => {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
      gpsFilter.reset();
    };
  }, []);

  async function loadNavigationResources() {
    try {
      setLoading(true);
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

      const activeStores = storesRes.data || [];
      const navigationNodes = nodesRes.data || [];
      const navigationEdges = edgesRes.data || [];

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
        return { ...store, latitude: pos.lat || store.latitude, longitude: pos.lng || store.longitude };
      });

      setStores(processedStores);
      // Sort navigation nodes naturally in ascending order (Node 1, Node 2, ...)
      const sortedNodes = [...navigationNodes].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
      );
      setNodes(sortedNodes);
      setEdges(navigationEdges);

      // Identify primary map entrance node / Node 1
      const entranceNode =
        sortedNodes.find(
          (n) =>
            n.type === 'entrance' ||
            n.label.toLowerCase().includes('node 1') ||
            n.label.toLowerCase().includes('entrance')
        ) || sortedNodes[0];

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
      console.error('Error fetching navigation data:', err);
    } finally {
      setLoading(false);
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
        const { latitude: rawLat, longitude: rawLng, accuracy } = position.coords;
        const { lat, lng } = filterRef.current.filter(rawLat, rawLng, accuracy, position.timestamp || Date.now());
        setUserLat(lat);
        setUserLng(lng);
        setGpsAccuracy(accuracy ?? null);
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
    if (mockMode) {
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
  }, [mockMode, exhibitionSettings]);

  const handleSelectMockLocation = (presetOrNodeId: string) => {
    setMockMode(true);
    setMockStartNodeId(presetOrNodeId);

    if (presetOrNodeId === 'entrance') {
      const entranceNode =
        nodes.find(
          (n) =>
            n.type === 'entrance' ||
            n.label.toLowerCase().includes('node 1') ||
            n.label.toLowerCase().includes('entrance')
        ) || nodes[0];
      const lat = entranceNode ? entranceNode.latitude : (exhibitionSettings.entrance_latitude || 6.53586);
      const lng = entranceNode ? entranceNode.longitude : (exhibitionSettings.entrance_longitude || 80.40035);
      setUserLat(lat);
      setUserLng(lng);
      setIsFarAway(false);
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
      const node = nodes.find(n => n.id === presetOrNodeId);
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
  };

  /** Compute navigation route strictly for the current single active leg of the guided tour */
  const routeToTourStop = (
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

    const p = calculateShortestPathBetweenCoordinates(
      fromLat,
      fromLng,
      targetLat,
      targetLng,
      nodes,
      edges
    );

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

    setCalculatedRoute(sequencedRouteNodes);
    let cumulativeDist = 0;
    const steps = [`📍 Head to Stop ${stopIndex + 1} of ${totalStops}: ${targetStore.name}`];
    for (let i = 0; i < sequencedRouteNodes.length - 1; i++) {
      const from = sequencedRouteNodes[i];
      const to = sequencedRouteNodes[i + 1];
      const dist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
      cumulativeDist += dist;
      if (to.type === 'store' || to.id.startsWith('store-stop-')) {
        steps.push(`Arrive at: ${to.label} (${Math.round(dist)}m)`);
      }
    }
    setTotalDistance(Math.round(cumulativeDist));
    setGuideSteps(steps);
  };

  const generateGuidedTourRoute = (selectedStoreIdsToTour: string[]) => {
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

    // 2. Prepare stores with normalized campus coordinates
    const realStores = stores.filter((s) => s.id !== 'kalawana-national-school-landmark');
    const availableStalls = realStores.length > 0 ? realStores : DEFAULT_DEMO_STALLS;

    const normalizedStores: StoreType[] = availableStalls.map((store, idx) => {
      const pos = getCampusStoreLocation(store, idx);
      return {
        ...store,
        latitude: pos.lat,
        longitude: pos.lng,
      };
    });

    const targetStores = normalizedStores.filter((s) => selectedStoreIdsToTour.includes(s.id));

    if (targetStores.length === 0) {
      alert('Please select at least one stall to visit on your tour!');
      return;
    }

    setLoading(true);

    // 3. Optimal Nearest-Neighbor TSP shortest path order
    let currentLat = startLatVal;
    let currentLng = startLngVal;

    const remaining = [...targetStores];
    const orderedTourStops: StoreType[] = [];

    while (remaining.length > 0) {
      let bestIndex = 0;
      let minDistance = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const store = remaining[i];
        const p = calculateShortestPathBetweenCoordinates(
          currentLat,
          currentLng,
          store.latitude!,
          store.longitude!,
          nodes,
          edges
        );

        let d = Infinity;
        if (p && p.length > 0) {
          d = 0;
          for (let j = 0; j < p.length - 1; j++) {
            d += getDistance(p[j].latitude, p[j].longitude, p[j + 1].latitude, p[j + 1].longitude);
          }
          d += getDistance(p[p.length - 1].latitude, p[p.length - 1].longitude, store.latitude!, store.longitude!);
        } else {
          d = getDistance(currentLat, currentLng, store.latitude!, store.longitude!) + 1000;
        }

        if (d < minDistance) {
          minDistance = d;
          bestIndex = i;
        }
      }

      const nextStore = remaining[bestIndex];
      remaining.splice(bestIndex, 1);
      orderedTourStops.push(nextStore);
      currentLat = nextStore.latitude!;
      currentLng = nextStore.longitude!;
    }

    setLoading(false);

    if (orderedTourStops.length > 0) {
      setTourStops(orderedTourStops);
      setCurrentTourStopIndex(0);
      lastPromptedStopIdRef.current = null;
      setArrivedStopPrompt(null);
      setSelectedDestinationStoreId('');
      setSelectedDestinationNodeId('');
      setGuidedTourActive(true);
      setNavigationActive(true);
      setNavSheetExpanded(true);

      // Route strictly to Stop 1 (the first/closest store)
      routeToTourStop(startLatVal, startLngVal, orderedTourStops[0], 0, orderedTourStops.length);
    } else {
      alert('Could not compute routing path. Please check network graph or stall locations.');
    }
  };

  const handleMarkCurrentStopVisited = () => {
    if (!guidedTourActive || tourStops.length === 0) return;
    const currentStop = tourStops[currentTourStopIndex];
    if (currentStop) {
      const updatedVisited = Array.from(new Set([...visitedStallIds, currentStop.id]));
      setVisitedStallIds(updatedVisited);
      setArrivedStopPrompt(null);

      if (currentTourStopIndex + 1 < tourStops.length) {
        const nextIndex = currentTourStopIndex + 1;
        setCurrentTourStopIndex(nextIndex);

        // Start next leg from user's current GPS location if available, otherwise from the visited stall
        const fromLat = userLat !== null ? userLat : (currentStop.latitude || 6.535472);
        const fromLng = userLng !== null ? userLng : (currentStop.longitude || 80.401000);

        routeToTourStop(fromLat, fromLng, tourStops[nextIndex], nextIndex, tourStops.length);
      } else {
        setGuidedTourActive(false);
        setCalculatedRoute([]);
        setNavigationActive(false);
        setCompletedTourStats({
          totalStalls: tourStops.length,
          totalVisited: updatedVisited.length,
        });
        setShowTourCompletedModal(true);
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
  };

  // Automatic Proximity Arrival Detector during guided tour
  useEffect(() => {
    if (!guidedTourActive || tourStops.length === 0) return;
    if (userLat === null || userLng === null) return;
    const currentStop = tourStops[currentTourStopIndex];
    if (!currentStop) return;

    const stopIdx = stores.findIndex((s) => s.id === currentStop.id);
    const campusPos = getCampusStoreLocation(currentStop, stopIdx >= 0 ? stopIdx : 0);
    const targetLat = currentStop.latitude ?? campusPos.lat;
    const targetLng = currentStop.longitude ?? campusPos.lng;

    if (targetLat && targetLng) {
      const dist = getDistance(userLat, userLng, targetLat, targetLng);
      // Prompt when within 15 meters of target store and hasn't been prompted yet
      if (dist <= 15 && lastPromptedStopIdRef.current !== currentStop.id && !visitedStallIds.includes(currentStop.id)) {
        lastPromptedStopIdRef.current = currentStop.id;
        setArrivedStopPrompt(currentStop);
      }
    }
  }, [userLat, userLng, guidedTourActive, tourStops, currentTourStopIndex, visitedStallIds, stores]);

  // Handle deep-linking navigation targets via ?to= query parameters
  // Handle deep-linking navigation targets via query parameters
  useEffect(() => {
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
  }, [searchParams, stores, nodes, setSearchParams]);

  // Main pathfinder computation trigger
  useEffect(() => {
    if (selectedDestinationStoreId || selectedDestinationNodeId) {
      calculateRoutePath();
    } else {
      setCalculatedRoute([]);
      setTotalDistance(0);
      setGuideSteps([]);
      setNavigationActive(false);
      setOutdoorSegmentCount(0);
      lastLoggedDestinationRef.current = '';
      lastOSRMRouteRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDestinationStoreId, selectedDestinationNodeId, userLat, userLng, mockMode, mockStartNodeId, nodes, edges]);

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

    const CAMPUS_RADIUS = exhibitionSettings.premises_radius_meters || 150;
    const CAMPUS_CENTER_LAT = exhibitionSettings.premises_center_latitude || 6.535472;
    const CAMPUS_CENTER_LNG = exhibitionSettings.premises_center_longitude || 80.401000;

    // Find best entrance node (type === 'entrance') — the handoff point between outdoor and indoor.
    // Use the entrance closest to the USER's position, not the campus center,
    // so multi-entrance campuses route to the correct gate.
    const entranceNodes = nodes.filter((n) => n.type === 'entrance');
    const closestEntrance = entranceNodes.length > 0
      ? findClosestNode(startLat, startLng, entranceNodes)
      : (nodes.length > 0 ? findClosestNode(CAMPUS_CENTER_LAT, CAMPUS_CENTER_LNG, nodes) : null);

    const distFromCampus = getDistance(startLat, startLng, CAMPUS_CENTER_LAT, CAMPUS_CENTER_LNG);
    // User is physically outside the campus whenever their position exceeds the campus radius.
    // Outside users route along real public roads via OSRM to the venue gate.
    const isOutsideCampus = distFromCampus > CAMPUS_RADIUS;
    setIsFarAway(isOutsideCampus); // keep UI state in sync

    let graphPath: NavigationNode[] = [];
    const connectedNodes = nodes.filter((n) => edges.some((e) => e.from_node_id === n.id || e.to_node_id === n.id));

    const explicitDestNodeId =
      selectedDestinationNodeId ||
      (selectedDestinationStoreId ? nodes.find((n) => n.store_id === selectedDestinationStoreId)?.id : null) ||
      (connectedNodes.length > 0 ? findClosestNode(targetLat, targetLng, connectedNodes)?.id : null) ||
      null;

    if (!isOutsideCampus && nodes.length > 0 && edges.length > 0) {
      // Strictly route inside campus along drawn walkway graph with dual edge-snapping
      graphPath = calculateShortestPathBetweenCoordinates(
        startLat,
        startLng,
        targetLat,
        targetLng,
        nodes,
        edges,
        mockStartNodeId || null,
        explicitDestNodeId
      );
    }

    setSnappedToNode(null);

    // 4. Outdoor segment via OSRM (only when user is outside campus)
    let outdoorNodes: NavigationNode[] = [];
    let osrmGuideSteps: string[] | null = null;
    let osrmTotalDistance: number | null = null;
    if (isOutsideCampus && closestEntrance) {
      const destKey = selectedDestinationStoreId || selectedDestinationNodeId || 'campus-gate';
      const cached = lastOSRMRouteRef.current;
      // Re-use cached street route if user hasn't moved > 35 meters and destination hasn't changed.
      // This prevents rapid GPS jitter from overwhelming public OSRM servers and getting rate-limited (HTTP 429).
      const canUseCache =
        cached &&
        cached.destId === destKey &&
        getDistance(startLat, startLng, cached.startLat, cached.startLng) < 35;

      if (canUseCache) {
        outdoorNodes = cached.nodes;
        osrmGuideSteps = cached.guideSteps;
        osrmTotalDistance = cached.totalDistance;
      } else {
        const entranceLat = closestEntrance.latitude;
        const entranceLng = closestEntrance.longitude;
        const osrmResult = await fetchOSRMRoute(
          startLat, startLng,
          entranceLat, entranceLng,
          startLabel,
          closestEntrance.label || 'School Entrance'
        );

        if (osrmResult && osrmResult.nodes.length > 1) {
          // Use all OSRM nodes except the last one (entrance) —
          // the entrance is re-appended from the graph to ensure exact coordinate match.
          outdoorNodes = osrmResult.nodes.slice(0, -1);
          // Preserve OSRM's rich turn-by-turn instructions for the guide panel
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
          // Network or rate-limit failure on re-fetch: KEEP the previous street route! NEVER snap back to straight line!
          outdoorNodes = cached.nodes;
          osrmGuideSteps = cached.guideSteps;
          osrmTotalDistance = cached.totalDistance;
        } else {
          // OSRM failed with no previous route — single virtual node (straight-line fallback to entrance)
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
    //    Outside campus: [OSRM outdoor nodes] → [Campus entrance] → [...Drawn graph...] → [Store]
    //    Inside campus:  [User position] → [...Drawn graph...] → [Store]

    const userStartVirtualNode: NavigationNode = {
      id: 'actual-start-virtual',
      label: startLabel,
      latitude: startLat,
      longitude: startLng,
      floor: graphPath[0]?.floor || null,
      type: 'poi',
      store_id: null,
      created_at: new Date().toISOString()
    };

    const destEndVirtualNode: NavigationNode = {
      id: 'actual-end-virtual',
      label: targetLabel,
      latitude: targetLat,
      longitude: targetLng,
      floor: graphPath[graphPath.length - 1]?.floor || null,
      type: 'store',
      store_id: selectedDestinationStoreId || null,
      created_at: new Date().toISOString()
    };

    const finalRoute: NavigationNode[] = [];
    let newOutdoorSegmentCount = 0;

    if (isOutsideCampus) {
      // ── OUTSIDE CAMPUS ─────────────────────────────────────────────────────
      // Show ONLY the street path leading to the campus entrance gate.
      // The indoor store path is hidden until the user crosses the boundary.
      if (outdoorNodes.length > 0) {
        finalRoute.push(...outdoorNodes);
        newOutdoorSegmentCount = outdoorNodes.length;
      }
      // Always end at the entrance node so the map shows the target clearly
      if (closestEntrance) {
        const lastOutdoorNode = finalRoute[finalRoute.length - 1];
        const alreadyAtEntrance = lastOutdoorNode &&
          getDistance(lastOutdoorNode.latitude, lastOutdoorNode.longitude,
            closestEntrance.latitude, closestEntrance.longitude) < 5;
        if (!alreadyAtEntrance) {
          finalRoute.push({
            ...closestEntrance,
            label: closestEntrance.label || 'School Entrance',
          });
        }
      }
    } else {
      // ── INSIDE CAMPUS ──────────────────────────────────────────────────────
      // Path format:
      // Store -> Closest point of path drawing -> User location (by drawn paths ONLY, no direct paths)
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
        // Fallback: If no continuous path found, snap both start and end to closest drawn path points
        // NEVER draw a direct straight line across the school / buildings!
        const startSnap = findClosestPointOnGraph(startLat, startLng, nodes, edges);
        const endSnap = findClosestPointOnGraph(targetLat, targetLng, nodes, edges);
        if (startSnap && endSnap) {
          finalRoute.push(userStartVirtualNode);
          finalRoute.push({
            id: '__fallback_start_snap__',
            label: 'Walkway Point',
            latitude: startSnap.snapLat,
            longitude: startSnap.snapLng,
            floor: null,
            type: 'path',
            store_id: null,
            created_at: new Date().toISOString()
          });
          finalRoute.push({
            id: '__fallback_end_snap__',
            label: 'Store Connection Point',
            latitude: endSnap.snapLat,
            longitude: endSnap.snapLng,
            floor: null,
            type: 'path',
            store_id: null,
            created_at: new Date().toISOString()
          });
          finalRoute.push(destEndVirtualNode);
        } else {
          finalRoute.push(userStartVirtualNode);
        }
      }
    }

    setOutdoorSegmentCount(newOutdoorSegmentCount);
    setCalculatedRoute(finalRoute);
    setNavigationActive(true);

    if (finalRoute.length > 0) {
      let distanceMeters = 0;
      const steps: string[] = [];

      if (isOutsideCampus) {
        // Outside campus: prefer OSRM's rich turn-by-turn guide steps.
        // Fall back to heading-based steps if OSRM had no steps data.
        if (osrmGuideSteps && osrmGuideSteps.length > 1) {
          steps.push(...osrmGuideSteps);
          distanceMeters = osrmTotalDistance ?? 0;
          // Add total from remaining finalRoute nodes not in OSRM (entrance extra segment)
          for (let i = 0; i < finalRoute.length - 1; i++) {
            const from = finalRoute[i];
            const to = finalRoute[i + 1];
            // Only count any entrance gap not covered by OSRM
            if (i >= outdoorNodes.length) {
              distanceMeters += getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
            }
          }
        } else if (finalRoute.length > 1) {
          steps.push(`Start from ${finalRoute[0].label}`);
          for (let i = 0; i < finalRoute.length - 1; i++) {
            const from = finalRoute[i];
            const to = finalRoute[i + 1];
            const segDist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
            distanceMeters += segDist;
            const heading = getHeading(from.latitude, from.longitude, to.latitude, to.longitude);
            steps.push(`Head ${heading} towards ${to.label} (${Math.round(segDist)}m)`);
          }
          const entranceName = closestEntrance?.label || 'School Entrance';
          steps.push(`🏫 Enter through ${entranceName} to access the exhibition`);
        }
      } else {
        // Inside campus: guide steps are about reaching the store
        if (finalRoute.length > 1) {
          steps.push(`Start from ${finalRoute[0].label}`);
          for (let i = 0; i < finalRoute.length - 1; i++) {
            const from = finalRoute[i];
            const to = finalRoute[i + 1];
            const segDist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
            distanceMeters += segDist;
            const heading = getHeading(from.latitude, from.longitude, to.latitude, to.longitude);
            steps.push(`Head ${heading} towards ${to.label} (${Math.round(segDist)}m)`);
          }
          steps.push(`Arrive at ${targetLabel}`);
        }
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
  
  // Extract unique categories from stores for the map legend
  const mapCategories = stores.reduce<Array<{ id: string; name: string; color: string | null }>>((acc, store) => {
    if (store.categories && !acc.some((c) => c.id === store.categories!.id)) {
      acc.push(store.categories);
    }
    return acc;
  }, []);

  const filteredSearchStores = storeSearchQuery.trim()
    ? stores.filter((st) =>
        st.name.toLowerCase().includes(storeSearchQuery.toLowerCase())
      )
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <Link to="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface2)', width: 32, height: 32, borderRadius: '6px', color: 'var(--color-text)', flexShrink: 0 }}>
              <ArrowLeft size={16} />
            </Link>
            <div className="map-brand-text">
              <h2 style={{ fontSize: '0.9rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                Interactive Floor Map
              </h2>
              <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)' }}>
                Exhibition Navigation System
              </span>
            </div>
          </div>

          {/* Right: desktop nav links */}
          <div className="map-topbar-links" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
            <button
              onClick={() => {
                setMapCenterLat(6.535472);
                setMapCenterLng(80.401000);
              }}
              className="btn btn-sm"
              style={{
                padding: '0.35rem 0.65rem',
                background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Center on Kalawana National School"
            >
              📍 Kalawana School
            </button>
            {/* 3D View Link Button (hidden from UI) */}
            <Link
              to="/map3d"
              className="btn btn-sm"
              style={{
                display: 'none',
                padding: '0.35rem 0.65rem',
                background: 'rgba(168, 85, 247, 0.15)',
                color: '#a855f7',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                fontWeight: 600,
              }}
            >
              3D School
            </Link>
            <Link to="/search" className="btn btn-ghost btn-sm" style={{ padding: '0.35rem 0.65rem' }}>
              <Search size={14} style={{ marginRight: 4 }} />
              Search
            </Link>
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
            <Link to="/exhibitions" className="btn btn-ghost btn-sm" style={{ padding: '0.35rem 0.65rem' }}>
              <CalendarDays size={14} style={{ marginRight: 4 }} />
              Exhibitions
            </Link>
            <Link to="/stores" className="btn btn-ghost btn-sm" style={{ padding: '0.35rem 0.65rem' }}>
              <Store size={14} style={{ marginRight: 4 }} />
              Stores
            </Link>
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
          </div>

          {/* Mobile-only: Tour button + boundary toggle + bell icon inline */}
          <div className="map-topbar-mobile-icons" style={{ display: 'none', gap: '0.35rem', alignItems: 'center', flexShrink: 0 }}>
            <button
              onClick={handleOpenTourPlanner}
              className="btn btn-primary btn-sm"
              style={{
                padding: '0.25rem 0.6rem',
                fontSize: '0.7rem',
                fontWeight: 700,
                borderRadius: '6px',
                background: guidedTourActive
                  ? 'linear-gradient(135deg, #10b981, #06b6d4)'
                  : 'linear-gradient(135deg, #6366f1, #06b6d4)',
                color: '#fff',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                boxShadow: '0 2px 6px rgba(99, 102, 241, 0.4)',
              }}
              title="Start guided tour"
            >
              <Compass size={13} />
              <span>{guidedTourActive ? `${currentTourStopIndex + 1}/${tourStops.length}` : 'Start Tour'}</span>
            </button>
            {profile?.role === 'admin' && (
              <button
                onClick={handleToggleBoundaryVisibility}
                className="btn btn-ghost btn-sm"
                style={{
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: `1px solid ${exhibitionSettings.school_boundary_enabled ? '#a855f7' : 'rgba(255,255,255,0.2)'}`,
                  color: exhibitionSettings.school_boundary_enabled ? '#c084fc' : '#94a3b8',
                }}
                title="Toggle boundary on map"
              >
                🏫 {exhibitionSettings.school_boundary_enabled ? 'ON' : 'OFF'}
              </button>
            )}
            <button
              onClick={handleOpenAnnouncements}
              className="btn btn-ghost btn-sm btn-icon"
              style={{ position: 'relative', width: 36, height: 36, padding: 0 }}
              title="Announcements"
            >
              <Bell size={16} />
              {unreadNotifications > 0 && (
                <span style={{ position: 'absolute', top: '3px', right: '3px', width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444' }} />
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
          <Link to="/search" className="btn btn-ghost btn-sm" style={{ flexDirection: 'column', gap: '0.15rem', padding: '0.35rem 0.5rem', fontSize: '0.6rem', minHeight: 'unset' }}>
            <Search size={18} />
            Search
          </Link>
          <Link to="/exhibitions" className="btn btn-ghost btn-sm" style={{ flexDirection: 'column', gap: '0.15rem', padding: '0.35rem 0.5rem', fontSize: '0.6rem', minHeight: 'unset' }}>
            <CalendarDays size={18} />
            Events
          </Link>
          <Link to="/stores" className="btn btn-ghost btn-sm" style={{ flexDirection: 'column', gap: '0.15rem', padding: '0.35rem 0.5rem', fontSize: '0.6rem', minHeight: 'unset' }}>
            <Store size={18} />
            Stores
          </Link>
          {profile?.role === 'admin' && (
            <a href="/admin/" className="btn btn-ghost btn-sm" style={{ flexDirection: 'column', gap: '0.15rem', padding: '0.35rem 0.5rem', fontSize: '0.6rem', color: 'var(--color-warning)', minHeight: 'unset', display: 'inline-flex', alignItems: 'center' }}>
              <Navigation size={18} />
              Admin
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
              userHeading={mockMode ? null : userHeading}
              route={calculatedRoute}
              theme={(mapTheme === '3d' ? 'dark' : mapTheme) as 'dark' | 'streets' | 'light'}
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
              onSelectStore={(storeId) => {
                setSelectedDestinationStoreId(storeId);
                const st = stores.find(s => s.id === storeId);
                if (st) setStoreSearchQuery(st.name);
              }}
            />

          {/* Floating Recenter Location Button */}
          <button
            onClick={handleRecenterLocation}
            className="btn btn-primary map-recenter-btn"
            style={{
              position: 'absolute',
              bottom: navigationActive ? '270px' : '114px',
              right: '16px',
              zIndex: 1000,
              borderRadius: '50%',
              width: '46px',
              height: '46px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
              transition: 'bottom 0.3s ease, right 0.3s ease',
            }}
            title="Recenter Map"
          >
            <Navigation size={18} style={{ transform: 'rotate(45deg)' }} />
          </button>

          {/* Floating Category Legend overlay */}
          <div className="glass map-legend-panel" style={{
            position: 'absolute',
            bottom: navigationActive ? '230px' : '44px',
            left: '16px',
            zIndex: 1000,
            padding: showLegend ? '0.75rem 1rem' : '0.5rem 0.75rem',
            borderRadius: '10px',
            maxWidth: '220px',
            transition: 'bottom 0.3s ease, left 0.3s ease',
          }}>
            {!showLegend ? (
              <button
                onClick={() => setShowLegend(true)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: 0 }}
              >
                <Store size={14} /> Show Legend
              </button>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-muted)', letterSpacing: '0.04em' }}>MAP LEGEND</span>
                  <button
                    onClick={() => setShowLegend(false)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.7rem' }}
                  >
                    Hide
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', display: 'inline-block' }} />
                    <span>User Location</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
                    <span>Navigation Route</span>
                  </div>
                  
                  <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '0.25rem', paddingTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>CATEGORIES</span>
                    
                    {/* Dynamic Exhibitor categories from database */}
                    {mapCategories.length > 0 ? (
                      mapCategories.map((cat) => (
                        <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.725rem' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color || 'var(--color-primary)', display: 'inline-block' }} />
                          <span>{cat.name}</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.725rem' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', display: 'inline-block' }} />
                        <span>General Booths</span>
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.725rem' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', display: 'inline-block' }} />
                      <span>Entrances</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.725rem' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa', display: 'inline-block' }} />
                      <span>Points of Interest</span>
                    </div>
                    {nodes.some((n) => n.type === 'emergency') && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.725rem' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f43f5e', display: 'inline-block' }} />
                        <span>Emergency Exits</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
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
            {/* Mobile Tour Floating Action Pill */}
            <div className="map-mobile-tour-pill" style={{ pointerEvents: 'auto', display: 'none' }}>
              <button
                onClick={handleOpenTourPlanner}
                className="btn btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  padding: '0.45rem 0.95rem',
                  borderRadius: '24px',
                  background: guidedTourActive
                    ? 'linear-gradient(135deg, #10b981, #06b6d4)'
                    : 'linear-gradient(135deg, #6366f1, #06b6d4)',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
                  backdropFilter: 'blur(10px)',
                  cursor: 'pointer',
                }}
              >
                <Compass size={16} />
                <span>{guidedTourActive ? `Stop ${currentTourStopIndex + 1}/${tourStops.length}: Next Stall` : '🧭 Start Tour'}</span>
              </button>
              {guidedTourActive && (
                <button
                  onClick={handleCancelTour}
                  className="btn btn-ghost btn-sm"
                  style={{
                    marginLeft: '0.4rem',
                    padding: '0.4rem 0.65rem',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    background: 'rgba(239, 68, 68, 0.25)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              )}
            </div>

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

          {/* Active Mock Location Top Banner */}
          {mockMode && (
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

          {/* Right Floating Controls Stack (Settings, Tour & Mock GPS) */}
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
            {/* Map Controls (Theme, Guided Tour & Testing Tools) */}
            <div className="glass map-controls-panel" style={{
              width: '100%',
              pointerEvents: 'auto',
              padding: '0.75rem',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem'
            }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--color-muted)', fontWeight: 700, marginBottom: '0.25rem', textTransform: 'uppercase' }}>
                  Map Style
                </label>
                <select
                  className="form-select"
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', width: '100%' }}
                  value={mapTheme}
                  onChange={(e) => setMapTheme(e.target.value as any)}
                >
                  <option value="dark">Dark Matter</option>
                  <option value="streets">OSM Streets</option>
                  <option value="light">Positron Light</option>
                  <option value="3d" style={{ display: 'none' }}>🏙️ 3D Buildings</option>
                </select>
              </div>

              {profile?.role === 'admin' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
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
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--color-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Guided Tour
                </label>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%', fontSize: '0.8rem', padding: '0.35rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                  onClick={handleOpenTourPlanner}
                >
                  <Compass size={14} />
                  {guidedTourActive ? 'Restart Tour' : 'Start Tour'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', color: 'var(--color-accent)', background: 'rgba(34, 211, 238, 0.08)' }}
                  onClick={handleOpenTourPlanner}
                >
                  <CheckSquare size={13} />
                  <span>Visited Tracker ({visitedStallIds.length}/{(stores.filter(s => s.id !== 'kalawana-national-school-landmark').length > 0 ? stores.filter(s => s.id !== 'kalawana-national-school-landmark') : DEFAULT_DEMO_STALLS).length})</span>
                </button>
                {guidedTourActive && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', fontSize: '0.75rem', padding: '0.25rem 0.5rem', color: 'var(--color-danger)' }}
                    onClick={handleCancelTour}
                  >
                    Cancel Tour
                  </button>
                )}
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
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem', justifyContent: 'flex-start' }}
                      onClick={() => handleSelectMockLocation('entrance')}
                    >
                      🚪 Entrance Gate
                    </button>
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


          {/* Bottom Navigation Panel — Google Maps-style draggable bottom sheet */}
          {navigationActive && (
            <div
              ref={sheetRef}
              className={`glass map-nav-panel${navSheetExpanded ? ' map-nav-expanded' : ''}`}
              style={{
                position: 'absolute',
                bottom: '1rem',
                left: '1rem',
                right: '1rem',
                maxHeight: '200px',
                zIndex: 1000,
                borderRadius: 'var(--radius-xl)',
                padding: '1.25rem 1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                overflow: 'hidden',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                transition: 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
                willChange: 'transform',
              }}
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
            >
              {/* Drag handle — visible only on mobile via CSS */}
              <div
                className="nav-sheet-handle"
                onClick={() => setNavSheetExpanded(v => !v)}
                style={{
                  display: 'none', /* shown via CSS on mobile */
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: '0 0 0.25rem',
                  cursor: 'grab',
                  touchAction: 'none',
                }}
              >
                <div style={{
                  width: 40, height: 4, borderRadius: 999,
                  background: 'rgba(255,255,255,0.2)',
                }} />
              </div>

              {/* Summary row — always visible */}
              {guidedTourActive && tourStops.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <div style={{
                        width: 42, height: 42,
                        background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                        borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', flexShrink: 0,
                        boxShadow: '0 4px 12px rgba(168, 85, 247, 0.4)'
                      }}>
                        <Compass size={22} />
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#22d3ee', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            🎪 GUIDED TOUR · STOP {currentTourStopIndex + 1} OF {tourStops.length}
                          </span>
                        </div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: '0.1rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'clamp(140px, 40vw, 240px)' }}>
                          {tourStops[currentTourStopIndex]?.name || 'Next Stall'}
                        </h3>
                        <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: 0 }}>
                          <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{totalDistance} m</span>
                          {' · '}Est: {totalDistance < 80 ? '< 1 min' : `${Math.ceil(totalDistance / 80)} min`} walking
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleMarkCurrentStopVisited}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.35rem 0.65rem',
                          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                          border: 'none',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          boxShadow: '0 2px 8px rgba(34, 197, 94, 0.3)'
                        }}
                      >
                        <Check size={14} />
                        {currentTourStopIndex + 1 < tourStops.length ? 'Next Stall ✓' : 'Finish Tour 🎉'}
                      </button>

                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleCancelTour}
                        style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.75rem', color: 'var(--color-danger)' }}
                      >
                        ✕ End
                      </button>
                    </div>
                  </div>

                  {/* Tour Stops Sequence Progress Pills */}
                  <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.15rem', scrollbarWidth: 'none' }}>
                    {tourStops.map((stop, sIdx) => {
                      const isCurrent = sIdx === currentTourStopIndex;
                      const isPast = sIdx < currentTourStopIndex || visitedStallIds.includes(stop.id);
                      return (
                        <div
                          key={stop.id}
                          style={{
                            padding: '0.2rem 0.5rem',
                            borderRadius: '6px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            background: isCurrent
                              ? 'rgba(34, 211, 238, 0.2)'
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
                            color: isCurrent ? '#22d3ee' : isPast ? '#22c55e' : 'var(--color-muted)'
                          }}
                        >
                          <span>{isPast ? '✓' : sIdx + 1}</span>
                          <span>{stop.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <div style={{ width: 42, height: 42, background: 'rgba(99,102,241,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary-h)', flexShrink: 0 }}>
                      <Route size={20} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'clamp(140px, 40vw, 240px)' }}>
                        {isFarAway
                          ? `🏫 Head to School Entrance`
                          : `Navigating to ${selectedDestinationStoreId
                              ? (stores.find((s) => s.id === selectedDestinationStoreId)?.name || 'Exhibitor')
                              : (nodes.find((n) => n.id === selectedDestinationNodeId)?.label || 'Facility')}`}
                      </h3>
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: 0 }}>
                        <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{totalDistance} m</span>
                        {' · '}Est: {totalDistance < 80 ? '< 1 min' : `${Math.ceil(totalDistance / 80)} min`}
                        {/* GPS accuracy indicator — only shown when real GPS is active */}
                        {!mockMode && gpsAccuracy !== null && (
                          <span style={{
                            marginLeft: '0.5rem',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            padding: '0.05rem 0.4rem',
                            borderRadius: '4px',
                            color: gpsAccuracy <= 5
                              ? '#22c55e'
                              : gpsAccuracy <= 15
                                ? '#eab308'
                                : '#f97316',
                            background: gpsAccuracy <= 5
                              ? 'rgba(34,197,94,0.1)'
                              : gpsAccuracy <= 15
                                ? 'rgba(234,179,8,0.1)'
                                : 'rgba(249,115,22,0.1)',
                            border: `1px solid ${gpsAccuracy <= 5
                              ? 'rgba(34,197,94,0.25)'
                              : gpsAccuracy <= 15
                                ? 'rgba(234,179,8,0.25)'
                                : 'rgba(249,115,22,0.25)'}`,
                          }}>
                            📍 ±{Math.round(gpsAccuracy)} m
                          </span>
                        )}
                      </p>
                      {/* Entrance-snap notice — shown when poor GPS caused fallback */}
                      {snappedToNode && !mockMode && (
                        <p style={{
                          fontSize: '0.72rem',
                          color: '#f97316',
                          margin: '0.2rem 0 0',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                        }}>
                          <span style={{ opacity: 0.8 }}>⚠️</span>
                          Weak GPS — routing from <strong style={{ color: '#fb923c' }}>{snappedToNode}</strong>
                        </p>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
                    {/* Expand/collapse toggle — visible on mobile */}
                    <button
                      className="nav-sheet-toggle"
                      onClick={() => setNavSheetExpanded(v => !v)}
                      style={{
                        display: 'none', /* shown via CSS on mobile */
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '50%',
                        width: 30, height: 30,
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'var(--color-muted)',
                        transition: 'transform 0.3s',
                        transform: navSheetExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                      aria-label={navSheetExpanded ? 'Collapse' : 'Expand'}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </button>

                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setSelectedDestinationStoreId('');
                        setSelectedDestinationNodeId('');
                        setStoreSearchQuery('');
                        setNavSheetExpanded(false);
                      }}
                      style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.8rem' }}
                    >
                      ✕ Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Step guidance — hidden when collapsed, visible when expanded on mobile */}
              <div className="nav-sheet-steps" style={{ overflowY: 'auto', paddingRight: '0.5rem', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
                {guideSteps.map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.85rem' }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: idx === 0 ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, color: idx === 0 ? 'var(--color-accent)' : 'var(--color-muted)' }}>{idx + 1}</span>
                    </div>
                    <span style={{ color: idx === 0 ? 'var(--color-accent)' : 'inherit', fontWeight: idx === 0 ? 600 : 400, lineHeight: 1.4 }}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New Modals for Boundary & Tour check */}
          {isFarAway && exhibitionSettings.school_boundary_enabled !== false && (
            <div style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(11, 15, 26, 0.92)',
              zIndex: 10000,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem',
              textAlign: 'center',
              backdropFilter: 'blur(8px)'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.5rem'
              }}>
                <AlertTriangle size={32} />
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1rem', color: '#fff' }}>Reach to the exhibition premises first</h2>
              <p style={{ color: 'var(--color-muted)', maxWidth: '400px', fontSize: '0.925rem', lineHeight: 1.6, marginBottom: '2rem' }}>
                You are currently outside the exhibition boundaries. Please proceed to the exhibition center to start the map navigation system.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
                {!mockMode && (
                  <button className="btn btn-primary" onClick={() => setMockMode(true)}>
                    Switch to Mock Location
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => { setBypassBoundaryCheck(true); setIsFarAway(false); hasPromptedRef.current = true; }}>
                  Bypass (View Map)
                </button>
              </div>
              {mockMode && (
                <p style={{ color: 'var(--color-accent)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                  Tip: Select a mock start node inside the premises or tap the map to test.
                </p>
              )}
            </div>
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
                    background: 'rgba(34, 211, 238, 0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#22d3ee',
                    flexShrink: 0,
                  }}
                >
                  <Store size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      color: '#22d3ee',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    🎯 Arrived at Stop {currentTourStopIndex + 1} of {tourStops.length}
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
                Have you finished visiting <strong>{arrivedStopPrompt.name}</strong>? Mark as visited to see the route to the next store!
              </p>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.1rem' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1, fontSize: '0.78rem' }}
                  onClick={() => setArrivedStopPrompt(null)}
                >
                  Still Visiting
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  style={{
                    flex: 1.4,
                    fontSize: '0.78rem',
                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                    border: 'none',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    boxShadow: '0 2px 8px rgba(34, 197, 94, 0.35)',
                  }}
                  onClick={() => {
                    handleMarkCurrentStopVisited();
                  }}
                >
                  <Check size={14} />
                  {currentTourStopIndex + 1 < tourStops.length ? 'Visited → Next Stop' : 'Finish Tour 🎉'}
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

          {showChecklistPrompt && (
            <AdminModal
              title="📋 Select Stalls to Visit (Tour Planner)"
              onClose={() => setShowChecklistPrompt(false)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '75vh' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: 0, lineHeight: 1.5 }}>
                  Choose which stalls you want to visit on your guided tour. By default, <strong>ALL stalls are selected</strong> for the shortest optimal path.
                </p>

                {/* Stats & Quick Actions Toolbar */}
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  padding: '0.6rem 0.85rem',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '10px'
                }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem', fontWeight: 700 }}>
                    <span style={{ color: 'var(--color-accent)', background: 'rgba(34, 211, 238, 0.15)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                      🎯 In Tour: {tourSelectedStallIds.length} / {(stores.filter(s => s.id !== 'kalawana-national-school-landmark').length > 0 ? stores.filter(s => s.id !== 'kalawana-national-school-landmark') : DEFAULT_DEMO_STALLS).length}
                    </span>
                    {visitedStallIds.length > 0 && (
                      <span style={{ color: '#22c55e', background: 'rgba(34, 197, 94, 0.12)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                        ✓ Visited: {visitedStallIds.length}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', color: 'var(--color-accent)' }}
                      onClick={() => {
                        const activeList = stores.filter(s => s.id !== 'kalawana-national-school-landmark');
                        const listToUse = activeList.length > 0 ? activeList : DEFAULT_DEMO_STALLS;
                        setTourSelectedStallIds(listToUse.map(s => s.id));
                      }}
                    >
                      Select All
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', color: '#38bdf8' }}
                      onClick={() => {
                        const activeList = stores.filter(s => s.id !== 'kalawana-national-school-landmark');
                        const listToUse = activeList.length > 0 ? activeList : DEFAULT_DEMO_STALLS;
                        setTourSelectedStallIds(listToUse.filter(s => !visitedStallIds.includes(s.id)).map(s => s.id));
                      }}
                    >
                      Unvisited Only
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', color: 'var(--color-warning)' }}
                      onClick={() => setTourSelectedStallIds([])}
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                {/* Stall Search Filter */}
                <input
                  type="text"
                  className="form-input"
                  placeholder="🔍 Search stalls by name or category..."
                  value={checklistSearchQuery}
                  onChange={(e) => setChecklistSearchQuery(e.target.value)}
                  style={{ fontSize: '0.85rem', padding: '0.45rem 0.75rem' }}
                />

                <div style={{
                  flex: 1,
                  overflowY: 'auto',
                  border: '1px solid var(--color-border)',
                  borderRadius: '10px',
                  padding: '0.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  maxHeight: '320px'
                }}>
                  {(stores.filter(s => s.id !== 'kalawana-national-school-landmark').length > 0
                    ? stores.filter(s => s.id !== 'kalawana-national-school-landmark')
                    : DEFAULT_DEMO_STALLS)
                    .filter(s => {
                      if (!checklistSearchQuery.trim()) return true;
                      const q = checklistSearchQuery.toLowerCase();
                      const nameMatch = s.name.toLowerCase().includes(q);
                      const catMatch = s.categories?.name?.toLowerCase().includes(q);
                      return nameMatch || catMatch;
                    })
                    .map((store) => {
                      const isSelected = tourSelectedStallIds.includes(store.id);
                      const isVisited = visitedStallIds.includes(store.id);
                      return (
                        <label
                          key={store.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.65rem 0.85rem',
                            borderRadius: '8px',
                            background: isSelected ? 'rgba(34, 211, 238, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                            cursor: 'pointer',
                            border: `1px solid ${isSelected ? 'rgba(34, 211, 238, 0.25)' : 'rgba(255, 255, 255, 0.06)'}`,
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            style={{ width: 18, height: 18, accentColor: '#22d3ee', cursor: 'pointer' }}
                            onChange={() => {
                              if (isSelected) {
                                setTourSelectedStallIds(tourSelectedStallIds.filter(id => id !== store.id));
                              } else {
                                setTourSelectedStallIds([...tourSelectedStallIds, store.id]);
                              }
                            }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: isSelected ? 'var(--color-text)' : 'var(--color-muted)' }}>
                                {store.name}
                              </span>
                              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                {isVisited && (
                                  <span style={{ fontSize: '0.68rem', color: '#22c55e', fontWeight: 700, background: 'rgba(34, 197, 94, 0.15)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                    ✓ Visited
                                  </span>
                                )}
                                {isSelected ? (
                                  <span style={{ fontSize: '0.68rem', color: '#22d3ee', fontWeight: 700, background: 'rgba(34, 211, 238, 0.15)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                    🎯 In Tour
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)', fontWeight: 600, background: 'rgba(255, 255, 255, 0.05)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                    ⏭️ Excluded
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.15rem', fontSize: '0.72rem', color: 'var(--color-muted)' }}>
                              {store.categories?.name && <span>🏷️ {store.categories.name}</span>}
                              {store.floor && <span>📍 Floor {store.floor}</span>}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                </div>

                {/* Footer Actions */}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setShowChecklistPrompt(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={tourSelectedStallIds.length === 0}
                    onClick={() => {
                      setShowChecklistPrompt(false);
                      generateGuidedTourRoute(tourSelectedStallIds);
                    }}
                  >
                    🚀 Start Shortest Tour ({tourSelectedStallIds.length} Stalls)
                  </button>
                </div>
              </div>
            </AdminModal>
          )}
        </div>
      </div>
    </>
  );
}
