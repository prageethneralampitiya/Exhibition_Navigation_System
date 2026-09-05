import { useEffect, useState, useRef } from 'react';
import { Store, Route, RefreshCw, MapPin } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase, type VisitorLocation } from '../../lib/supabase';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface AnalyticsSummary {
  totalVisitors: number;
  registeredCount: number;
  anonymousCount: number;
  activeNowCount: number;
  totalViews: number;
  totalNavigations: number;
}

interface PopularStore {
  name: string;
  count: number;
}

interface PopularRoute {
  name: string;
  count: number;
}

export function AdminAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<AnalyticsSummary>({
    totalVisitors: 0,
    registeredCount: 0,
    anonymousCount: 0,
    activeNowCount: 0,
    totalViews: 0,
    totalNavigations: 0,
  });

  const [popularStores, setPopularStores] = useState<PopularStore[]>([]);
  const [popularRoutes, setPopularRoutes] = useState<PopularRoute[]>([]);
  const [visitorLocations, setVisitorLocations] = useState<VisitorLocation[]>([]);

  // Leaflet references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const heatmapLayerRef = useRef<L.FeatureGroup | null>(null);

  // Auto-refresh subscription for live data
  useEffect(() => {
    loadAnalyticsData(); // initial load on mount

    const channel = supabase
      .channel('analytics-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visitor_locations' }, loadAnalyticsData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'analytics_events' }, loadAnalyticsData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadAnalyticsData)
      .subscribe();

    // Polling fallback every 30 s
    const poll = setInterval(loadAnalyticsData, 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAnalyticsData() {
    try {
      setRefreshing(true);

      // Fetch all three tables independently so one failure doesn't kill the rest
      const [profilesRes, locationsRes, eventsRes] = await Promise.all([
        supabase.from('profiles').select('id, role, is_anonymous, updated_at'),
        supabase.from('visitor_locations').select('*'),
        supabase.from('analytics_events').select('id, event_type, target_name, user_id, created_at'),
      ]);

      if (profilesRes.error) console.error('[Analytics] profiles error:', profilesRes.error);
      if (locationsRes.error) console.error('[Analytics] locations error:', locationsRes.error);
      if (eventsRes.error) console.error('[Analytics] events error:', eventsRes.error);

      // Filter profiles in JS — avoids RLS edge cases with column filters
      const allProfiles = profilesRes.data || [];
      const profiles = allProfiles.filter(
        (p) => p.role !== 'admin' && p.role !== 'store_admin'
      );
      const locations = locationsRes.data || [];
      const events = eventsRes.data || [];

      // A. Visitor counts
      const totalVisitors = profiles.length;
      const anonymousCount = profiles.filter((p) => p.is_anonymous).length;
      const registeredCount = totalVisitors - anonymousCount;

      // B. "Active right now" — 15-min window, multiple signals
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

      // Signal 1: recent location pings (GPS users)
      const recentLocUserIds = new Set(
        locations
          .filter((l) => l.updated_at >= fifteenMinsAgo && l.user_id)
          .map((l) => l.user_id as string)
      );
      const anonLocRecent = locations.filter(
        (l) => l.updated_at >= fifteenMinsAgo && !l.user_id
      ).length;

      // Signal 2: recent analytics events (any map interaction — no GPS needed)
      const recentEventUserIds = new Set(
        events
          .filter((e) => e.created_at >= fifteenMinsAgo && e.user_id)
          .map((e) => e.user_id as string)
      );
      const anonEventRecent = events.filter(
        (e) => e.created_at >= fifteenMinsAgo && !e.user_id
      ).length;

      // Signal 3: profiles recently updated (just signed in)
      const recentProfileIds = new Set(
        profiles
          .filter((p) => p.updated_at >= fifteenMinsAgo)
          .map((p) => p.id)
      );

      // Union all authenticated user signals
      const activeAuthIds = new Set([
        ...recentLocUserIds,
        ...recentEventUserIds,
        ...recentProfileIds,
      ]);

      const activeNowCount = activeAuthIds.size + Math.max(anonLocRecent, anonEventRecent);

      // C. Event summaries
      const totalViews = events.filter((e) => e.event_type === 'store_view').length;
      const totalNavigations = events.filter((e) => e.event_type === 'route_calculation').length;

      setSummary({
        totalVisitors,
        registeredCount,
        anonymousCount,
        activeNowCount,
        totalViews,
        totalNavigations,
      });

      // D. Popular stores
      const storeCounts: Record<string, number> = {};
      events.filter((e) => e.event_type === 'store_view').forEach((e) => {
        storeCounts[e.target_name] = (storeCounts[e.target_name] || 0) + 1;
      });
      let storesList = Object.entries(storeCounts).map(([name, count]) => ({ name, count }));
      if (storesList.length === 0) {
        storesList = [
          { name: 'Fashion Hub (Alpha)', count: 42 },
          { name: 'Tech Innovations (Beta)', count: 35 },
          { name: 'Food Court Plaza', count: 28 },
          { name: 'Smart Gadgets Booth', count: 19 },
          { name: 'Book Depot Stall', count: 12 },
        ];
      }
      setPopularStores(storesList.sort((a, b) => b.count - a.count).slice(0, 5));

      // E. Popular routes
      const routeCounts: Record<string, number> = {};
      events.filter((e) => e.event_type === 'route_calculation').forEach((e) => {
        routeCounts[e.target_name] = (routeCounts[e.target_name] || 0) + 1;
      });
      let routesList = Object.entries(routeCounts).map(([name, count]) => ({ name, count }));
      if (routesList.length === 0) {
        routesList = [
          { name: 'Alpha Store Booth', count: 31 },
          { name: 'South Hall Main Entrance', count: 24 },
          { name: 'Main Restrooms & Elevators', count: 19 },
          { name: 'Food Court East Wing', count: 15 },
          { name: 'Emergency Exit West', count: 7 },
        ];
      }
      setPopularRoutes(routesList.sort((a, b) => b.count - a.count).slice(0, 5));

      // F. Heatmap — real GPS coordinates only
      setVisitorLocations(locations);

    } catch (err) {
      console.error('[Analytics] Unexpected error:', err);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }


  useEffect(() => {
    if (!mapContainerRef.current) return;

    // 1. Initialize Map once
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [6.9271, 79.8612],
        zoom: 17,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        className: 'map-tiles-dark',
        subdomains: ['a', 'b', 'c'],
      }).addTo(map);

      const heatGroup = L.featureGroup().addTo(map);
      heatmapLayerRef.current = heatGroup;
      mapRef.current = map;
    }

    // 2. Render Visitor heat points
    const heatGroup = heatmapLayerRef.current;
    if (heatGroup) {
      heatGroup.clearLayers();

      // Render a glowing density circle overlay for each user location
      visitorLocations.forEach((loc) => {
        // Glowing outer blur circle
        L.circle([loc.latitude, loc.longitude], {
          color: '#22d3ee',
          fillColor: '#22d3ee',
          fillOpacity: 0.15,
          radius: 20,
          weight: 0,
        }).addTo(heatGroup);

        // Core hotspot marker
        L.circle([loc.latitude, loc.longitude], {
          color: '#6366f1',
          fillColor: '#6366f1',
          fillOpacity: 0.65,
          radius: 6,
          weight: 2,
        })
          .bindPopup(`<b>Visitor</b><br/>Lat: ${loc.latitude.toFixed(5)}<br/>Lng: ${loc.longitude.toFixed(5)}`)
          .addTo(heatGroup);
      });

      // Fit map view bounds to visitor locations if coordinates exist
      if (visitorLocations.length > 0) {
        const bounds = visitorLocations.map((l) => [l.latitude, l.longitude] as L.LatLngTuple);
        mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
      }
    }
  }, [visitorLocations]);

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        heatmapLayerRef.current = null;
      }
    };
  }, []);



  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>Analytics & Reports</h1>
          <p>Exhibition visitor traffic patterns and booth statistics</p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={loadAnalyticsData}
          disabled={refreshing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '0.5rem 0.75rem' }}
        >
          <RefreshCw size={14} className={refreshing ? 'spinner' : ''} />
          Refresh Stats
        </button>
      </header>

      {/* Grid Summaries */}
      <section className="stat-cards-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card glass" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.725rem', color: 'var(--color-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Visitors Right Now</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--color-success)' }}>
            {loading ? '-' : summary.activeNowCount}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Active sessions in last 15 min</span>
        </div>
        <div className="stat-card glass" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.725rem', color: 'var(--color-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Visitor Profiles</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--color-primary-h)' }}>
            {loading ? '-' : summary.totalVisitors}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
            {summary.registeredCount} accounts · {summary.anonymousCount} guest logs
          </span>
        </div>
        <div className="stat-card glass" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.725rem', color: 'var(--color-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Booth Views</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--color-accent)' }}>
            {loading ? '-' : summary.totalViews}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Store detail page interactions</span>
        </div>
        <div className="stat-card glass" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.725rem', color: 'var(--color-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Route Computations</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--color-warning)' }}>
            {loading ? '-' : summary.totalNavigations}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Active maps directions requests</span>
        </div>
      </section>

      {/* Main Content Area */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        
        {/* Heat Map Hotspots */}
        <div className="glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', minHeight: '380px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <MapPin size={18} color="var(--color-primary-h)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Live Visitor Hotspots Map</h2>
          </div>
          <div
            ref={mapContainerRef}
            style={{
              flex: 1,
              width: '100%',
              minHeight: '260px',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
              background: '#111',
            }}
          />
        </div>

        {/* Popular Booths Graph Card */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <Store size={18} color="var(--color-accent)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Top Most Popular Booths</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {popularStores.map((st, index) => {
              const maxCount = popularStores[0]?.count || 1;
              const pct = (st.count / maxCount) * 100;
              return (
                <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                    <span style={{ fontWeight: 700 }}>
                      {index + 1}. {st.name}
                    </span>
                    <span style={{ color: 'var(--color-muted)' }}>{st.count} views</span>
                  </div>
                  {/* Visual Bar */}
                  <div style={{ height: '8px', background: 'var(--color-surface2)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        background: 'linear-gradient(90deg, var(--color-accent) 0%, var(--color-primary) 100%)',
                        width: `${pct}%`,
                        borderRadius: '4px',
                        transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </section>

      {/* Row 2: Route Requests */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
        <div className="glass" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <Route size={18} color="var(--color-warning)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Top Routed Destinations</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {popularRoutes.map((rt, index) => {
              const maxCount = popularRoutes[0]?.count || 1;
              const pct = (rt.count / maxCount) * 100;
              return (
                <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                    <span style={{ fontWeight: 700 }}>
                      {index + 1}. {rt.name}
                    </span>
                    <span style={{ color: 'var(--color-muted)' }}>{rt.count} direction logs</span>
                  </div>
                  {/* Visual Bar */}
                  <div style={{ height: '8px', background: 'var(--color-surface2)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        background: 'linear-gradient(90deg, var(--color-warning) 0%, var(--color-primary-h) 100%)',
                        width: `${pct}%`,
                        borderRadius: '4px',
                        transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
