import { useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, MapPin, Clock, ArrowLeft, Store, Star,
  Filter, ChevronRight, Sparkles, LayoutGrid, List,
} from 'lucide-react';
import { supabase, type Store as StoreType, type Category } from '../lib/supabase';

type ViewMode = 'grid' | 'list';

export function StoreDirectoryPage() {
  const [stores, setStores] = useState<StoreType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedFloor, setSelectedFloor] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  useEffect(() => {
    document.body.classList.add('fixed-bg-tab');
    loadData();
    return () => {
      document.body.classList.remove('fixed-bg-tab');
    };
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [storesRes, categoriesRes] = await Promise.all([
        supabase
          .from('stores')
          .select(`
            *,
            categories:category_id (id, name, color),
            exhibitions:exhibition_id (id, title)
          `)
          .eq('is_active', true)
          .order('name'),
        supabase.from('categories').select('*').order('name'),
      ]);

      setStores(storesRes.data || []);
      setCategories(categoriesRes.data || []);
    } catch (err) {
      console.error('Error loading store directory data:', err);
    } finally {
      setLoading(false);
    }
  }

  const query = searchQuery.trim().toLowerCase();
  const filteredStores = useMemo(() => {
    return stores.filter((st) => {
      const matchesSearch =
        !query ||
        st.name.toLowerCase().includes(query) ||
        (st.description && st.description.toLowerCase().includes(query));
      const matchesCategory = !selectedCategory || st.category_id === selectedCategory;
      const matchesFloor = !selectedFloor || st.floor === selectedFloor;
      return matchesSearch && matchesCategory && matchesFloor;
    });
  }, [stores, query, selectedCategory, selectedFloor]);

  const floorLevels = useMemo(() => {
    return Array.from(
      new Set(stores.map((s) => s.floor).filter(Boolean))
    ).sort();
  }, [stores]);

  const isOpen = (openingTime?: string | null, closingTime?: string | null) => {
    if (!openingTime || !closingTime) return null;
    const now = new Date();
    const [oh, om] = openingTime.split(':').map(Number);
    const [ch, cm] = closingTime.split(':').map(Number);
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= oh * 60 + om && mins < ch * 60 + cm;
  };

  return (
    <div className="profile-page store-dir-enhanced" style={{ maxWidth: 840 }}>

      {/* ── Back Navigation ─────────────────────────────── */}
      <Link to="/" className="dir-back-link" id="stores-back-btn">
        <ArrowLeft size={16} />
        Back to Home
      </Link>

      {/* ── Page Header ─────────────────────────────────── */}
      <header className="dir-page-header">
        <div className="dir-header-main">
          <div className="dir-header-icon dir-header-icon-cyan">
            <Store size={22} color="#fff" />
          </div>
          <div>
            <h1 className="dir-page-title">Exhibitor Directory</h1>
            <p className="dir-page-desc">
              Explore stores, food stalls, booths, and special deals
            </p>
          </div>
        </div>
        <div className="dir-count-badge">
          {loading ? '…' : `${filteredStores.length} Exhibitors`}
        </div>
      </header>

      {/* ── Search & Filter Panel ────────────────────────── */}
      <section className="glass dir-filter-panel" id="stores-filter-panel">
        <div className="dir-search-row">
          <div className="search-wrap dir-search-wrap">
            <Search size={18} className="search-icon" />
            <input
              id="stores-search-input"
              type="text"
              placeholder="Search by name, brand or keyword…"
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* View toggle */}
          <div className="dir-view-toggle">
            <button
              id="stores-view-list"
              className={`dir-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <List size={16} />
            </button>
            <button
              id="stores-view-grid"
              className={`dir-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>

        <div className="dir-selects-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">
              <Filter size={11} style={{ display: 'inline', marginRight: 4 }} />
              Category
            </label>
            <select
              id="stores-category-filter"
              className="form-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">
              <MapPin size={11} style={{ display: 'inline', marginRight: 4 }} />
              Floor Level
            </label>
            <select
              id="stores-floor-filter"
              className="form-select"
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
            >
              <option value="">All Floors</option>
              {floorLevels.map((fl) => (
                <option key={fl} value={fl!}>Floor {fl}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ── Category Chips ────────────────────────────────── */}
      <section className="dir-chips-row" aria-label="Category quick filters">
        <button
          id="stores-cat-all"
          className={`dir-cat-chip ${!selectedCategory ? 'active' : ''}`}
          onClick={() => setSelectedCategory('')}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            id={`stores-cat-${cat.id}`}
            className={`dir-cat-chip ${selectedCategory === cat.id ? 'active' : ''}`}
            onClick={() => setSelectedCategory(selectedCategory === cat.id ? '' : cat.id)}
            style={{
              '--chip-color': cat.color || 'var(--color-primary)',
            } as React.CSSProperties}
          >
            <span
              className="dir-cat-dot"
              style={{ background: cat.color || 'var(--color-primary)' }}
            />
            {cat.name}
          </button>
        ))}
      </section>

      {/* ── Stores List / Grid ───────────────────────────── */}
      <section
        className={viewMode === 'grid' ? 'stores-grid-view' : 'stores-list-view'}
        aria-label="Exhibitor listings"
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass skeleton store-card-skeleton" />
          ))
        ) : filteredStores.length === 0 ? (
          <div className="dir-empty-state">
            <Store size={40} style={{ opacity: 0.3 }} />
            <h3>No Exhibitors Found</h3>
            <p>Try adjusting your search or filter criteria.</p>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setSearchQuery(''); setSelectedCategory(''); setSelectedFloor(''); }}
            >
              Clear Filters
            </button>
          </div>
        ) : viewMode === 'list' ? (
          filteredStores.map((st, index) => {
            const openStatus = isOpen(st.opening_time, st.closing_time);
            return (
              <Link
                key={st.id}
                to={`/stores/${st.id}`}
                className="store-list-card"
                id={`store-list-item-${st.id}`}
                style={{
                  '--accent': st.categories?.color || 'var(--color-primary)',
                  ...(query || selectedCategory || selectedFloor
                    ? { animation: 'none' }
                    : { animationDelay: `${Math.min(index * 0.04, 0.4)}s` }),
                } as unknown as React.CSSProperties}
              >
                {/* Logo */}
                {st.logo_url ? (
                  <img src={st.logo_url} alt={st.name} className="store-list-logo" loading="lazy" decoding="async" />
                ) : (
                  <div
                    className="store-list-logo-ph"
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                    }}
                  >
                    <Store size={22} color={st.categories?.color || 'var(--color-muted)'} />
                  </div>
                )}

                {/* Main info */}
                <div className="store-list-body">
                  <div className="store-list-title-row">
                    <h2 className="store-list-name">{st.name}</h2>
                    {st.categories && (
                      <span
                        className="store-list-badge"
                        style={{
                          background: `${st.categories.color}18`,
                          color: st.categories.color || 'inherit',
                          borderColor: `${st.categories.color}35`,
                        }}
                      >
                        {st.categories.name}
                      </span>
                    )}
                    {(st.phone || st.website) && (
                      <Sparkles size={13} color="var(--color-warning)" style={{ flexShrink: 0 }} />
                    )}
                  </div>

                  <p className="store-list-desc">
                    {st.description || 'No description provided.'}
                  </p>

                  <div className="store-list-meta">
                    <span className="store-meta-chip">
                      <MapPin size={12} />
                      Floor {st.floor || '1'}
                      {st.exhibitions ? ` · ${st.exhibitions.title}` : ''}
                    </span>
                    <span className="store-meta-chip">
                      <Clock size={12} />
                      {st.opening_time ? st.opening_time.substring(0, 5) : '09:00'} –{' '}
                      {st.closing_time ? st.closing_time.substring(0, 5) : '18:00'}
                    </span>
                    {openStatus !== null && (
                      <span className={`store-open-badge ${openStatus ? 'open' : 'closed'}`}>
                        {openStatus ? '● Open Now' : '● Closed'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="store-list-arrow">
                  <ChevronRight size={18} />
                </div>
              </Link>
            );
          })
        ) : (
          /* Grid view */
          filteredStores.map((st, index) => (
            <Link
              key={st.id}
              to={`/stores/${st.id}`}
              className="store-grid-card"
              id={`store-grid-item-${st.id}`}
              style={{
                ...(query || selectedCategory || selectedFloor
                  ? { animation: 'none' }
                  : { animationDelay: `${Math.min(index * 0.04, 0.4)}s` }),
              }}
            >
              <div
                className="store-grid-top"
                style={{
                  background: `linear-gradient(135deg, ${st.categories?.color || 'var(--color-surface2)'}22 0%, transparent 70%)`,
                }}
              >
                {st.logo_url ? (
                  <img src={st.logo_url} alt={st.name} className="store-grid-logo" loading="lazy" decoding="async" />
                ) : (
                  <div className="store-grid-logo-ph">
                    <Store size={26} color={st.categories?.color || 'var(--color-muted)'} />
                  </div>
                )}
                {(st.phone || st.website) && (
                  <span className="store-grid-promo">
                    <Star size={10} fill="currentColor" />
                  </span>
                )}
              </div>
              <div className="store-grid-body">
                <h3 className="store-grid-name">{st.name}</h3>
                {st.categories && (
                  <span
                    className="store-grid-cat"
                    style={{
                      background: `${st.categories.color}15`,
                      color: st.categories.color || 'var(--color-muted)',
                    }}
                  >
                    {st.categories.name}
                  </span>
                )}
                <span className="store-grid-floor">
                  <MapPin size={11} /> Floor {st.floor || '1'}
                </span>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
