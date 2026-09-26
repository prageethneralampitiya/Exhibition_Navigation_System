import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Calendar, MapPin, ArrowLeft, CalendarDays, Star,
  ChevronRight, Clock, TrendingUp,
} from 'lucide-react';
import { supabase, type Exhibition } from '../lib/supabase';

type FilterStatus = 'all' | 'active' | 'upcoming' | 'ended';

const STATUS_CONFIG: Record<FilterStatus, { label: string; color: string; bg: string }> = {
  all: { label: 'All Events', color: 'var(--color-text)', bg: 'rgba(255,255,255,0.06)' },
  active: { label: 'Active Now', color: 'var(--color-success)', bg: 'rgba(16,185,129,0.12)' },
  upcoming: { label: 'Upcoming', color: 'var(--color-accent)', bg: 'rgba(34,211,238,0.12)' },
  ended: { label: 'Ended', color: 'var(--color-muted)', bg: 'rgba(100,116,139,0.12)' },
};

function getExhibitionStatus(ex: Exhibition) {
  const nowStr = new Date().toISOString().split('T')[0];
  if (ex.start_date && ex.start_date > nowStr) return 'upcoming';
  if (ex.end_date && ex.end_date < nowStr) return 'ended';
  return 'active';
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return null;
  const fmt = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}

export function ExhibitionDirectoryPage() {
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  useEffect(() => {
    fetchExhibitions();
  }, []);

  async function fetchExhibitions() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('exhibitions')
        .select('*')
        .order('start_date', { ascending: true });
      if (error) throw error;
      setExhibitions(data || []);
    } catch (err) {
      console.error('Error fetching exhibitions:', err);
    } finally {
      setLoading(false);
    }
  }

  const query = searchQuery.trim().toLowerCase();
  const filteredExhibitions = useMemo(() => {
    return exhibitions.filter((ex) => {
      const matchesSearch =
        !query ||
        ex.title.toLowerCase().includes(query) ||
        (ex.location && ex.location.toLowerCase().includes(query));
      if (!matchesSearch) return false;
      if (filterStatus === 'all') return true;
      return getExhibitionStatus(ex) === filterStatus;
    });
  }, [exhibitions, query, filterStatus]);

  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = {
      all: exhibitions.length,
      active: 0,
      upcoming: 0,
      ended: 0,
    };
    for (const ex of exhibitions) {
      const s = getExhibitionStatus(ex);
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [exhibitions]);

  return (
    <div className="profile-page ex-dir-enhanced" style={{ maxWidth: 860 }}>

      {/* ── Back Navigation ─────────────────────────────── */}
      <Link to="/" className="dir-back-link" id="exhibitions-back-btn">
        <ArrowLeft size={16} />
        Back to Home
      </Link>

      {/* ── Page Header ─────────────────────────────────── */}
      <header className="dir-page-header">
        <div className="dir-header-main">
          <div className="dir-header-icon dir-header-icon-purple">
            <CalendarDays size={22} color="#fff" />
          </div>
          <div>
            <h1 className="dir-page-title">Exhibitions & Events</h1>
            <p className="dir-page-desc">
              Discover tradeshows, display galleries, and coordinate schedules
            </p>
          </div>
        </div>
        <div className="dir-count-badge">
          {loading ? '…' : `${filteredExhibitions.length} Events`}
        </div>
      </header>

      {/* ── Search Panel ─────────────────────────────────── */}
      <section className="glass dir-filter-panel" id="exhibitions-filter-panel">
        <div className="search-wrap dir-search-wrap" style={{ width: '100%' }}>
          <Search size={18} className="search-icon" />
          <input
            id="exhibitions-search-input"
            type="text"
            placeholder="Search by event name or hall location…"
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Status filter tabs */}
        <div className="ex-status-tabs">
          {(['all', 'active', 'upcoming', 'ended'] as FilterStatus[]).map((status) => {
            const cfg = STATUS_CONFIG[status];
            const count = statusCounts[status];
            return (
              <button
                key={status}
                id={`ex-filter-${status}`}
                className={`ex-status-tab ${filterStatus === status ? 'active' : ''}`}
                onClick={() => setFilterStatus(status)}
                style={{
                  '--tab-color': cfg.color,
                  '--tab-bg': cfg.bg,
                } as React.CSSProperties}
              >
                {cfg.label}
                <span className="ex-tab-count">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Exhibition Cards ─────────────────────────────── */}
      <section className="ex-dir-list" aria-label="Exhibition listings">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass skeleton ex-card-skeleton" />
          ))
        ) : filteredExhibitions.length === 0 ? (
          <div className="dir-empty-state">
            <CalendarDays size={40} style={{ opacity: 0.3 }} />
            <h3>No Events Found</h3>
            <p>Try adjusting your search or status filter.</p>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setSearchQuery(''); setFilterStatus('all'); }}
            >
              Clear Filters
            </button>
          </div>
        ) : (
          filteredExhibitions.map((ex) => {
            const status = getExhibitionStatus(ex);
            const cfg = STATUS_CONFIG[status];
            const dateRange = formatDateRange(ex.start_date, ex.end_date);

            return (
              <Link
                key={ex.id}
                to={`/exhibitions/${ex.id}`}
                className={`ex-dir-card ex-card-${status}`}
                id={`ex-card-${ex.id}`}
              >
                {/* Left visual thumbnail */}
                <div className="ex-card-thumb">
                  {ex.image_url ? (
                    <img src={ex.image_url} alt={ex.title} className="ex-card-thumb-img" loading="lazy" decoding="async" />
                  ) : (
                    <div className="ex-card-thumb-ph">
                      <CalendarDays size={28} color="rgba(255,255,255,0.35)" />
                    </div>
                  )}

                  {/* Overlaid status pill */}
                  <span
                    className="ex-card-status-pill"
                    style={{ background: cfg.bg, color: cfg.color, borderColor: `${cfg.color}30` }}
                  >
                    {status === 'active' && <span className="ex-status-pulse" />}
                    {cfg.label}
                  </span>
                </div>

                {/* Content */}
                <div className="ex-card-content">
                  <div className="ex-card-title-row">
                    <h2 className="ex-card-title">{ex.title}</h2>
                    <div className="ex-card-badges">
                      {ex.is_featured && (
                        <span className="ex-featured-badge">
                          <Star size={10} fill="currentColor" />
                          Featured
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="ex-card-desc">
                    {ex.description || 'Join this exhibition event and explore the latest innovations.'}
                  </p>

                  <div className="ex-card-meta">
                    <span className="ex-meta-chip">
                      <MapPin size={12} />
                      {ex.location || 'Exhibition Area'}
                    </span>
                    {dateRange && (
                      <span className="ex-meta-chip">
                        <Calendar size={12} />
                        {dateRange}
                      </span>
                    )}
                    {status === 'active' && (
                      <span className="ex-live-chip">
                        <TrendingUp size={11} />
                        Live Now
                      </span>
                    )}
                    {status === 'upcoming' && ex.start_date && (
                      <span className="ex-meta-chip ex-upcoming-chip">
                        <Clock size={11} />
                        Starts {formatDateRange(ex.start_date, null)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="ex-card-arrow">
                  <ChevronRight size={20} />
                </div>
              </Link>
            );
          })
        )}
      </section>
    </div>
  );
}
