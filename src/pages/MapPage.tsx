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
import { calculateShortestPath, calculateShortestPathWithSnapping, findClosestNode, getDistance, getHeading, computeGraphPathDistance } from '../utils/dijkstra';
import { DEFAULT_BUILDING_RECTANGLES, contourPathAroundBuildings, type BuildingRectangle } from '../utils/geometry';
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
  const [buildingRectangles] = useState<BuildingRectangle[]>(DEFAULT_BUILDING_RECTANGLES);
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

  // When GPS accuracy is worse than this threshold (metres), we snap the
  // route start to the nearest entrance node instead of trusting raw GPS.
  const GPS_ACCURACY_THRESHOLD = 20;

  // Selected mock starting node (if GPS is disabled)
  const [mockStartNodeId, setMockStartNodeId] = useState('');

  // Destination / Navigation states
  const [selectedDestinationStoreId, setSelectedDestinationStoreId] = useState('');
  const [selectedDestinationNodeId, setSelectedDestinationNodeId] = useState('');
  const [calculatedRoute, setCalculatedRoute] = useState<NavigationNode[]>([]);
  const [totalDistance, setTotalDistance] = useState(0); // in meters
  const [guideSteps, setGuideSteps] = useState<string[]>([]);
  const [navigationActive, setNavigationActive] = useState(false);
  const [mapTheme, setMapTheme] = useState<'dark' | 'streets' | 'light' | '3d'>('light');
  const [showMesh, setShowMesh] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // Settings & Guided Tour states
  const [exhibitionSettings, setExhibitionSettings] = useState({
    entrance_latitude: 6.535472,
    entrance_longitude: 80.401000,
    entrance_threshold_meters: 20.0,
    premises_center_latitude: 6.535472,
    premises_center_longitude: 80.401000,
    premises_radius_meters: 150.0,
  });
  const exhibitionSettingsRef = useRef(exhibitionSettings);
  useEffect(() => {
    exhibitionSettingsRef.current = exhibitionSettings;
  }, [exhibitionSettings]);

  const [isFarAway, setIsFarAway] = useState(false);
  const [isNearEntrance, setIsNearEntrance] = useState(false);
  const [showEntrancePrompt, setShowEntrancePrompt] = useState(false);
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

  const [bypassBoundaryCheck, setBypassBoundaryCheckState] = useState(false);
  const bypassBoundaryCheckRef = useRef(false);

  const setBypassBoundaryCheck = useCallback((val: boolean) => {
    bypassBoundaryCheckRef.current = val;
    setBypassBoundaryCheckState(val);
  }, []);

  // Tracks if the user has been prompted about guided tours on startup
  const hasPromptedRef = useRef(false);

  // Bottom sheet drag state (Google Maps style)
  const [navSheetExpanded, setNavSheetExpanded] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetDragStartY = useRef<number | null>(null);
  const sheetDragDelta = useRef<number>(0);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    sheetDragStartY.current = e.touches[0].clientY;
    sheetDragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
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

  const handleSheetTouchEnd = useCallback(() => {
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

    return () => {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
      filterRef.current.reset();
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
        latitude: 6.535472,
        longitude: 80.401000,
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
      setNodes(navigationNodes);
      setEdges(navigationEdges);

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
            entrance_latitude: parsed.entrance_latitude ?? 6.535472,
            entrance_longitude: parsed.entrance_longitude ?? 80.401000,
            entrance_threshold_meters: parsed.entrance_threshold_meters ?? 20.0,
            premises_center_latitude: parsed.premises_center_latitude ?? 6.535472,
            premises_center_longitude: parsed.premises_center_longitude ?? 80.401000,
            premises_radius_meters: parsed.premises_radius_meters ?? 150.0,
          });
        } catch (jsonErr) {
          console.warn('Error parsing settings JSON:', jsonErr);
        }
      }

      // Set default mock start node selection
      const entrances = navigationNodes.filter((n) => n.type === 'entrance');
      if (entrances.length > 0) {
        setMockStartNodeId(entrances[0].id);
      } else if (navigationNodes.length > 0) {
        setMockStartNodeId(navigationNodes[0].id);
      }

      // Default map center: Kalawana National School (6.535472, 80.401000)
      if (!hasGPSCenteredRef.current) {
        setMapCenterLat(6.535472);
        setMapCenterLng(80.401000);
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
        const distToCenter = getDistance(lat, lng, currentSettings.premises_center_latitude, currentSettings.premises_center_longitude);
        const far = distToCenter > currentSettings.premises_radius_meters;
        
        if (bypassBoundaryCheckRef.current) {
          setIsFarAway(false);
        } else {
          setIsFarAway(far);
        }

        if (!far || bypassBoundaryCheckRef.current) {
          const distToEntrance = getDistance(lat, lng, currentSettings.entrance_latitude, currentSettings.entrance_longitude);
          const near = distToEntrance <= currentSettings.entrance_threshold_meters;
          setIsNearEntrance(near);

          if (!hasPromptedRef.current) {
            hasPromptedRef.current = true;
            if (near) {
              setShowEntrancePrompt(true);
            } else {
              setShowChecklistPrompt(true);
            }
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
        const distToCenter = getDistance(node.latitude, node.longitude, exhibitionSettings.premises_center_latitude, exhibitionSettings.premises_center_longitude);
        const far = distToCenter > exhibitionSettings.premises_radius_meters;
        
        if (bypassBoundaryCheckRef.current) {
          setIsFarAway(false);
        } else {
          setIsFarAway(far);
        }

        if (!far || bypassBoundaryCheckRef.current) {
          const distToEntrance = getDistance(node.latitude, node.longitude, exhibitionSettings.entrance_latitude, exhibitionSettings.entrance_longitude);
          const near = distToEntrance <= exhibitionSettings.entrance_threshold_meters;
          setIsNearEntrance(near);

          if (!hasPromptedRef.current) {
            hasPromptedRef.current = true;
            if (near) {
              setShowEntrancePrompt(true);
            } else {
              setShowChecklistPrompt(true);
            }
          }
        }
      }
    }
  }, [mockMode, mockStartNodeId, nodes, exhibitionSettings, bypassBoundaryCheck]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (mockMode) {
      setUserLat(lat);
      setUserLng(lng);

      // Trigger proximity/guided tour checks for this clicked location
      const distToCenter = getDistance(lat, lng, exhibitionSettings.premises_center_latitude, exhibitionSettings.premises_center_longitude);
      const far = distToCenter > exhibitionSettings.premises_radius_meters;
      
      if (bypassBoundaryCheckRef.current) {
        setIsFarAway(false);
      } else {
        setIsFarAway(far);
      }

      if (!far || bypassBoundaryCheckRef.current) {
        const distToEntrance = getDistance(lat, lng, exhibitionSettings.entrance_latitude, exhibitionSettings.entrance_longitude);
        const near = distToEntrance <= exhibitionSettings.entrance_threshold_meters;
        setIsNearEntrance(near);

        if (!hasPromptedRef.current) {
          hasPromptedRef.current = true;
          if (near) {
            setShowEntrancePrompt(true);
          } else {
            setShowChecklistPrompt(true);
          }
        }
      }
    }
  }, [mockMode, exhibitionSettings, bypassBoundaryCheck]);

  const handleSelectMockLocation = (presetOrNodeId: string) => {
    setMockMode(true);
    setMockStartNodeId(presetOrNodeId);

    if (presetOrNodeId === 'entrance') {
      const lat = exhibitionSettings.entrance_latitude;
      const lng = exhibitionSettings.entrance_longitude;
      setUserLat(lat);
      setUserLng(lng);
      setIsFarAway(false);
      setIsNearEntrance(true);
      setShowEntrancePrompt(true);
    } else if (presetOrNodeId === 'center') {
      const lat = exhibitionSettings.premises_center_latitude;
      const lng = exhibitionSettings.premises_center_longitude;
      setUserLat(lat);
      setUserLng(lng);
      setIsFarAway(false);
      setIsNearEntrance(false);
    } else if (presetOrNodeId === 'outside') {
      const lat = exhibitionSettings.premises_center_latitude + 0.006;
      const lng = exhibitionSettings.premises_center_longitude + 0.006;
      setUserLat(lat);
      setUserLng(lng);
      if (!bypassBoundaryCheckRef.current) {
        setIsFarAway(true);
      }
    } else {
      const node = nodes.find(n => n.id === presetOrNodeId);
      if (node) {
        setUserLat(node.latitude);
        setUserLng(node.longitude);
        const distToCenter = getDistance(node.latitude, node.longitude, exhibitionSettings.premises_center_latitude, exhibitionSettings.premises_center_longitude);
        const far = distToCenter > exhibitionSettings.premises_radius_meters;
        
        if (bypassBoundaryCheckRef.current) {
          setIsFarAway(false);
        } else {
          setIsFarAway(far);
        }

        if (!far || bypassBoundaryCheckRef.current) {
          const distToEntrance = getDistance(node.latitude, node.longitude, exhibitionSettings.entrance_latitude, exhibitionSettings.entrance_longitude);
          const near = distToEntrance <= exhibitionSettings.entrance_threshold_meters;
          setIsNearEntrance(near);
        }
      }
    }
  };

  const generateGuidedTourRoute = (skipIds: string[]) => {
    // 1. Determine starting point coordinates
    let startLatVal = userLat;
    let startLngVal = userLng;

    if (mockMode) {
      const startNode = nodes.find(n => n.id === mockStartNodeId);
      if (startNode) {
        startLatVal = startNode.latitude;
        startLngVal = startNode.longitude;
      }
    }

    if (startLatVal === null || startLngVal === null) {
      alert('Location not available. Enable GPS or select a mock start node.');
      return;
    }

    // 2. Filter unvisited stores (fallback to demo stalls if database is empty)
    const realStores = stores.filter(s => s.id !== 'kalawana-national-school-landmark');
    const availableStalls = realStores.length > 0 ? realStores : DEFAULT_DEMO_STALLS;
    const targetStores = availableStalls.filter(s => !skipIds.includes(s.id));

    if (targetStores.length === 0) {
      alert('All stalls have been visited!');
      return;
    }

    setLoading(true);
    
    // 3. Graph-aware Nearest Neighbor TSP Algorithm using network node distances
    let currentNodeId: string | null = null;
    const startNode = findClosestNode(startLatVal, startLngVal, nodes);
    if (startNode) {
      currentNodeId = startNode.id;
    }
    let currentLat = startLatVal;
    let currentLng = startLngVal;

    const remaining = [...targetStores];
    const sequencedRouteNodes: NavigationNode[] = [];
    
    while (remaining.length > 0) {
      let bestIndex = 0;
      let minDistance = Infinity;
      
      for (let i = 0; i < remaining.length; i++) {
        const store = remaining[i];
        if (store.latitude !== null && store.longitude !== null) {
          let targetNode = nodes.find(n => n.store_id === store.id);
          if (!targetNode) {
            targetNode = findClosestNode(store.latitude, store.longitude, nodes) || undefined;
          }

          let d = Infinity;
          if (currentNodeId && targetNode) {
            d = computeGraphPathDistance(currentNodeId, targetNode.id, nodes, edges);
          }
          if (d === Infinity || isNaN(d)) {
            d = getDistance(currentLat, currentLng, store.latitude, store.longitude);
          }

          if (d < minDistance) {
            minDistance = d;
            bestIndex = i;
          }
        }
      }
      
      const nextStore = remaining[bestIndex];
      remaining.splice(bestIndex, 1);
      
      let targetNode = nodes.find(n => n.store_id === nextStore.id);
      if (!targetNode) {
        let closestNode = null;
        let minNodeDist = Infinity;
        for (const node of nodes) {
          const d = getDistance(nextStore.latitude!, nextStore.longitude!, node.latitude, node.longitude);
          if (d < minNodeDist) {
            minNodeDist = d;
            closestNode = node;
          }
        }
        targetNode = closestNode || undefined;
      }

      if (targetNode) {
        const path = calculateShortestPathWithSnapping(
          currentLat,
          currentLng,
          targetNode.latitude,
          targetNode.longitude,
          targetNode.id,
          nodes,
          edges,
          gpsAccuracy,
          GPS_ACCURACY_THRESHOLD,
          buildingRectangles
        );
        
        if (path && path.length > 0) {
          if (sequencedRouteNodes.length > 0 && path[0].id === sequencedRouteNodes[sequencedRouteNodes.length - 1].id) {
            sequencedRouteNodes.push(...path.slice(1));
          } else {
            sequencedRouteNodes.push(...path);
          }
        }
        currentNodeId = targetNode.id;
        currentLat = targetNode.latitude;
        currentLng = targetNode.longitude;
      }
    }

    setLoading(false);

    if (sequencedRouteNodes.length > 0) {
      setCalculatedRoute(sequencedRouteNodes);
      setGuidedTourActive(true);
      setNavigationActive(true);
      setNavSheetExpanded(true);
      
      const steps = [`Start Guided Tour visiting ${targetStores.length} stalls.`];
      let cumulativeDist = 0;
      for (let i = 0; i < sequencedRouteNodes.length - 1; i++) {
        const from = sequencedRouteNodes[i];
        const to = sequencedRouteNodes[i + 1];
        cumulativeDist += getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
      }
      steps.push(`Optimized path covers approximately ${Math.round(cumulativeDist)} meters.`);
      steps.push(`Follow the dotted cyan path line to visit each stall.`);
      
      setTotalDistance(Math.round(cumulativeDist));
      setGuideSteps(steps);
    } else {
      alert('Could not compute routing path. Please check the network graph connection edges.');
    }
  };

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
  }, [searchParams, stores, nodes]);

  // Main pathfinder computation trigger
  useEffect(() => {
    if (selectedDestinationStoreId || selectedDestinationNodeId) {
      calculateRoutePath();
    } else {
      setCalculatedRoute([]);
      setTotalDistance(0);
      setGuideSteps([]);
      setNavigationActive(false);
      lastLoggedDestinationRef.current = '';
    }
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
      targetLat = destinationStore.latitude;
      targetLng = destinationStore.longitude;
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

    if (userLat !== null && userLng !== null && !mockMode) {
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

    // 3. Tier 1: Try OpenStreetMap OSRM Outdoor Road Navigation (for outdoor street paths)
    const osrmResult = await fetchOSRMRoute(startLat, startLng, targetLat, targetLng, startLabel, targetLabel);
    if (osrmResult && osrmResult.nodes.length > 1) {
      const contouredOSRM = contourPathAroundBuildings(osrmResult.nodes, buildingRectangles);
      setCalculatedRoute(contouredOSRM);
      setTotalDistance(osrmResult.totalDistanceMeters);
      setGuideSteps(osrmResult.guideSteps);
      setNavigationActive(true);
      return;
    }

    // 4. Tier 2: Custom Dijkstra Graph Navigation (with Building Rectangle Avoidance)
    let path: NavigationNode[] = [];
    if (nodes.length > 0) {
      const connectedNodeIds = new Set<string>();
      edges.forEach((edge) => {
        connectedNodeIds.add(edge.from_node_id);
        connectedNodeIds.add(edge.to_node_id);
      });
      const connectedNodes = nodes.filter((n) => connectedNodeIds.has(n.id) || n.type === 'entrance');
      const searchNodesList = connectedNodes.length > 0 ? connectedNodes : nodes;
      const entranceNodes = nodes.filter((n) => n.type === 'entrance');

      let endNode = selectedDestinationStoreId
        ? (nodes.find((n) => n.store_id === selectedDestinationStoreId) || findClosestNode(targetLat, targetLng, searchNodesList))
        : nodes.find((n) => n.id === selectedDestinationNodeId);

      if (endNode) {
        if (userLat !== null && userLng !== null && !mockMode) {
          const poorGps = gpsAccuracy !== null && gpsAccuracy > GPS_ACCURACY_THRESHOLD;
          if (poorGps && entranceNodes.length > 0) {
            const nearestEntrance = findClosestNode(userLat, userLng, entranceNodes);
            setSnappedToNode(nearestEntrance?.label ?? null);
          } else {
            setSnappedToNode(null);
          }

          path = calculateShortestPathWithSnapping(
            userLat,
            userLng,
            targetLat,
            targetLng,
            endNode.id,
            nodes,
            edges,
            gpsAccuracy,
            GPS_ACCURACY_THRESHOLD,
            buildingRectangles
          );
        } else {
          let startNode = mockStartNodeId ? nodes.find((n) => n.id === mockStartNodeId) : undefined;
          if (!startNode) {
            startNode = entranceNodes.length > 0 ? entranceNodes[0] : nodes[0];
            setSnappedToNode(startNode?.label ?? null);
          } else {
            setSnappedToNode(null);
          }

          if (startNode) {
            path = calculateShortestPath(startNode.id, endNode.id, nodes, edges, buildingRectangles);
          }
        }
      }
    }

    // Virtual endpoints
    const userStartVirtualNode: NavigationNode = {
      id: 'actual-start-virtual',
      label: startLabel,
      latitude: startLat,
      longitude: startLng,
      floor: path[0]?.floor || null,
      type: 'poi',
      store_id: null,
      created_at: new Date().toISOString()
    };

    const destEndVirtualNode: NavigationNode = {
      id: 'actual-end-virtual',
      label: targetLabel,
      latitude: targetLat,
      longitude: targetLng,
      floor: path[path.length - 1]?.floor || null,
      type: 'store',
      store_id: null,
      created_at: new Date().toISOString()
    };

    let finalRoute = [...path];
    if (path.length > 0) {
      const startDist = getDistance(startLat, startLng, path[0].latitude, path[0].longitude);
      const endDist = getDistance(path[path.length - 1].latitude, path[path.length - 1].longitude, targetLat, targetLng);

      if (startDist > 2) {
        finalRoute.unshift(userStartVirtualNode);
      }
      if (endDist > 2) {
        finalRoute.push(destEndVirtualNode);
      }
    }

    // Apply building perimeter contouring (auto-narrowing path around building rectangles)
    let contouredRoute = contourPathAroundBuildings(finalRoute, buildingRectangles);

    // Fallback to direct path with perimeter contouring if graph produced no route
    if (contouredRoute.length === 0) {
      contouredRoute = contourPathAroundBuildings([userStartVirtualNode, destEndVirtualNode], buildingRectangles);
    }

    setCalculatedRoute(contouredRoute);
    setNavigationActive(true);

    if (contouredRoute.length > 1) {
      let distanceMeters = 0;
      const steps: string[] = [];

      for (let i = 0; i < contouredRoute.length - 1; i++) {
        const from = contouredRoute[i];
        const to = contouredRoute[i + 1];
        const segmentDist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
        distanceMeters += segmentDist;

        if (i === 0) {
          steps.push(`Start from ${from.label}`);
        }

        const heading = getHeading(from.latitude, from.longitude, to.latitude, to.longitude);
        if (to.id.startsWith('contour-node')) {
          steps.push(`Skirt around building perimeter (${heading}) for ${Math.round(segmentDist)}m`);
        } else {
          steps.push(`Head ${heading} towards ${to.label} (${Math.round(segmentDist)}m)`);
        }
      }

      steps.push(`Arrive at ${targetLabel}`);
      setTotalDistance(Math.round(distanceMeters));
      setGuideSteps(steps);
    }
  }


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
      <div className="home-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column', gap: 0, padding: 0 }}>
        
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
            <Link
              to="/map3d"
              className="btn btn-sm"
              style={{
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
              <a href="/admin/" className="btn btn-ghost btn-sm" style={{ padding: '0.35rem 0.65rem', border: '1px dashed var(--color-warning)', color: 'var(--color-warning)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                Admin
              </a>
            )}
          </div>

          {/* Mobile-only: bell icon inline */}
          <div className="map-topbar-mobile-icons" style={{ display: 'none', gap: '0.35rem', alignItems: 'center', flexShrink: 0 }}>
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
          position: 'absolute',
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
          {mapTheme === '3d' ? (
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
            />
          ) : (
            <MapView
              latitude={mapCenterLat}
              longitude={mapCenterLng}
              stores={stores}
              userLat={userLat}
              userLng={userLng}
              userHeading={mockMode ? null : userHeading}
              route={calculatedRoute}
              theme={mapTheme as 'dark' | 'streets' | 'light'}
              showGraphMesh={showMesh}
              nodes={nodes}
              edges={edges}
              onMapClick={handleMapClick}
            />
          )}

          {/* Floating Recenter Location Button */}
          <button
            onClick={handleRecenterLocation}
            className="btn btn-primary map-recenter-btn"
            style={{
              position: 'absolute',
              bottom: navigationActive ? '230px' : '20px',
              right: '20px',
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
            bottom: navigationActive ? '230px' : '20px',
            left: '20px',
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

          {/* Floating Search Panel */}
          <div className="map-search-panel" style={{
            position: 'absolute',
            top: '4.85rem',
            left: '1rem',
            width: '320px',
            maxHeight: '350px',
            zIndex: 999,
            display: 'flex',
            flexDirection: 'column',
          }}>
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

          {/* Map Controls (Theme & Admin Graph Mesh toggle) */}
          <div className="glass map-controls-panel" style={{
            position: 'absolute',
            top: '4.85rem',
            right: '1rem',
            width: '200px',
            zIndex: 999,
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
                <option value="3d">🏙️ 3D Buildings</option>
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
                onClick={() => {
                  if (isNearEntrance) {
                    setShowEntrancePrompt(true);
                  } else {
                    setShowChecklistPrompt(true);
                  }
                }}
              >
                <Compass size={14} />
                {guidedTourActive ? 'Restart Tour' : 'Start Tour'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', color: 'var(--color-accent)', background: 'rgba(34, 211, 238, 0.08)' }}
                onClick={() => setShowChecklistPrompt(true)}
              >
                <CheckSquare size={13} />
                <span>Visited Tracker ({visitedStallIds.length}/{stores.filter(s => s.id !== 'kalawana-national-school-landmark').length})</span>
              </button>
              {guidedTourActive && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', fontSize: '0.75rem', padding: '0.25rem 0.5rem', color: 'var(--color-danger)' }}
                  onClick={() => {
                    setCalculatedRoute([]);
                    setGuidedTourActive(false);
                    setNavigationActive(false);
                  }}
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
                onClick={() => setMockMode(prev => !prev)}
              >
                <Navigation size={13} />
                <span>{mockMode ? '📍 Mock Location ON' : '🎯 Enable Mock GPS'}</span>
              </button>
            </div>
          </div>

          {/* Active Mock Location Top Banner */}
          {mockMode && (
            <div className="glass" style={{
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
              backdropFilter: 'blur(10px)'
            }}>
              <span>📍 Mock Location Mode Active — Tap map to set location</span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem', color: '#fff', background: 'rgba(255,255,255,0.12)', borderRadius: '12px' }}
                onClick={() => setMockMode(false)}
              >
                Use Real GPS
              </button>
            </div>
          )}

          {/* Interactive Mock Location Control Panel */}
          {mockMode && (
            <div className="glass map-mock-panel" style={{
              position: 'absolute',
              top: profile?.role === 'admin' ? '18rem' : '15rem',
              right: '1rem',
              width: '220px',
              zIndex: 999,
              padding: '0.85rem',
              borderRadius: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              background: 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(12px)'
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

          {/* Boundary Check Bypassed Badge */}
          {bypassBoundaryCheck && (
            <div className="glass" style={{
              position: 'absolute',
              top: profile?.role === 'admin' ? '12.25rem' : '9.5rem',
              left: '1rem',
              zIndex: 999,
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
              backdropFilter: 'blur(8px)'
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div style={{ width: 42, height: 42, background: 'rgba(99,102,241,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary-h)', flexShrink: 0 }}>
                    <Route size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'clamp(140px, 40vw, 240px)' }}>
                      Navigating to {selectedDestinationStoreId
                        ? (stores.find((s) => s.id === selectedDestinationStoreId)?.name || 'Exhibitor')
                        : (nodes.find((n) => n.id === selectedDestinationNodeId)?.label || 'Facility')}
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
          {isFarAway && (
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

          {showEntrancePrompt && (
            <AdminModal
              title="🎪 Welcome to the Exhibition Entrance!"
              onClose={() => setShowEntrancePrompt(false)}
            >
              <div style={{ padding: '0.5rem 0' }}>
                <div style={{
                  background: 'rgba(34, 211, 238, 0.1)',
                  border: '1px solid rgba(34, 211, 238, 0.25)',
                  borderRadius: '10px',
                  padding: '1rem',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'flex-start'
                }}>
                  <Compass className="text-accent" size={24} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-accent)' }}>
                      Entrance Gate Detected
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
                      Welcome! You are starting at the entrance gate. By default, your tour is configured to visit <strong>ALL exhibition stalls</strong> in the shortest walking path. You can start right away or choose specific stalls to visit.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setShowEntrancePrompt(false);
                      // Default for entrance selector: ALL stalls selected to visit (0 skipped)
                      setVisitedStallIds([]);
                      setShowChecklistPrompt(true);
                    }}
                  >
                    📋 Select Stalls to Visit
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setShowEntrancePrompt(false);
                      setVisitedStallIds([]);
                      generateGuidedTourRoute([]);
                    }}
                  >
                    🚀 Start Full Tour (All Stalls)
                  </button>
                </div>
              </div>
            </AdminModal>
          )}

          {showChecklistPrompt && (
            <AdminModal
              title="📋 Select Stalls to Visit (Tour Planner)"
              onClose={() => setShowChecklistPrompt(false)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '75vh' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: 0, lineHeight: 1.5 }}>
                  Select which stalls you want to visit on your tour. By default, <strong>ALL stalls are selected to visit</strong>. Uncheck any stalls you wish to skip.
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
                      🎯 To Visit: {(stores.filter(s => s.id !== 'kalawana-national-school-landmark').length > 0 ? stores.filter(s => s.id !== 'kalawana-national-school-landmark') : DEFAULT_DEMO_STALLS).filter(s => !visitedStallIds.includes(s.id)).length} / {(stores.filter(s => s.id !== 'kalawana-national-school-landmark').length > 0 ? stores.filter(s => s.id !== 'kalawana-national-school-landmark') : DEFAULT_DEMO_STALLS).length}
                    </span>
                    {visitedStallIds.length > 0 && (
                      <span style={{ color: 'var(--color-muted)', background: 'rgba(255, 255, 255, 0.06)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                        ⏭️ Skipped: {visitedStallIds.length}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', color: 'var(--color-accent)' }}
                      onClick={() => setVisitedStallIds([])}
                    >
                      Select All (Visit All)
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', color: 'var(--color-warning)' }}
                      onClick={() => {
                        const activeList = stores.filter(s => s.id !== 'kalawana-national-school-landmark');
                        const listToUse = activeList.length > 0 ? activeList : DEFAULT_DEMO_STALLS;
                        setVisitedStallIds(listToUse.map(s => s.id));
                      }}
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

                {/* Scrollable Stall Checklist */}
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
                      const isSkipped = visitedStallIds.includes(store.id);
                      const isSelectedToVisit = !isSkipped;
                      return (
                        <label
                          key={store.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.65rem 0.85rem',
                            borderRadius: '8px',
                            background: isSelectedToVisit ? 'rgba(34, 211, 238, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                            cursor: 'pointer',
                            border: `1px solid ${isSelectedToVisit ? 'rgba(34, 211, 238, 0.25)' : 'rgba(255, 255, 255, 0.06)'}`,
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelectedToVisit}
                            style={{ width: 18, height: 18, accentColor: '#22d3ee', cursor: 'pointer' }}
                            onChange={() => {
                              if (isSelectedToVisit) {
                                setVisitedStallIds([...visitedStallIds, store.id]);
                              } else {
                                setVisitedStallIds(visitedStallIds.filter(id => id !== store.id));
                              }
                            }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: isSelectedToVisit ? 'var(--color-text)' : 'var(--color-muted)', textDecoration: isSelectedToVisit ? 'none' : 'line-through' }}>
                                {store.name}
                              </span>
                              {isSelectedToVisit ? (
                                <span style={{ fontSize: '0.7rem', color: '#22d3ee', fontWeight: 700, background: 'rgba(34, 211, 238, 0.15)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                  🎯 To Visit ✓
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', fontWeight: 600, background: 'rgba(255, 255, 255, 0.05)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                  ⏭️ Skipped
                                </span>
                              )}
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
                    onClick={() => {
                      setShowChecklistPrompt(false);
                      generateGuidedTourRoute(visitedStallIds);
                    }}
                  >
                    🚀 Start Shortest Tour ({(stores.filter(s => s.id !== 'kalawana-national-school-landmark').length > 0 ? stores.filter(s => s.id !== 'kalawana-national-school-landmark') : DEFAULT_DEMO_STALLS).filter(s => !visitedStallIds.includes(s.id)).length} Stalls)
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
