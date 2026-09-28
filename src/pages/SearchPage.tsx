import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowLeft,
  Store,
  CalendarDays,
  Compass,
  Navigation,
  MapPin,
  Tag,
  Info,
  FlameKindling,
  X,
} from 'lucide-react';
import { supabase, type Store as StoreType, type Exhibition, type NavigationNode } from '../lib/supabase';
import { recordStallEngagement } from '../services/stallPopularityService';

type SearchCategory = 'all' | 'stores' | 'exhibitions' | 'facilities';

export function SearchPage() {
  const navigate = useNavigate();

  const [stores, setStores] = useState<StoreType[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [nodes, setNodes] = useState<NavigationNode[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SearchCategory>('all');

  useEffect(() => {
    loadAllSearchResources();
  }, []);

  async function loadAllSearchResources() {
    try {
      setLoading(true);
      const [storesRes, exhibitionsRes, nodesRes] = await Promise.all([
        supabase
          .from('stores')
          .select(`
            *,
            categories:category_id (id, name, color),
            exhibitions:exhibition_id (id, title)
          `)
          .eq('is_active', true),
        supabase
          .from('exhibitions')
          .select('*')
          .eq('is_active', true),
        supabase
          .from('navigation_nodes')
          .select('*')
          .in('type', ['entrance', 'poi', 'emergency']),
      ]);

      setStores(storesRes.data || []);
      setExhibitions(exhibitionsRes.data || []);
      setNodes(nodesRes.data || []);
    } catch (err) {
      console.error('Error fetching search resources:', err);
    } finally {
      setLoading(false);
    }
  }

  // Filters logic
  const query = searchQuery.trim().toLowerCase();

  const filteredStores = stores.filter((st) => {
    if (!query) return true;
    return (
      st.name.toLowerCase().includes(query) ||
      (st.description && st.description.toLowerCase().includes(query)) ||
      (st.categories?.name && st.categories.name.toLowerCase().includes(query))
    );
  });

  const filteredExhibitions = exhibitions.filter((ex) => {
    if (!query) return true;
    return (
      ex.title.toLowerCase().includes(query) ||
      (ex.description && ex.description.toLowerCase().includes(query)) ||
      (ex.location && ex.location.toLowerCase().includes(query))
    );
  });

  const filteredFacilities = nodes.filter((n) => {
    if (!query) return true;
    return (
      n.label.toLowerCase().includes(query) ||
      n.type.toLowerCase().includes(query)
    );
  });

  const totalResults =
    (activeTab === 'all' || activeTab === 'stores' ? filteredStores.length : 0) +
    (activeTab === 'all' || activeTab === 'exhibitions' ? filteredExhibitions.length : 0) +
    (activeTab === 'all' || activeTab === 'facilities' ? filteredFacilities.length : 0);

  return (
    <div className="profile-page" style={{ maxWidth: 800 }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button
          onClick={() => navigate(-1)}
          className="btn btn-ghost btn-sm btn-icon"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Unified Directory Search</h1>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.8rem', margin: 0 }}>
            Find exhibitors, summits, event schedules, entrances, and guest services.
          </p>
        </div>
      </div>

      {/* Search Input block */}
      <section className="glass" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Search size={20} color="var(--color-muted)" />
          <input
            type="text"
            placeholder="Type store, category, exhibition, restrooms, information desk..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text)',
              fontSize: '1rem',
              outline: 'none',
              padding: '0.25rem 0',
            }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <X size={16} color="var(--color-muted)" />
            </button>
          )}
        </div>
      </section>

      {/* Tabs list */}
      <div className="search-tab-bar" style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
        {(['all', 'stores', 'exhibitions', 'facilities'] as const).map((tab) => {
          let label = 'All Results';
          if (tab === 'stores') label = 'Exhibitors';
          if (tab === 'exhibitions') label = 'Exhibitions';
          if (tab === 'facilities') label = 'Facilities & Services';

          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`btn ${isActive ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '0.45rem 1rem', fontSize: '0.825rem', whiteSpace: 'nowrap' }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ padding: '3rem 0', display: 'flex', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      ) : totalResults === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem' }} className="glass">
          <Info size={36} color="var(--color-muted)" style={{ margin: '0 auto 1rem auto' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>No results found</h3>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
            Check spelling or try a different filter category.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Exhibitors Results */}
          {(activeTab === 'all' || activeTab === 'stores') && filteredStores.length > 0 && (
            <div>
              {activeTab === 'all' && (
                <h3 style={{ fontSize: '0.8rem', color: 'var(--color-muted)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                  Exhibitors & Booths ({filteredStores.length})
                </h3>
              )}
              <div className="search-results-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {filteredStores.map((st) => (
                  <div key={st.id} className="glass" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                      {st.logo_url ? (
                        <img src={st.logo_url} alt="" style={{ width: 44, height: 44, borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: '8px', background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Store size={22} color="var(--color-muted)" />
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {st.name}
                        </h4>
                        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                          {st.categories && (
                            <span className="badge" style={{ background: st.categories.color ? `${st.categories.color}15` : undefined, color: st.categories.color || undefined, borderColor: st.categories.color ? `${st.categories.color}35` : undefined, fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
                              {st.categories.name}
                            </span>
                          )}
                          <span className="badge badge-muted" style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
                            Floor {st.floor || '1'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <Link
                        to={`/stores/${st.id}`}
                        onClick={() => recordStallEngagement(st.id, st.name, 'search')}
                        className="btn btn-ghost btn-sm"
                        style={{ flex: 1, padding: '0.45rem', fontSize: '0.75rem' }}
                      >
                        View Profile
                      </Link>
                      <button
                        onClick={() => {
                          recordStallEngagement(st.id, st.name, 'route');
                          navigate(`/map?to=${st.id}`);
                        }}
                        className="btn btn-primary btn-sm"
                        style={{ flex: 1, padding: '0.45rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                      >
                        <Navigation size={12} style={{ transform: 'rotate(45deg)' }} />
                        Directions
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exhibitions Results */}
          {(activeTab === 'all' || activeTab === 'exhibitions') && filteredExhibitions.length > 0 && (
            <div>
              {activeTab === 'all' && (
                <h3 style={{ fontSize: '0.8rem', color: 'var(--color-muted)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                  Exhibition Events ({filteredExhibitions.length})
                </h3>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {filteredExhibitions.map((ex) => (
                  <Link
                    key={ex.id}
                    to={`/exhibitions/${ex.id}`}
                    className="glass"
                    style={{
                      padding: '1rem',
                      display: 'flex',
                      gap: '0.875rem',
                      alignItems: 'center',
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                  >
                    {ex.image_url ? (
                      <img src={ex.image_url} alt="" style={{ width: 60, height: 60, borderRadius: '6px', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 60, height: 60, borderRadius: '6px', background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <CalendarDays size={26} color="var(--color-muted)" />
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ex.title}
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--color-muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        <MapPin size={12} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ex.location || 'Main Center'}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Facilities Results */}
          {(activeTab === 'all' || activeTab === 'facilities') && filteredFacilities.length > 0 && (
            <div>
              {activeTab === 'all' && (
                <h3 style={{ fontSize: '0.8rem', color: 'var(--color-muted)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                  Venue Facilities & Guest Services ({filteredFacilities.length})
                </h3>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {filteredFacilities.map((n) => {
                  let icon = <Compass size={22} color="var(--color-muted)" />;
                  let typeLabel = 'Facility';
                  if (n.type === 'entrance') {
                    icon = <Navigation size={22} color="#22d3ee" />;
                    typeLabel = 'Entrance / Exit';
                  } else if (n.type === 'emergency') {
                    icon = <FlameKindling size={22} color="#f43f5e" />;
                    typeLabel = 'Emergency Exit';
                  } else if (n.type === 'poi') {
                    icon = <Tag size={22} color="#a78bfa" />;
                    typeLabel = 'Point of Interest';
                  }

                  return (
                    <div key={n.id} className="glass" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div style={{ width: 44, height: 44, borderRadius: '8px', background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {icon}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {n.label}
                          </h4>
                          <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.2rem' }}>
                            <span className="badge badge-muted" style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
                              {typeLabel}
                            </span>
                            <span className="badge badge-muted" style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
                              Floor {n.floor || '1'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => navigate(`/map?toNode=${n.id}`)}
                        className="btn btn-primary btn-sm"
                        style={{ padding: '0.45rem', fontSize: '0.75rem', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                      >
                        <Navigation size={12} style={{ transform: 'rotate(45deg)' }} />
                        Navigate to Location
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}


