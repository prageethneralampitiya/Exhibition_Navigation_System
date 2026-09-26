import { useEffect, useLayoutEffect, useState, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Clock,
  Mic,
  CalendarDays,
  Store,
  Star,
} from 'lucide-react';
import {
  supabase,
  type Exhibition,
  type Store as StoreType,
  type ExhibitionEvent,
} from '../lib/supabase';

const MapView = lazy(() => import('../components/MapView').then(m => ({ default: m.MapView })));

export function ExhibitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [events, setEvents] = useState<ExhibitionEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Group stores by category helper
  const [activeCategoryFilter, setActiveCategoryFilter] = useState('');

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [id]);

  useEffect(() => {
    if (id) {
      loadExhibitionDetails(id);
    }
  }, [id]);

  async function loadExhibitionDetails(exId: string) {
    try {
      setLoading(true);

      // Fetch exhibition profile
      const { data: exData, error: exError } = await supabase
        .from('exhibitions')
        .select('*')
        .eq('id', exId)
        .single();

      if (exError) throw exError;
      setExhibition(exData);

      // Fetch participating stores and schedule events in parallel
      const [storesRes, eventsRes] = await Promise.all([
        supabase
          .from('stores')
          .select(`
            *,
            categories:category_id (id, name, color),
            exhibitions:exhibition_id (id, title)
          `)
          .eq('exhibition_id', exId)
          .eq('is_active', true),
        supabase
          .from('exhibition_events')
          .select('*')
          .eq('exhibition_id', exId)
          .order('start_time', { ascending: true }),
      ]);

      setStores(storesRes.data || []);
      setEvents(eventsRes.data || []);
    } catch (err) {
      console.error('Error fetching exhibition details:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  if (!exhibition) {
    return (
      <div className="profile-page" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Exhibition Not Found</h1>
        <p style={{ color: 'var(--color-muted)', margin: '1rem 0' }}>
          The requested exhibition event does not exist or has been archived.
        </p>
        <Link to="/exhibitions" className="btn btn-primary">
          Back to Directory
        </Link>
      </div>
    );
  }

  // Categories list of participating stores
  const storeCategories = Array.from(
    new Map(
      stores.map((s) => s.categories).filter(Boolean).map((c) => [c!.id, c!])
    ).values()
  );

  const filteredStores = activeCategoryFilter
    ? stores.filter((s) => s.category_id === activeCategoryFilter)
    : stores;

  return (
    <div className="profile-page" style={{ maxWidth: 800 }}>
      {/* Back button */}
      <Link
        to="/exhibitions"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          color: 'var(--color-muted)',
          textDecoration: 'none',
          fontSize: '0.875rem',
          marginBottom: '1.5rem',
        }}
      >
        <ArrowLeft size={16} />
        Back to Directory
      </Link>

      {/* Main Exhibition Header Card */}
      <section className="glass" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          {exhibition.image_url ? (
            <img
              src={exhibition.image_url}
              alt={exhibition.title}
              style={{ width: '120px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <div style={{ width: '120px', height: '90px', borderRadius: '8px', background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <CalendarDays size={36} color="var(--color-muted)" />
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>{exhibition.title}</h1>
              {exhibition.is_featured && (
                <span className="badge badge-warning" style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <Star size={10} fill="currentColor" />
                  Featured
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
                <MapPin size={13} />
                {exhibition.location || 'Exhibition Area'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
                <Calendar size={13} />
                {exhibition.start_date || '?'} to {exhibition.end_date || '?'}
              </span>
            </div>
          </div>
        </div>

        <p style={{ fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--color-text)' }}>
          {exhibition.description || 'Welcome to this custom navigation exhibition event.'}
        </p>
      </section>

      {/* Interactive Map View */}
      <section className="glass" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.5rem' }}>Floor Map & Booths</h2>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
          Interactive map of all stores and facility booths. Click markers to check detail popups.
        </p>

        {/* Map Container */}
        <div style={{ height: '320px', width: '100%', position: 'relative' }}>
          {exhibition.latitude !== null && exhibition.longitude !== null ? (
            <Suspense fallback={<div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 'var(--radius-lg)' }} />}>
              <MapView
                latitude={exhibition.latitude}
                longitude={exhibition.longitude}
                stores={stores}
              />
            </Suspense>
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 'var(--radius-lg)',
                border: '1px dashed var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-muted)',
                fontSize: '0.875rem',
              }}
            >
              Coordinates not configured for this exhibition yet.
            </div>
          )}
        </div>
      </section>

      {/* Event Schedule Timeline */}
      {events.length > 0 && (
        <section className="glass" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1rem' }}>Seminar & Event Schedule</h2>
          <div className="activity-feed">
            {events.map((evt) => {
              const startStr = new Date(evt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const endStr = new Date(evt.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={evt.id} className="activity-item">
                  <div className="activity-dot" style={{ background: 'var(--color-primary)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>{evt.title}</h3>
                      <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>
                        <Clock size={10} style={{ marginRight: 2 }} />
                        {startStr} - {endStr}
                      </span>
                    </div>
                    {evt.description && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--color-text)', marginTop: '0.2rem' }}>
                        {evt.description}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                      {evt.speaker && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                          <Mic size={10} />
                          Speaker: {evt.speaker}
                        </span>
                      )}
                      {evt.location && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                          <MapPin size={10} />
                          {evt.location}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Exhibitors list grouped by category */}
      <section className="glass" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Participating Booths ({stores.length})</h2>

          {/* Categories filter chips */}
          {storeCategories.length > 0 && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              <button
                className={`btn btn-sm ${!activeCategoryFilter ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveCategoryFilter('')}
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }}
              >
                All
              </button>
              {storeCategories.map((cat) => (
                <button
                  key={cat.id}
                  className={`btn btn-sm ${activeCategoryFilter === cat.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setActiveCategoryFilter(cat.id)}
                  style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
          {filteredStores.length === 0 ? (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', gridColumn: '1 / -1', textAlign: 'center', padding: '2rem' }}>
              No store booths mapped yet for this category.
            </p>
          ) : (
            filteredStores.map((st) => (
              <Link
                key={st.id}
                to={`/stores/${st.id}`}
                className="glass"
                style={{
                  padding: '1rem',
                  textDecoration: 'none',
                  color: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                {st.logo_url ? (
                  <img src={st.logo_url} alt={st.name} style={{ width: 36, height: 36, borderRadius: '6px', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: '6px', background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Store size={18} color="var(--color-muted)" />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {st.name}
                  </h4>
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>
                    Floor {st.floor || '1'}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
