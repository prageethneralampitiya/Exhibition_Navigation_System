import { useEffect, useState } from 'react';
import { CalendarDays, Store, Megaphone, Users, Activity, Settings } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { StatCard } from '../../components/admin/StatCard';

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
  const [premisesLat, setPremisesLat] = useState('6.535472');
  const [premisesLng, setPremisesLng] = useState('80.401000');
  const [premisesRadius, setPremisesRadius] = useState('150');
  
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

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
          supabase.from('announcements').select('id', { count: 'exact', head: true }),
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
        // 4. Fetch existing settings
        const { data: settingsRes } = await supabase
          .from('announcements')
          .select('*')
          .eq('type', 'settings')
          .limit(1);

        if (settingsRes && settingsRes.length > 0) {
          const s = settingsRes[0];
          setSettingsId(s.id);
          try {
            const parsed = JSON.parse(s.message);
            setEntranceLat(String(parsed.entrance_latitude ?? '6.535472'));
            setEntranceLng(String(parsed.entrance_longitude ?? '80.401000'));
            setEntranceThreshold(String(parsed.entrance_threshold_meters ?? '20'));
            setPremisesLat(String(parsed.premises_center_latitude ?? '6.535472'));
            setPremisesLng(String(parsed.premises_center_longitude ?? '80.401000'));
            setPremisesRadius(String(parsed.premises_radius_meters ?? '150'));
          } catch (e) {
            console.error('Error parsing settings:', e);
          }
        }

        const [recentAnnouncements, recentProfiles, recentVisitorLocations] = await Promise.all([
          supabase
            .from('announcements')
            .select('id, title, created_at')
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

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    try {
      const payload = {
        entrance_latitude: parseFloat(entranceLat),
        entrance_longitude: parseFloat(entranceLng),
        entrance_threshold_meters: parseFloat(entranceThreshold),
        premises_center_latitude: parseFloat(premisesLat),
        premises_center_longitude: parseFloat(premisesLng),
        premises_radius_meters: parseFloat(premisesRadius)
      };

      if (isNaN(payload.entrance_latitude) || isNaN(payload.entrance_longitude) || isNaN(payload.premises_radius_meters)) {
        alert('Please enter valid numeric coordinates and distance values.');
        return;
      }

      const announcementPayload = {
        title: 'System Exhibition Settings',
        message: JSON.stringify(payload),
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
      alert('Navigation settings saved successfully!');
    } catch (err) {
      console.error('Error saving settings:', err);
      alert('Error saving settings.');
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Real-time system overview and stats</p>
        </div>
      </header>

      {/* Stats Grid */}
      <section className="stat-cards-grid">
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

            {/* Premises Boundaries Settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-success)', margin: 0 }}>Premises Boundaries</h3>

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
            </div>
          </div>

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
    </main>
  );
}
