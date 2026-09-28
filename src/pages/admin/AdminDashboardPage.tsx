import { useEffect, useState } from 'react';
import { CalendarDays, Store, Megaphone, Users, Activity, Settings, ShieldCheck, ShieldAlert, CheckCircle2, Radio, DoorOpen, UserCheck, Globe } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { StatCard } from '../../components/admin/StatCard';
import { fetchLiveCounterConfig, saveLiveCounterConfig } from '../../services/appSettingsService';
import { useRealtimeOnlineCount } from '../../services/presenceService';
import { useVisitorStats } from '../../services/visitorStatsService';

interface DashboardStats {
  registeredCount: number;
  anonymousCount: number;
  exhibitionsCount: number;
  storesCount: number;
  announcementsCount: number;
}

interface ActivityItem {
  id: string;
  type: 'visitor_location' | 'announcement';
  title: string;
  subtitle: string;
  time: string;
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    registeredCount: 0,
    anonymousCount: 0,
    exhibitionsCount: 0,
    storesCount: 0,
    announcementsCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  // Settings states
  const [entranceLat, setEntranceLat] = useState('6.535472');
  const [entranceLng, setEntranceLng] = useState('80.401000');
  const [entranceThreshold, setEntranceThreshold] = useState('20');
  
  // Designated Exit Gate states (Single exit gate for all visitor tours)
  const [exitGateNodeId, setExitGateNodeId] = useState<string>('');
  const [exitLat, setExitLat] = useState('6.53586');
  const [exitLng, setExitLng] = useState('80.40035');
  const [exitGateLabel, setExitGateLabel] = useState('Main Exit Gate');
  const [availableNodes, setAvailableNodes] = useState<Array<{ id: string; label: string; floor?: string; type?: string; latitude: number; longitude: number }>>([]);

  const [premisesLat, setPremisesLat] = useState('6.535472');
  const [premisesLng, setPremisesLng] = useState('80.401000');
  const [premisesRadius, setPremisesRadius] = useState('150');
  const [schoolBoundaryEnabled, setSchoolBoundaryEnabled] = useState(true);
  const [allowBoundaryBypass, setAllowBoundaryBypass] = useState(true);
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  
  // Real-time online users on website (via Supabase Realtime Presence)
  const { realtimeCount } = useRealtimeOnlineCount();
  
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Live counter time-slot settings
  interface SlotRow { id: string; label: string; start_time: string; end_time: string; count: string; interval: string; }
  const [liveSlots, setLiveSlots] = useState<SlotRow[]>([
    { id: 'slot-1', label: 'Morning Opening',  start_time: '09:00', end_time: '11:00', count: '80',  interval: '30' },
    { id: 'slot-2', label: 'Late Morning',      start_time: '11:00', end_time: '13:00', count: '200', interval: '20' },
    { id: 'slot-3', label: 'Afternoon Peak',    start_time: '13:00', end_time: '16:00', count: '260', interval: '15' },
    { id: 'slot-4', label: 'Late Afternoon',    start_time: '16:00', end_time: '19:00', count: '190', interval: '20' },
    { id: 'slot-5', label: 'Evening Wind-down', start_time: '19:00', end_time: '21:00', count: '110', interval: '30' },
  ]);
  const [liveOutsideCount, setLiveOutsideCount] = useState('0');
  const [liveCounterSaving, setLiveCounterSaving] = useState(false);

  // Total App Users (Full count of the day & All-time total users)
  const { stats: visitorStats, loading: visitorStatsLoading, saveStats: saveVisitorStatsData } = useVisitorStats();
  const [dayUserCountInput, setDayUserCountInput] = useState<string>('');
  const [allTimeUserCountInput, setAllTimeUserCountInput] = useState<string>('');
  const [visitorStatsSaving, setVisitorStatsSaving] = useState(false);

  useEffect(() => {
    if (visitorStats) {
      setDayUserCountInput(String(visitorStats.today_count));
      setAllTimeUserCountInput(String(visitorStats.all_time_count));
    }
  }, [visitorStats.today_count, visitorStats.all_time_count]);

  const handleSaveVisitorStats = async (e: React.FormEvent) => {
    e.preventDefault();
    setVisitorStatsSaving(true);
    try {
      const todayCount = Math.max(0, parseInt(dayUserCountInput, 10) || 0);
      const allTimeCount = Math.max(0, parseInt(allTimeUserCountInput, 10) || 0);
      await saveVisitorStatsData({
        today_date: visitorStats.today_date,
        today_count: todayCount,
        all_time_count: allTimeCount,
      });
      setToastMessage('Total user counts saved successfully! Full day count and all-time total updated.');
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      console.error('Error saving visitor stats:', err);
      alert('Failed to save visitor counts.');
    } finally {
      setVisitorStatsSaving(false);
    }
  };

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setLoading(true);
        
        // 1. Run anonymous user cleanup (older than 1 hour)
        try {
          await supabase.rpc('delete_expired_anonymous_profiles');
        } catch (rpcErr) {
          console.warn('Postgres function delete_expired_anonymous_profiles not installed yet. Make sure you run database/cleanup_anonymous_profiles.sql:', rpcErr);
        }

        // 2. Fetch counts separately
        const [registeredRes, anonymousRes, exhibitionsRes, storesRes, announcementsRes] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_anonymous', false),
          supabase.from('visitor_locations').select('id', { count: 'exact', head: true }).is('user_id', null),
          supabase.from('exhibitions').select('id', { count: 'exact', head: true }),
          supabase.from('stores').select('id', { count: 'exact', head: true }),
          supabase.from('announcements').select('id', { count: 'exact', head: true }).in('type', ['info', 'warning', 'emergency']),
        ]);

        const registeredCount = registeredRes.count ?? 0;
        const anonymousCount = anonymousRes.count ?? 0;
        const exhibitionsCount = exhibitionsRes.count ?? 0;
        const storesCount = storesRes.count ?? 0;
        const announcementsCount = announcementsRes.count ?? 0;

        setStats({
          registeredCount,
          anonymousCount,
          exhibitionsCount,
          storesCount,
          announcementsCount,
        });

        // 3. Fetch recent activity (e.g. latest active announcements, latest visitor registrations, and latest anonymous guest sessions)
        // 4. Fetch existing settings & navigation nodes
        const [settingsRes, nodesRes] = await Promise.all([
          supabase
            .from('announcements')
            .select('*')
            .eq('type', 'settings')
            .limit(1),
          supabase
            .from('navigation_nodes')
            .select('id, label, floor, type, latitude, longitude')
            .order('label'),
        ]);

        if (nodesRes.data) {
          setAvailableNodes(nodesRes.data);
        }

        if (settingsRes.data && settingsRes.data.length > 0) {
          const s = settingsRes.data[0];
          setSettingsId(s.id);
          try {
            const parsed = JSON.parse(s.message);
            setEntranceLat(String(parsed.entrance_latitude ?? '6.53586'));
            setEntranceLng(String(parsed.entrance_longitude ?? '80.40035'));
            setEntranceThreshold(String(parsed.entrance_threshold_meters ?? '20'));
            
            setExitGateNodeId(parsed.exit_gate_node_id || '');
            setExitLat(String(parsed.exit_latitude ?? parsed.entrance_latitude ?? '6.53586'));
            setExitLng(String(parsed.exit_longitude ?? parsed.entrance_longitude ?? '80.40035'));
            setExitGateLabel(parsed.exit_gate_label || 'Main Exit Gate');

            setPremisesLat(String(parsed.premises_center_latitude ?? '6.535472'));
            setPremisesLng(String(parsed.premises_center_longitude ?? '80.401000'));
            setPremisesRadius(String(parsed.premises_radius_meters ?? '150'));
            setSchoolBoundaryEnabled(parsed.school_boundary_enabled !== false);
            setAllowBoundaryBypass(parsed.allow_boundary_bypass !== false);
            setGoogleMapsUrl(parsed.google_maps_url || '');
          } catch (e) {
            console.error('Error parsing settings:', e);
          }
        }

        // Load live counter config
        const liveConfig = await fetchLiveCounterConfig();
        setLiveOutsideCount(String(liveConfig.outside_hours_count ?? 0));
        if (liveConfig.time_slots && liveConfig.time_slots.length > 0) {
          setLiveSlots(liveConfig.time_slots.map((s) => ({
            id: s.id,
            label: s.label,
            start_time: `${String(s.start_hour).padStart(2,'0')}:${String(s.start_minute).padStart(2,'0')}`,
            end_time:   `${String(s.end_hour).padStart(2,'0')}:${String(s.end_minute).padStart(2,'0')}`,
            count:    String(s.initial_visitor_count),
            interval: String(s.fluctuation_interval_sec),
          })));
        }

        // Auto-upgrade any legacy 18:00 or missing stall hours to 09:00 - 21:00 (9:00 PM) in database
        try {
          await supabase
            .from('stores')
            .update({
              opening_time: '09:00:00',
              closing_time: '21:00:00',
              updated_at: new Date().toISOString(),
            })
            .or('closing_time.eq.18:00:00,closing_time.is.null');
        } catch {
          // ignore
        }

        const [recentAnnouncements, recentProfiles, recentVisitorLocations] = await Promise.all([
          supabase
            .from('announcements')
            .select('id, title, created_at')
            .in('type', ['info', 'warning', 'emergency'])
            .order('created_at', { ascending: false })
            .limit(5),
          supabase
            .from('profiles')
            .select('id, name, created_at')
            .eq('is_anonymous', false)
            .order('created_at', { ascending: false })
            .limit(5),
          supabase
            .from('visitor_locations')
            .select('id, session_id, updated_at')
            .is('user_id', null)
            .order('updated_at', { ascending: false })
            .limit(5),
        ]);

        interface RawActivityItem {
          id: string;
          type: 'visitor_location' | 'announcement';
          title: string;
          subtitle: string;
          timestamp: number;
        }

        const rawItems: RawActivityItem[] = [];

        if (recentAnnouncements.data) {
          recentAnnouncements.data.forEach((ann) => {
            rawItems.push({
              id: ann.id,
              type: 'announcement',
              title: `Announcement: ${ann.title}`,
              subtitle: 'New alert published',
              timestamp: new Date(ann.created_at).getTime(),
            });
          });
        }

        if (recentProfiles.data) {
          recentProfiles.data.forEach((prof) => {
            rawItems.push({
              id: prof.id,
              type: 'visitor_location',
              title: prof.name || 'Visitor',
              subtitle: 'Registered new account',
              timestamp: new Date(prof.created_at).getTime(),
            });
          });
        }

        if (recentVisitorLocations.data) {
          recentVisitorLocations.data.forEach((loc) => {
            rawItems.push({
              id: loc.id,
              type: 'visitor_location',
              title: `Visitor (${loc.session_id ? loc.session_id.substring(0, 8) : 'Anonymous'})`,
              subtitle: 'Guest joined session',
              timestamp: new Date(loc.updated_at).getTime(),
            });
          });
        }

        // Sort items by time descending and format for display
        const sortedItems: ActivityItem[] = rawItems
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 8)
          .map((item) => ({
            id: item.id,
            type: item.type,
            title: item.title,
            subtitle: item.subtitle,
            time: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }));

        setActivities(sortedItems);
      } catch (err) {
        console.error('Error loading dashboard stats:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  const handleSelectExitNode = (nodeId: string) => {
    setExitGateNodeId(nodeId);
    if (!nodeId) return;
    const node = availableNodes.find((n) => n.id === nodeId);
    if (node) {
      setExitLat(String(node.latitude));
      setExitLng(String(node.longitude));
      if (!exitGateLabel || exitGateLabel === 'Main Exit Gate') {
        setExitGateLabel(node.label);
      }
    }
  };

  const handleQuickToggleBoundary = async (enabled: boolean) => {
    setSchoolBoundaryEnabled(enabled);
    setSettingsSaving(true);
    try {
      const payload = {
        entrance_latitude: parseFloat(entranceLat) || 6.53586,
        entrance_longitude: parseFloat(entranceLng) || 80.40035,
        entrance_threshold_meters: parseFloat(entranceThreshold) || 20,
        exit_gate_node_id: exitGateNodeId || null,
        exit_latitude: parseFloat(exitLat) || parseFloat(entranceLat) || 6.53586,
        exit_longitude: parseFloat(exitLng) || parseFloat(entranceLng) || 80.40035,
        exit_gate_label: exitGateLabel.trim() || 'Main Exit Gate',
        premises_center_latitude: parseFloat(premisesLat) || 6.535472,
        premises_center_longitude: parseFloat(premisesLng) || 80.401000,
        premises_radius_meters: parseFloat(premisesRadius) || 150,
        school_boundary_enabled: enabled,
        show_school_boundary: enabled,
        allow_boundary_bypass: allowBoundaryBypass,
        google_maps_url: googleMapsUrl.trim(),
      };

      const announcementPayload = {
        title: 'System Exhibition Settings',
        message: JSON.stringify(payload),
        type: 'settings',
        is_active: true,
      };

      if (settingsId) {
        const { error } = await supabase
          .from('announcements')
          .update({ ...announcementPayload, updated_at: new Date().toISOString() })
          .eq('id', settingsId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('announcements')
          .insert(announcementPayload)
          .select();
        if (error) throw error;
        if (data && data[0]) {
          setSettingsId(data[0].id);
        }
      }
      setToastMessage(enabled ? 'School Boundary Enabled: Showing on map' : 'School Boundary Disabled: Hidden from map');
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err) {
      console.error('Error toggling school boundary:', err);
      alert('Failed to update school boundary status.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    try {
      const payload = {
        entrance_latitude: parseFloat(entranceLat),
        entrance_longitude: parseFloat(entranceLng),
        entrance_threshold_meters: parseFloat(entranceThreshold),
        exit_gate_node_id: exitGateNodeId || null,
        exit_latitude: parseFloat(exitLat) || parseFloat(entranceLat) || 6.53586,
        exit_longitude: parseFloat(exitLng) || parseFloat(entranceLng) || 80.40035,
        exit_gate_label: exitGateLabel.trim() || 'Main Exit Gate',
        premises_center_latitude: parseFloat(premisesLat),
        premises_center_longitude: parseFloat(premisesLng),
        premises_radius_meters: parseFloat(premisesRadius),
        school_boundary_enabled: schoolBoundaryEnabled,
        show_school_boundary: schoolBoundaryEnabled,
        allow_boundary_bypass: allowBoundaryBypass,
        google_maps_url: googleMapsUrl.trim(),
      };

      if (isNaN(payload.entrance_latitude) || isNaN(payload.entrance_longitude) || isNaN(payload.premises_radius_meters)) {
        alert('Please enter valid numeric coordinates and distance values.');
        return;
      }

      // Preserve any existing extra payload fields (e.g. live_counter)
      let existingPayload: any = {};
      if (settingsId) {
        try {
          const { data: curr } = await supabase
            .from('announcements')
            .select('message')
            .eq('id', settingsId)
            .single();
          if (curr?.message) {
            existingPayload = JSON.parse(curr.message);
          }
        } catch {
          // ignore
        }
      }

      const mergedPayload = { ...existingPayload, ...payload };

      const announcementPayload = {
        title: 'System Exhibition Settings',
        message: JSON.stringify(mergedPayload),
        type: 'settings',
        is_active: true
      };

      if (settingsId) {
        const { error } = await supabase
          .from('announcements')
          .update({ ...announcementPayload, updated_at: new Date().toISOString() })
          .eq('id', settingsId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('announcements')
          .insert(announcementPayload)
          .select();
        if (error) throw error;
        if (data && data[0]) {
          setSettingsId(data[0].id);
        }
      }
      setToastMessage('Navigation & boundary settings saved successfully!');
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err) {
      console.error('Error saving settings:', err);
      alert('Error saving settings.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSaveLiveCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedSlots = liveSlots.map((row) => {
      const [sh, sm] = row.start_time.split(':').map(Number);
      const [eh, em] = row.end_time.split(':').map(Number);
      return {
        id: row.id,
        label: row.label.trim() || 'Unnamed Slot',
        start_hour: sh,   start_minute: sm,
        end_hour:   eh,   end_minute:   em,
        initial_visitor_count:    Math.max(0, parseInt(row.count, 10) || 0),
        fluctuation_interval_sec: Math.max(5, parseInt(row.interval, 10) || 30),
      };
    });
    setLiveCounterSaving(true);
    try {
      const newConfig = {
        time_slots: parsedSlots,
        outside_hours_count: Math.max(0, parseInt(liveOutsideCount, 10) || 0),
      };
      await saveLiveCounterConfig(newConfig);

      // Dual-sync into announcements settings record so it is 100% saved in Supabase
      if (settingsId) {
        try {
          const { data: currAnn } = await supabase
            .from('announcements')
            .select('message')
            .eq('id', settingsId)
            .single();
          let payload: any = {};
          if (currAnn?.message) {
            try { payload = JSON.parse(currAnn.message); } catch {}
          }
          payload.live_counter = newConfig;
          await supabase
            .from('announcements')
            .update({ message: JSON.stringify(payload), updated_at: new Date().toISOString() })
            .eq('id', settingsId);
        } catch (syncErr) {
          console.warn('Could not sync live counter into settings announcement:', syncErr);
        }
      }

      setToastMessage('Live counter settings saved successfully! Main screen counter updated.');
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      console.error('Error saving live counter config:', err);
      alert('Failed to save live counter settings.');
    } finally {
      setLiveCounterSaving(false);
    }
  };

  // Slot editor helpers
  const updateSlot = (id: string, field: string, value: string) =>
    setLiveSlots((prev) => prev.map((s) => s.id === id ? { ...s, [field]: value } : s));
  const addSlot = () =>
    setLiveSlots((prev) => [...prev, { id: `slot-${Date.now()}`, label: 'New Period', start_time: '09:00', end_time: '21:00', count: '100', interval: '30' }]);
  const removeSlot = (id: string) =>
    setLiveSlots((prev) => prev.filter((s) => s.id !== id));

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Real-time system overview and stats</p>
        </div>
      </header>

      {/* Real-time Presence Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          background: 'rgba(34, 197, 94, 0.08)',
          border: '1px solid rgba(34, 197, 94, 0.28)',
          borderRadius: '12px',
          padding: '0.55rem 1rem',
          fontSize: '0.82rem',
          color: '#4ade80',
          marginBottom: '1rem',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#22c55e',
            boxShadow: '0 0 10px #22c55e',
            display: 'inline-block',
          }}
        />
        <span>
          <strong>Live Website Presence:</strong> Showing <strong>{realtimeCount}</strong> active {realtimeCount === 1 ? 'user' : 'users'} browsing the website right now. Real-time updates automatically.
        </span>
      </div>

      {/* Stats Grid */}
      <section className="stat-cards-grid">
        <StatCard
          label="Real Users Online Now"
          value={realtimeCount}
          loading={false}
          icon={
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span
                style={{
                  position: 'absolute',
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: 'rgba(34, 197, 94, 0.25)',
                  animation: 'pulse 2s infinite',
                }}
              />
              <Activity size={20} color="#22c55e" style={{ position: 'relative' }} />
            </div>
          }
        />
        <StatCard
          label="Today's Users (Day Count)"
          value={visitorStats.today_count}
          loading={visitorStatsLoading}
          icon={<UserCheck size={20} color="#38bdf8" />}
        />
        <StatCard
          label="All-Time Total Users"
          value={visitorStats.all_time_count}
          loading={visitorStatsLoading}
          icon={<Globe size={20} color="#a855f7" />}
        />
        <StatCard
          label="Registered Accounts"
          value={stats.registeredCount}
          loading={loading}
          icon={<Users size={20} color="var(--color-primary-h)" />}
        />
        <StatCard
          label="Guest Sessions"
          value={stats.anonymousCount}
          loading={loading}
          icon={<Users size={20} color="var(--color-accent)" style={{ opacity: 0.8 }} />}
        />
        <StatCard
          label="Exhibitions"
          value={stats.exhibitionsCount}
          loading={loading}
          icon={<CalendarDays size={20} color="var(--color-accent)" />}
        />
        <StatCard
          label="Stores / Booths"
          value={stats.storesCount}
          loading={loading}
          icon={<Store size={20} color="var(--color-success)" />}
        />
        <StatCard
          label="Announcements"
          value={stats.announcementsCount}
          loading={loading}
          icon={<Megaphone size={20} color="var(--color-warning)" />}
        />
      </section>

      {/* Activity Section */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem', marginTop: '1rem' }}>
        <div className="glass" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Activity size={18} color="var(--color-primary-h)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Recent Activities</h2>
          </div>

          <div className="activity-feed">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="activity-item">
                  <div className="skeleton" style={{ width: '100%', height: 20 }} />
                </div>
              ))
            ) : activities.length === 0 ? (
              <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', padding: '1rem 0' }}>
                No recent activity recorded.
              </p>
            ) : (
              activities.map((act) => (
                <div key={act.id} className="activity-item">
                  <div
                    className="activity-dot"
                    style={{
                      background:
                        act.type === 'announcement'
                          ? 'var(--color-warning)'
                          : 'var(--color-primary)',
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>{act.title}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{act.subtitle}</p>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{act.time}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Exhibition Navigation & Boundaries Settings Panel */}
      <section style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
        <form onSubmit={handleSaveSettings} className="glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
            <Settings size={18} color="var(--color-primary-h)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Exhibition Boundary & Guided Tour Settings</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
            {/* Entrance settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-accent)', margin: 0 }}>Entrance Gate Location</h3>
              
              <div className="form-group">
                <label className="form-label" htmlFor="entrance-lat" style={{ fontSize: '0.75rem' }}>Latitude *</label>
                <input
                  id="entrance-lat"
                  type="text"
                  className="form-input"
                  required
                  value={entranceLat}
                  onChange={(e) => setEntranceLat(e.target.value)}
                  placeholder="e.g. 6.535472"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="entrance-lng" style={{ fontSize: '0.75rem' }}>Longitude *</label>
                <input
                  id="entrance-lng"
                  type="text"
                  className="form-input"
                  required
                  value={entranceLng}
                  onChange={(e) => setEntranceLng(e.target.value)}
                  placeholder="e.g. 80.401000"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="entrance-threshold" style={{ fontSize: '0.75rem' }}>Proximity Threshold (meters) *</label>
                <input
                  id="entrance-threshold"
                  type="number"
                  className="form-input"
                  required
                  value={entranceThreshold}
                  onChange={(e) => setEntranceThreshold(e.target.value)}
                  placeholder="e.g. 20"
                />
              </div>
            </div>

            {/* Designated Exit Gate Settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f59e0b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <DoorOpen size={16} />
                  Designated Exit Gate
                </h3>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '20px',
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}
                >
                  Single Exit Gate
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="exit-node-select" style={{ fontSize: '0.75rem' }}>
                  Choose from Graph Nodes
                </label>
                <select
                  id="exit-node-select"
                  className="form-select"
                  value={exitGateNodeId}
                  onChange={(e) => handleSelectExitNode(e.target.value)}
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
                >
                  <option value="">-- Custom / Direct Coordinates --</option>
                  {availableNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} {n.type ? `(${n.type})` : ''} {n.floor ? `· Fl ${n.floor}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="exit-label" style={{ fontSize: '0.75rem' }}>Exit Gate Name / Label *</label>
                <input
                  id="exit-label"
                  type="text"
                  className="form-input"
                  required
                  value={exitGateLabel}
                  onChange={(e) => setExitGateLabel(e.target.value)}
                  placeholder="e.g. Main Exit Gate / School Exit"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="exit-lat" style={{ fontSize: '0.75rem' }}>Latitude *</label>
                  <input
                    id="exit-lat"
                    type="text"
                    className="form-input"
                    required
                    value={exitLat}
                    onChange={(e) => {
                      setExitLat(e.target.value);
                      setExitGateNodeId('');
                    }}
                    placeholder="e.g. 6.53586"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="exit-lng" style={{ fontSize: '0.75rem' }}>Longitude *</label>
                  <input
                    id="exit-lng"
                    type="text"
                    className="form-input"
                    required
                    value={exitLng}
                    onChange={(e) => {
                      setExitLng(e.target.value);
                      setExitGateNodeId('');
                    }}
                    placeholder="e.g. 80.40035"
                  />
                </div>
              </div>

              <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>
                ℹ️ All visitors touring stalls will be prepared with a route terminating at this single exit gate, mathematically minimizing their total walking distance.
              </div>
            </div>

            {/* Premises Boundaries Settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-success)', margin: 0 }}>Premises & School Boundary</h3>
                
                {/* Active / Inactive status pill */}
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.6rem',
                    borderRadius: '20px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: schoolBoundaryEnabled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                    color: schoolBoundaryEnabled ? '#4ade80' : '#facc15',
                    border: `1px solid ${schoolBoundaryEnabled ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: schoolBoundaryEnabled ? '#22c55e' : '#eab308',
                      boxShadow: schoolBoundaryEnabled ? '0 0 8px #22c55e' : 'none',
                    }}
                  />
                  {schoolBoundaryEnabled ? 'Showing on Map' : 'Hidden from Map'}
                </span>
              </div>

              {/* School Boundary Toggle Card */}
              <div
                style={{
                  background: schoolBoundaryEnabled ? 'rgba(34, 197, 94, 0.05)' : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${schoolBoundaryEnabled ? 'rgba(34, 197, 94, 0.25)' : 'rgba(255, 255, 255, 0.08)'}`,
                  borderRadius: '10px',
                  padding: '0.85rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div
                      style={{
                        padding: '0.4rem',
                        borderRadius: '8px',
                        background: schoolBoundaryEnabled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.12)',
                        color: schoolBoundaryEnabled ? '#22c55e' : '#94a3b8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {schoolBoundaryEnabled ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>
                        Show School Boundary on Map
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', lineHeight: 1.3 }}>
                        {schoolBoundaryEnabled
                          ? 'Showing on Map: School perimeter boundary lines & geofence are visible on visitor maps.'
                          : 'Hidden from Map: The boundary lines and geofence circle are hidden from visitor maps.'}
                      </div>
                    </div>
                  </div>

                  {/* Toggle Switch */}
                  <label
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      width: '46px',
                      height: '24px',
                      flexShrink: 0,
                      cursor: 'pointer',
                    }}
                    title={schoolBoundaryEnabled ? 'Click to disable school boundary' : 'Click to enable school boundary'}
                  >
                    <input
                      type="checkbox"
                      checked={schoolBoundaryEnabled}
                      onChange={(e) => handleQuickToggleBoundary(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        cursor: 'pointer',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: schoolBoundaryEnabled ? '#22c55e' : '#334155',
                        transition: '0.3s',
                        borderRadius: '24px',
                        boxShadow: schoolBoundaryEnabled ? '0 0 10px rgba(34, 197, 94, 0.4)' : 'none',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          content: '""',
                          height: '18px',
                          width: '18px',
                          left: schoolBoundaryEnabled ? '24px' : '3px',
                          bottom: '3px',
                          backgroundColor: '#ffffff',
                          transition: '0.3s',
                          borderRadius: '50%',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                        }}
                      />
                    </span>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="premises-lat" style={{ fontSize: '0.75rem' }}>Center Latitude *</label>
                <input
                  id="premises-lat"
                  type="text"
                  className="form-input"
                  required
                  value={premisesLat}
                  onChange={(e) => setPremisesLat(e.target.value)}
                  placeholder="e.g. 6.535472"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="premises-lng" style={{ fontSize: '0.75rem' }}>Center Longitude *</label>
                <input
                  id="premises-lng"
                  type="text"
                  className="form-input"
                  required
                  value={premisesLng}
                  onChange={(e) => setPremisesLng(e.target.value)}
                  placeholder="e.g. 80.401000"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="premises-radius" style={{ fontSize: '0.75rem' }}>Boundary Radius (meters) *</label>
                <input
                  id="premises-radius"
                  type="number"
                  className="form-input"
                  required
                  value={premisesRadius}
                  onChange={(e) => setPremisesRadius(e.target.value)}
                  placeholder="e.g. 150"
                />
              </div>

              {/* Bypass Toggle Card */}
              <div
                style={{
                  background: allowBoundaryBypass ? 'rgba(99, 102, 241, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                  border: `1px solid ${allowBoundaryBypass ? 'rgba(99, 102, 241, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                  borderRadius: '10px',
                  padding: '0.85rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  marginTop: '0.5rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>
                    Allow Visitor Boundary Bypass
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', lineHeight: 1.3 }}>
                    {allowBoundaryBypass
                      ? 'Enabled: Visitors outside the venue can choose to bypass the notice and view the map.'
                      : 'Disabled: Outsiders are restricted to the splash screen with Google Maps directions (saves server resources during high traffic).'}
                  </div>
                </div>

                <label
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: '46px',
                    height: '24px',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                  title={allowBoundaryBypass ? 'Click to disable bypass' : 'Click to enable bypass'}
                >
                  <input
                    type="checkbox"
                    checked={allowBoundaryBypass}
                    onChange={(e) => setAllowBoundaryBypass(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: allowBoundaryBypass ? '#6366f1' : '#334155',
                      transition: '0.3s',
                      borderRadius: '24px',
                      boxShadow: allowBoundaryBypass ? '0 0 10px rgba(99, 102, 241, 0.4)' : 'none',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        content: '""',
                        height: '18px',
                        width: '18px',
                        left: allowBoundaryBypass ? '24px' : '3px',
                        bottom: '3px',
                        backgroundColor: '#ffffff',
                        transition: '0.3s',
                        borderRadius: '50%',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                      }}
                    />
                  </span>
                </label>
              </div>

              {/* Google Maps Link Input */}
              <div className="form-group" style={{ marginTop: '0.5rem' }}>
                <label className="form-label" htmlFor="google-maps-url" style={{ fontSize: '0.75rem' }}>
                  Exhibition Google Maps Location URL (Bypass Screen Directions)
                </label>
                <input
                  id="google-maps-url"
                  type="url"
                  className="form-input"
                  value={googleMapsUrl}
                  onChange={(e) => setGoogleMapsUrl(e.target.value)}
                  placeholder="e.g. https://maps.app.goo.gl/YourVenueLink or leave empty for auto GPS link"
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>
                  This link opens when visitors click &quot;Open in Google Maps&quot; on the geofence bypass screen.
                </span>
              </div>
            </div>
          </div>

          {toastMessage && (
            <div
              style={{
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                color: '#4ade80',
                padding: '0.6rem 1rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <CheckCircle2 size={16} />
              <span>{toastMessage}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={settingsSaving}
              style={{ minWidth: '140px' }}
            >
              {settingsSaving ? <span className="spinner" /> : 'Save Settings'}
            </button>
          </div>
        </form>
      </section>

      {/* Live Visitor Counter Settings — Time Slot Editor */}
      <section style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
        <form onSubmit={handleSaveLiveCounter} className="glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
            <Radio size={18} color="var(--color-success)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Live Visitor Counter — Time Slots</h2>
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '20px', background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', display: 'inline-block' }} />
              Shown on Home Page
            </span>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: 0, lineHeight: 1.55 }}>
            Define visitor count per time period for the <strong style={{ color: 'var(--color-text)' }}>9 AM – 9 PM</strong> exhibition window.
            The displayed count = <strong style={{ color: 'var(--color-text)' }}>Slot Count + Real Registered Visitors</strong>, then fluctuates ±1/2 at each interval.
            Outside all slots the counter shows the Outside Hours count (usually 0).
          </p>

          {/* Column Headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 90px 90px 90px 90px 32px', gap: '0.5rem', padding: '0 0.25rem' }}>
            {['Period Label', 'Start', 'End', 'Count', 'Interval (s)', ''].map((h) => (
              <span key={h} style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
            ))}
          </div>

          {/* Slot Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {liveSlots.map((slot) => (
              <div key={slot.id} style={{ display: 'grid', gridTemplateColumns: '1.8fr 90px 90px 90px 90px 32px', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  className="form-input"
                  value={slot.label}
                  onChange={(e) => updateSlot(slot.id, 'label', e.target.value)}
                  placeholder="e.g. Afternoon Peak"
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
                />
                <input
                  type="time"
                  className="form-input"
                  value={slot.start_time}
                  onChange={(e) => updateSlot(slot.id, 'start_time', e.target.value)}
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}
                />
                <input
                  type="time"
                  className="form-input"
                  value={slot.end_time}
                  onChange={(e) => updateSlot(slot.id, 'end_time', e.target.value)}
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}
                />
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  value={slot.count}
                  onChange={(e) => updateSlot(slot.id, 'count', e.target.value)}
                  placeholder="150"
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}
                />
                <input
                  type="number"
                  className="form-input"
                  min="5"
                  value={slot.interval}
                  onChange={(e) => updateSlot(slot.id, 'interval', e.target.value)}
                  placeholder="30"
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => removeSlot(slot.id)}
                  title="Remove this slot"
                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', borderRadius: '6px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: '1rem', fontWeight: 700, lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Add Slot + Outside Hours */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', paddingTop: '0.25rem' }}>
            <button
              type="button"
              onClick={addSlot}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.8rem' }}
            >
              + Add Time Slot
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginLeft: 'auto' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                Outside Hours Count (9 PM – 9 AM):
              </label>
              <input
                id="live-outside-count"
                type="number"
                className="form-input"
                min="0"
                value={liveOutsideCount}
                onChange={(e) => setLiveOutsideCount(e.target.value)}
                style={{ width: '80px', fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}
                placeholder="0"
              />
            </div>
          </div>

          {/* Toast */}
          {toastMessage && (
            <div style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', padding: '0.6rem 1rem', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} />
              <span>{toastMessage}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={liveCounterSaving} style={{ minWidth: '180px' }}>
              {liveCounterSaving ? <span className="spinner" /> : <Radio size={14} />}
              Save Counter Settings
            </button>
          </div>
        </form>
      </section>

      {/* Total User Counts — Full Day Count & All-Time Management */}
      <section style={{ marginTop: '1.5rem', marginBottom: '2.5rem' }}>
        <form onSubmit={handleSaveVisitorStats} className="glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserCheck size={20} color="#38bdf8" />
              </div>
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--color-text)' }}>
                  Total App Users Management
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '0.2rem 0 0' }}>
                  Manage and calibrate the full count of users for the day and cumulative all-time total users
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', background: 'rgba(255,255,255,0.05)', padding: '0.25rem 0.6rem', borderRadius: '6px' }}>
                📅 Tracking Date: <strong style={{ color: 'var(--color-text)' }}>{visitorStats.today_date}</strong>
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            {/* Full Count of the Day */}
            <div style={{ background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '12px', padding: '1.1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.4rem' }}>
                <UserCheck size={17} color="#38bdf8" />
                <label htmlFor="day-user-count" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>
                  Full Count of the Day
                </label>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0 0 0.85rem', lineHeight: 1.4 }}>
                Total unique visitors who used the app today. Automatically rolls over at midnight.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  id="day-user-count"
                  type="number"
                  min="0"
                  className="form-input"
                  value={dayUserCountInput}
                  onChange={(e) => setDayUserCountInput(e.target.value)}
                  style={{ fontSize: '1.05rem', fontWeight: 700, padding: '0.5rem 0.75rem' }}
                />
                <button
                  type="button"
                  onClick={() => setDayUserCountInput((prev) => String((parseInt(prev, 10) || 0) + 10))}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.75rem', padding: '0.45rem 0.65rem', whiteSpace: 'nowrap' }}
                >
                  +10
                </button>
              </div>
            </div>

            {/* Full Count from All the Time */}
            <div style={{ background: 'rgba(168, 85, 247, 0.05)', border: '1px solid rgba(168, 85, 247, 0.2)', borderRadius: '12px', padding: '1.1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.4rem' }}>
                <Globe size={17} color="#a855f7" />
                <label htmlFor="all-time-user-count" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text)' }}>
                  Full Count from All the Time
                </label>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0 0 0.85rem', lineHeight: 1.4 }}>
                Cumulative total unique users who have ever accessed and used the exhibition navigation app.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  id="all-time-user-count"
                  type="number"
                  min="0"
                  className="form-input"
                  value={allTimeUserCountInput}
                  onChange={(e) => setAllTimeUserCountInput(e.target.value)}
                  style={{ fontSize: '1.05rem', fontWeight: 700, padding: '0.5rem 0.75rem' }}
                />
                <button
                  type="button"
                  onClick={() => setAllTimeUserCountInput((prev) => String((parseInt(prev, 10) || 0) + 50))}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.75rem', padding: '0.45rem 0.65rem', whiteSpace: 'nowrap' }}
                >
                  +50
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="submit" className="btn btn-primary" disabled={visitorStatsSaving} style={{ minWidth: '180px' }}>
              {visitorStatsSaving ? <span className="spinner" /> : <UserCheck size={15} />}
              Save Total User Counts
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
