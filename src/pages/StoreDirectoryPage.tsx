import { useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, MapPin, Clock, ArrowLeft, Store,
  Filter, ChevronRight, LayoutGrid, List,
  Building2, CheckSquare, Square, Navigation, CheckCircle2,
  ChevronDown, ChevronUp, Compass, X, PlusCircle
} from 'lucide-react';
import { supabase, type Store as StoreType, type Category, type NavigationNode } from '../lib/supabase';
import { extractBlocksFromNodes, matchStoreToBlock, type BlockEntity } from '../utils/blocks';

type ViewMode = 'blocks' | 'list' | 'grid';

const LOCAL_STORAGE_SELECTED_STALLS = 'exhibition_selected_stalls_v1';

export function StoreDirectoryPage() {
  const navigate = useNavigate();
  const [stores, setStores] = useState<StoreType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [nodes, setNodes] = useState<NavigationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const [selectedFloor, setSelectedFloor] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('blocks');

  // Stores marked to visit by user
  const [selectedStallIds, setSelectedStallIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_SELECTED_STALLS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Collapsed state for block sections in 'blocks' view
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({});

  // Notification toast when a block is auto-marked
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

  // Save selected stalls to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_SELECTED_STALLS, JSON.stringify(selectedStallIds));
    } catch (e) {
      console.warn('Could not save selected stalls:', e);
    }
  }, [selectedStallIds]);

  async function loadData() {
    try {
      setLoading(true);
      const [storesRes, categoriesRes, nodesRes] = await Promise.all([
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
        supabase.from('navigation_nodes').select('*'),
      ]);

      setStores(storesRes.data || []);
      setCategories(categoriesRes.data || []);
      setNodes(nodesRes.data || []);
    } catch (err) {
      console.error('Error loading store directory data:', err);
      setStores([]);
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }

  // Real building blocks from navigation nodes (KML / admin blocks)
  const realBlocks: BlockEntity[] = useMemo(() => {
    return extractBlocksFromNodes(nodes);
  }, [nodes]);

  // Pre-calculate block association for all real stores
  const storesWithBlock = useMemo(() => {
    return stores.map((s) => {
      const matched = matchStoreToBlock(s, realBlocks);
      const fallbackBlock: BlockEntity = {
        id: `block-${s.id}`,
        name: s.floor && s.floor.toLowerCase().includes('block') ? s.floor.split('·')[0].trim() : (s.floor || 'General Stalls'),
        floor: s.floor || '1',
        latitude: s.latitude || 6.535472,
        longitude: s.longitude || 80.401000,
        color: '#06b6d4',
      };
      return {
        store: s,
        block: matched || fallbackBlock,
      };
    });
  }, [stores, realBlocks]);

  // Distinct blocks that actually have stalls in the database
  const activeBlocks = useMemo(() => {
    const map = new Map<string, BlockEntity>();
    storesWithBlock.forEach((i) => {
      if (!map.has(i.block.id)) {
        map.set(i.block.id, i.block);
      }
    });
    return Array.from(map.values());
  }, [storesWithBlock]);

  // Which blocks need to be visited based on user-selected stalls
  const markedBlocks = useMemo(() => {
    const blockMap = new Map<string, { block: BlockEntity; stallCount: number; stalls: StoreType[] }>();
    storesWithBlock.forEach(({ store, block }) => {
      if (selectedStallIds.includes(store.id)) {
        if (!blockMap.has(block.id)) {
          blockMap.set(block.id, { block, stallCount: 0, stalls: [] });
        }
        const entry = blockMap.get(block.id)!;
        entry.stallCount += 1;
        entry.stalls.push(store);
      }
    });
    return Array.from(blockMap.values());
  }, [storesWithBlock, selectedStallIds]);

  const markedBlockIds = useMemo(() => {
    return new Set(markedBlocks.map((mb) => mb.block.id));
  }, [markedBlocks]);

  const query = searchQuery.trim().toLowerCase();

  const filteredStoresWithBlock = useMemo(() => {
    return storesWithBlock.filter(({ store, block }) => {
      const matchesSearch =
        !query ||
        store.name.toLowerCase().includes(query) ||
        (store.description && store.description.toLowerCase().includes(query)) ||
        block.name.toLowerCase().includes(query);

      const matchesCategory = !selectedCategory || store.category_id === selectedCategory;
      const matchesBlock = !selectedBlockId || block.id === selectedBlockId;
      const matchesFloor = !selectedFloor || store.floor === selectedFloor;

      return matchesSearch && matchesCategory && matchesBlock && matchesFloor;
    });
  }, [storesWithBlock, query, selectedCategory, selectedBlockId, selectedFloor]);

  // Group stores by Block for the 'blocks' view — ONLY include blocks that have matching stalls
  const groupedByBlock = useMemo(() => {
    const groups: { block: BlockEntity; items: typeof storesWithBlock }[] = [];
    const blockBuckets = new Map<string, typeof storesWithBlock>();

    filteredStoresWithBlock.forEach((item) => {
      const bId = item.block.id;
      if (!blockBuckets.has(bId)) {
        blockBuckets.set(bId, []);
      }
      blockBuckets.get(bId)!.push(item);
    });

    blockBuckets.forEach((items) => {
      if (items.length > 0) {
        groups.push({ block: items[0].block, items });
      }
    });

    return groups;
  }, [filteredStoresWithBlock]);

  const floorLevels = useMemo(() => {
    return Array.from(
      new Set(stores.map((s) => s.floor).filter(Boolean))
    ).sort();
  }, [stores]);

  const toggleSelectStall = (store: StoreType, block: BlockEntity, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const isCurrentlySelected = selectedStallIds.includes(store.id);

    if (isCurrentlySelected) {
      setSelectedStallIds((prev) => prev.filter((id) => id !== store.id));
    } else {
      setSelectedStallIds((prev) => [...prev, store.id]);
      setToastMessage(`✓ ${store.name.split('—')[0].trim()} selected! ${block.name} is marked to visit on map.`);
      setTimeout(() => setToastMessage(null), 3800);
    }
  };

  const toggleBlockCollapse = (blockId: string) => {
    setCollapsedBlocks((prev) => ({
      ...prev,
      [blockId]: !prev[blockId],
    }));
  };

  const selectAllInBlock = (blockId: string, items: typeof storesWithBlock) => {
    const idsToAdd = items.map((i) => i.store.id);
    setSelectedStallIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
    const block = realBlocks.find((b) => b.id === blockId) || items[0]?.block;
    if (block) {
      setToastMessage(`✓ All stalls in ${block.name} selected! ${block.name} is marked to visit on map.`);
      setTimeout(() => setToastMessage(null), 3800);
    }
  };

  const deselectAllInBlock = (items: typeof storesWithBlock) => {
    const idsToRemove = new Set(items.map((i) => i.store.id));
    setSelectedStallIds((prev) => prev.filter((id) => !idsToRemove.has(id)));
  };

  const isOpen = (openingTime?: string | null, closingTime?: string | null) => {
    if (!openingTime || !closingTime) return null;
    const now = new Date();
    const [oh, om] = openingTime.split(':').map(Number);
    const [ch, cm] = closingTime.split(':').map(Number);
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= oh * 60 + om && mins < ch * 60 + cm;
  };

  return (
    <div className="profile-page store-dir-enhanced" style={{ maxWidth: 880, paddingBottom: selectedStallIds.length > 0 ? '7.5rem' : '3rem' }}>

      {/* ── Toast Notification Banner ─────────────────────── */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '1rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(6, 182, 212, 0.6)',
          boxShadow: '0 8px 32px rgba(6, 182, 212, 0.35)',
          backdropFilter: 'blur(12px)',
          color: '#fff',
          borderRadius: '12px',
          padding: '0.65rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          fontSize: '0.86rem',
          fontWeight: 600,
          animation: 'fadeIn 0.2s ease-out',
        }}>
          <CheckCircle2 size={18} color="#22d3ee" />
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: 0, marginLeft: 8 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Back Navigation ─────────────────────────────── */}
      <Link to="/" className="dir-back-link" id="stores-back-btn">
        <ArrowLeft size={16} />
        Back to Home
      </Link>

      {/* ── Page Header ─────────────────────────────────── */}
      <header className="dir-page-header">
        <div className="dir-header-main">
          <div className="dir-header-icon dir-header-icon-cyan">
            <Building2 size={22} color="#fff" />
          </div>
          <div>
            <h1 className="dir-page-title">Exhibition Stall Directory</h1>
            <p className="dir-page-desc">
              Browse exhibition stalls organized by building blocks. Select any stall to mark its block on the campus map!
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
          <div className="dir-count-badge">
            {loading ? '…' : `${filteredStoresWithBlock.length} Stalls (${activeBlocks.length} Blocks)`}
          </div>
          {markedBlocks.length > 0 && (
            <span style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#06b6d4',
              background: 'rgba(6, 182, 212, 0.15)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              padding: '0.2rem 0.55rem',
              borderRadius: '6px'
            }}>
              🎯 {markedBlocks.length} {markedBlocks.length === 1 ? 'Block' : 'Blocks'} to visit
            </span>
          )}
        </div>
      </header>

      {/* ── Search & Filter Panel ────────────────────────── */}
      <section className="glass dir-filter-panel" id="stores-filter-panel" style={{ marginBottom: '1.25rem' }}>
        <div className="dir-search-row">
          <div className="search-wrap dir-search-wrap">
            <Search size={18} className="search-icon" />
            <input
              id="stores-search-input"
              type="text"
              placeholder="Search by stall name, keyword, or block..."
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* View toggle: Blocks / List / Grid */}
          <div className="dir-view-toggle">
            <button
              id="stores-view-blocks"
              className={`dir-view-btn ${viewMode === 'blocks' ? 'active' : ''}`}
              onClick={() => setViewMode('blocks')}
              title="Group by Building Blocks"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.75rem', fontSize: '0.8rem', fontWeight: 600 }}
            >
              <Building2 size={15} />
              <span>Blocks</span>
            </button>
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
          {/* Building Block Filter */}
          <div className="form-group" style={{ flex: 1.2 }}>
            <label className="form-label">
              <Building2 size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--color-primary)' }} />
              Building / Block
            </label>
            <select
              id="stores-block-filter"
              className="form-select"
              value={selectedBlockId}
              onChange={(e) => setSelectedBlockId(e.target.value)}
              style={{ fontWeight: 600 }}
            >
              <option value="">All Blocks ({activeBlocks.length})</option>
              {activeBlocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
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

          {/* Floor Level Filter */}
          <div className="form-group" style={{ flex: 0.8 }}>
            <label className="form-label">
              <MapPin size={11} style={{ display: 'inline', marginRight: 4 }} />
              Floor
            </label>
            <select
              id="stores-floor-filter"
              className="form-select"
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
            >
              <option value="">All Floors</option>
              {floorLevels.map((fl) => (
                <option key={fl} value={fl!}>{fl}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ── Active Block Chips ────────────────────────────── */}
      {activeBlocks.length > 0 && (
        <section className="dir-chips-row" style={{ marginBottom: '1rem', overflowX: 'auto', paddingBottom: '0.4rem' }}>
          <button
            className={`dir-cat-chip ${!selectedBlockId ? 'active' : ''}`}
            onClick={() => setSelectedBlockId('')}
            style={{ whiteSpace: 'nowrap', fontWeight: 600 }}
          >
            All Blocks ({activeBlocks.length})
          </button>
          {activeBlocks.map((b) => {
            const isMarked = markedBlockIds.has(b.id);
            const isSelected = selectedBlockId === b.id;
            const count = storesWithBlock.filter((i) => i.block.id === b.id).length;
            return (
              <button
                key={b.id}
                className={`dir-cat-chip ${isSelected ? 'active' : ''}`}
                onClick={() => setSelectedBlockId(selectedBlockId === b.id ? '' : b.id)}
                style={{
                  '--chip-color': b.color,
                  whiteSpace: 'nowrap',
                  fontWeight: isMarked ? 700 : 500,
                  border: isMarked ? `1px solid ${b.color}` : undefined,
                  background: isMarked && !isSelected ? `${b.color}18` : undefined,
                } as React.CSSProperties}
              >
                <span className="dir-cat-dot" style={{ background: b.color }} />
                {b.name} ({count})
                {isMarked && <span style={{ marginLeft: 4, color: b.color }}>🎯</span>}
              </button>
            );
          })}
        </section>
      )}

      {/* ── Empty State when Database has No Stores ────────── */}
      {!loading && stores.length === 0 ? (
        <div
          className="glass"
          style={{
            padding: '3.5rem 1.5rem',
            textAlign: 'center',
            borderRadius: '16px',
            border: '1px solid var(--color-border)',
          }}
        >
          <Building2 size={46} style={{ opacity: 0.35, margin: '0 auto 1rem auto', color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>
            No Exhibition Stalls Added Yet
          </h2>
          <p style={{ color: 'var(--color-muted)', maxWidth: 480, margin: '0 auto 1.5rem auto', fontSize: '0.88rem', lineHeight: 1.5 }}>
            You have not added any stalls to the database yet. You can manually add stores and assign which block and floor they belong to, or import a KML file in the Admin Panel.
          </p>
          <a
            href="/admin/stores"
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.4rem',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            <PlusCircle size={17} />
            Add Stalls in Admin Panel
          </a>
        </div>
      ) : viewMode === 'blocks' ? (
        /* ── Block-Centric View Mode (Grouped by Block) ─────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {groupedByBlock.length === 0 ? (
            <div className="dir-empty-state">
              <Store size={36} style={{ opacity: 0.3 }} />
              <h3>No Stalls Found</h3>
              <p>No stalls match your search or filter criteria.</p>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('');
                  setSelectedBlockId('');
                  setSelectedFloor('');
                }}
              >
                Clear Filters
              </button>
            </div>
          ) : (
            groupedByBlock.map(({ block, items }) => {
              const isMarked = markedBlockIds.has(block.id);
              const isCollapsed = Boolean(collapsedBlocks[block.id]);
              const selectedInThisBlock = items.filter((i) => selectedStallIds.includes(i.store.id)).length;

              return (
                <section
                  key={block.id}
                  className="glass"
                  style={{
                    borderRadius: '16px',
                    padding: '1.25rem',
                    border: isMarked ? `1.5px solid ${block.color}` : '1px solid var(--color-border)',
                    boxShadow: isMarked ? `0 6px 28px ${block.color}25` : undefined,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {/* Block Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                      paddingBottom: isCollapsed ? '0' : '0.85rem',
                      borderBottom: isCollapsed ? 'none' : '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: '10px',
                          background: `${block.color}22`,
                          border: `1.5px solid ${block.color}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: block.color,
                          fontWeight: 800,
                          fontSize: '0.95rem',
                          flexShrink: 0,
                        }}
                      >
                        <Building2 size={20} />
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--color-text)' }}>
                            {block.name}
                          </h2>
                          {isMarked ? (
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                color: '#fff',
                                background: block.color,
                                padding: '0.15rem 0.5rem',
                                borderRadius: '6px',
                                boxShadow: `0 2px 8px ${block.color}66`,
                              }}
                            >
                              🎯 Marked to Visit ({selectedInThisBlock} {selectedInThisBlock === 1 ? 'stall' : 'stalls'})
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                color: 'var(--color-muted)',
                                background: 'rgba(255,255,255,0.05)',
                                padding: '0.15rem 0.45rem',
                                borderRadius: '6px',
                              }}
                            >
                              {items.length} {items.length === 1 ? 'Stall' : 'Stalls'}
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '0.2rem 0 0 0' }}>
                          Floor: {block.floor || '1'} · Map Coordinates: {block.latitude.toFixed(6)}, {block.longitude.toFixed(6)}
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {items.length > 0 && (
                        selectedInThisBlock === items.length ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem', color: 'var(--color-warning)' }}
                            onClick={() => deselectAllInBlock(items)}
                            title="Deselect all stalls in this block"
                          >
                            Deselect Block
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem', color: block.color }}
                            onClick={() => selectAllInBlock(block.id, items)}
                            title="Mark all stalls in this block to visit"
                          >
                            Select All ({items.length})
                          </button>
                        )
                      )}

                      {/* Locate block on map button */}
                      {items[0] && (
                        <button
                          className="btn btn-primary btn-sm"
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.35rem 0.75rem',
                            background: `${block.color}25`,
                            color: block.color,
                            borderColor: `${block.color}55`,
                            fontWeight: 700,
                          }}
                          onClick={() => navigate(`/map?to=${items[0].store.id}`)}
                          title={`View ${block.name} on Campus Map`}
                        >
                          <Navigation size={13} style={{ marginRight: 4 }} />
                          Map
                        </button>
                      )}

                      <button
                        className="btn btn-ghost btn-icon"
                        style={{ padding: '0.35rem' }}
                        onClick={() => toggleBlockCollapse(block.id)}
                        title={isCollapsed ? 'Expand Block' : 'Collapse Block'}
                      >
                        {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Stalls in this Block */}
                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '0.85rem' }}>
                      {items.map(({ store }) => {
                        const isSelected = selectedStallIds.includes(store.id);
                        const openStatus = isOpen(store.opening_time, store.closing_time);

                        return (
                          <div
                            key={store.id}
                            className="store-list-card"
                            style={{
                              border: isSelected ? '1.5px solid var(--color-accent)' : undefined,
                              background: isSelected ? 'rgba(6, 182, 212, 0.08)' : undefined,
                              boxShadow: isSelected ? '0 4px 20px rgba(6, 182, 212, 0.2)' : undefined,
                              padding: '0.85rem 1rem',
                            }}
                          >
                            {/* Checkbox: Select to Visit (marks the block!) */}
                            <button
                              type="button"
                              onClick={(e) => toggleSelectStall(store, block, e)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                padding: '0.2rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: isSelected ? '#06b6d4' : 'var(--color-muted)',
                                flexShrink: 0,
                              }}
                              title={isSelected ? 'Remove from visit list' : `Select to visit ${block.name}`}
                            >
                              {isSelected ? <CheckSquare size={22} color="#06b6d4" /> : <Square size={22} />}
                            </button>

                            <Link
                              to={`/stores/${store.id}`}
                              style={{
                                display: 'flex',
                                flex: 1,
                                alignItems: 'center',
                                gap: '0.85rem',
                                textDecoration: 'none',
                                color: 'inherit',
                                minWidth: 0,
                              }}
                            >
                              {store.logo_url ? (
                                <img src={store.logo_url} alt={store.name} className="store-list-logo" loading="lazy" />
                              ) : (
                                <div
                                  className="store-list-logo-ph"
                                  style={{ background: `${block.color}15`, width: 44, height: 44, borderRadius: 8 }}
                                >
                                  <Store size={20} color={block.color} />
                                </div>
                              )}

                              <div className="store-list-body" style={{ flex: 1, minWidth: 0, padding: 0 }}>
                                <div className="store-list-title-row" style={{ marginBottom: '0.2rem' }}>
                                  <h3 className="store-list-name" style={{ fontSize: '0.96rem', fontWeight: 700 }}>
                                    {store.name}
                                  </h3>
                                  {store.categories && (
                                    <span
                                      className="store-list-badge"
                                      style={{
                                        background: `${store.categories.color}18`,
                                        color: store.categories.color || 'inherit',
                                        borderColor: `${store.categories.color}35`,
                                        fontSize: '0.7rem',
                                      }}
                                    >
                                      {store.categories.name}
                                    </span>
                                  )}
                                  <span
                                    style={{
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      padding: '0.15rem 0.4rem',
                                      borderRadius: '4px',
                                      background: `${block.color}20`,
                                      color: block.color,
                                    }}
                                  >
                                    {block.name}
                                  </span>
                                </div>

                                <p className="store-list-desc" style={{ fontSize: '0.82rem', marginBottom: '0.35rem' }}>
                                  {store.description || 'No description provided.'}
                                </p>

                                <div className="store-list-meta" style={{ gap: '0.6rem' }}>
                                  <span className="store-meta-chip" style={{ fontSize: '0.72rem' }}>
                                    <Building2 size={11} /> {block.name}
                                  </span>
                                  {store.floor && (
                                    <span className="store-meta-chip" style={{ fontSize: '0.72rem' }}>
                                      <MapPin size={11} /> {store.floor}
                                    </span>
                                  )}
                                  <span className="store-meta-chip" style={{ fontSize: '0.72rem' }}>
                                    <Clock size={11} />
                                    {store.opening_time ? store.opening_time.substring(0, 5) : '09:00'} –{' '}
                                    {store.closing_time ? store.closing_time.substring(0, 5) : '18:00'}
                                  </span>
                                  {openStatus !== null && (
                                    <span className={`store-open-badge ${openStatus ? 'open' : 'closed'}`} style={{ fontSize: '0.68rem' }}>
                                      {openStatus ? '● Open' : '● Closed'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <ChevronRight size={18} color="var(--color-muted)" style={{ flexShrink: 0 }} />
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      ) : (
        /* ── Standard List / Grid View ───────────────────────── */
        <section className={viewMode === 'grid' ? 'stores-grid-view' : 'stores-list-view'}>
          {filteredStoresWithBlock.length === 0 ? (
            <div className="dir-empty-state">
              <Store size={40} style={{ opacity: 0.3 }} />
              <h3>No Stalls Found</h3>
              <p>Try adjusting your search query, block, or category filters.</p>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('');
                  setSelectedBlockId('');
                  setSelectedFloor('');
                }}
              >
                Clear Filters
              </button>
            </div>
          ) : viewMode === 'list' ? (
            filteredStoresWithBlock.map(({ store, block }) => {
              const isSelected = selectedStallIds.includes(store.id);
              const openStatus = isOpen(store.opening_time, store.closing_time);

              return (
                <div
                  key={store.id}
                  className="store-list-card"
                  style={{
                    border: isSelected ? '1.5px solid var(--color-accent)' : undefined,
                    background: isSelected ? 'rgba(6, 182, 212, 0.08)' : undefined,
                    padding: '0.85rem 1rem',
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => toggleSelectStall(store, block, e)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '0.2rem',
                      cursor: 'pointer',
                      color: isSelected ? '#06b6d4' : 'var(--color-muted)',
                      flexShrink: 0,
                    }}
                    title={isSelected ? 'Remove from visit list' : `Select to visit ${block.name}`}
                  >
                    {isSelected ? <CheckSquare size={22} color="#06b6d4" /> : <Square size={22} />}
                  </button>

                  <Link
                    to={`/stores/${store.id}`}
                    style={{
                      display: 'flex',
                      flex: 1,
                      alignItems: 'center',
                      gap: '0.85rem',
                      textDecoration: 'none',
                      color: 'inherit',
                      minWidth: 0,
                    }}
                  >
                    {store.logo_url ? (
                      <img src={store.logo_url} alt={store.name} className="store-list-logo" loading="lazy" />
                    ) : (
                      <div className="store-list-logo-ph" style={{ background: `${block.color}15`, width: 44, height: 44, borderRadius: 8 }}>
                        <Store size={20} color={block.color} />
                      </div>
                    )}

                    <div className="store-list-body" style={{ flex: 1, minWidth: 0, padding: 0 }}>
                      <div className="store-list-title-row" style={{ marginBottom: '0.2rem' }}>
                        <h2 className="store-list-name" style={{ fontSize: '0.96rem', fontWeight: 700 }}>
                          {store.name}
                        </h2>
                        {store.categories && (
                          <span
                            className="store-list-badge"
                            style={{
                              background: `${store.categories.color}18`,
                              color: store.categories.color || 'inherit',
                              borderColor: `${store.categories.color}35`,
                              fontSize: '0.7rem',
                            }}
                          >
                            {store.categories.name}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '0.15rem 0.4rem',
                            borderRadius: '4px',
                            background: `${block.color}20`,
                            color: block.color,
                          }}
                        >
                          {block.name}
                        </span>
                      </div>

                      <p className="store-list-desc" style={{ fontSize: '0.82rem', marginBottom: '0.35rem' }}>
                        {store.description || 'No description provided.'}
                      </p>

                      <div className="store-list-meta" style={{ gap: '0.6rem' }}>
                        <span className="store-meta-chip" style={{ fontSize: '0.72rem' }}>
                          <Building2 size={11} /> {block.name}
                        </span>
                        {store.floor && (
                          <span className="store-meta-chip" style={{ fontSize: '0.72rem' }}>
                            <MapPin size={11} /> {store.floor}
                          </span>
                        )}
                        <span className="store-meta-chip" style={{ fontSize: '0.72rem' }}>
                          <Clock size={11} />
                          {store.opening_time ? store.opening_time.substring(0, 5) : '09:00'} –{' '}
                          {store.closing_time ? store.closing_time.substring(0, 5) : '18:00'}
                        </span>
                        {openStatus !== null && (
                          <span className={`store-open-badge ${openStatus ? 'open' : 'closed'}`} style={{ fontSize: '0.68rem' }}>
                            {openStatus ? '● Open' : '● Closed'}
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronRight size={18} color="var(--color-muted)" style={{ flexShrink: 0 }} />
                  </Link>
                </div>
              );
            })
          ) : (
            /* Grid View */
            filteredStoresWithBlock.map(({ store, block }) => {
              const isSelected = selectedStallIds.includes(store.id);

              return (
                <div
                  key={store.id}
                  className="store-grid-card"
                  style={{
                    position: 'relative',
                    border: isSelected ? '1.5px solid var(--color-accent)' : undefined,
                    boxShadow: isSelected ? '0 4px 18px rgba(6, 182, 212, 0.2)' : undefined,
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => toggleSelectStall(store, block, e)}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      zIndex: 3,
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px',
                      cursor: 'pointer',
                      color: isSelected ? '#06b6d4' : '#fff',
                    }}
                    title={isSelected ? 'Deselect stall' : 'Mark to visit'}
                  >
                    {isSelected ? <CheckSquare size={18} color="#06b6d4" /> : <Square size={18} />}
                  </button>

                  <Link to={`/stores/${store.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div
                      className="store-grid-top"
                      style={{
                        background: `linear-gradient(135deg, ${block.color}25 0%, transparent 70%)`,
                      }}
                    >
                      {store.logo_url ? (
                        <img src={store.logo_url} alt={store.name} className="store-grid-logo" loading="lazy" />
                      ) : (
                        <div className="store-grid-logo-ph">
                          <Store size={26} color={block.color} />
                        </div>
                      )}
                    </div>
                    <div className="store-grid-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.35rem',
                            borderRadius: '4px',
                            background: `${block.color}20`,
                            color: block.color,
                          }}
                        >
                          {block.name}
                        </span>
                        {store.categories && (
                          <span className="store-grid-cat" style={{ fontSize: '0.68rem' }}>
                            {store.categories.name}
                          </span>
                        )}
                      </div>
                      <h3 className="store-grid-name" style={{ fontSize: '0.88rem' }}>
                        {store.name}
                      </h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.3rem 0 0 0', lineHeight: 1.3 }}>
                        {store.description ? store.description.slice(0, 60) + '…' : 'Exhibition stall'}
                      </p>
                    </div>
                  </Link>
                </div>
              );
            })
          )}
        </section>
      )}

      {/* ── Floating Visit Planner Bottom Dock ────────────── */}
      {selectedStallIds.length > 0 && (
        <aside
          style={{
            position: 'fixed',
            bottom: '1.25rem',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'calc(100% - 2rem)',
            maxWidth: '760px',
            zIndex: 900,
            background: 'rgba(15, 23, 42, 0.94)',
            border: '1.5px solid rgba(6, 182, 212, 0.5)',
            boxShadow: '0 12px 38px rgba(0, 0, 0, 0.6), 0 0 25px rgba(6, 182, 212, 0.25)',
            backdropFilter: 'blur(16px)',
            borderRadius: '16px',
            padding: '0.85rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            animation: 'fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          aria-label="Planned exhibition visits"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flex: 1, minWidth: '240px' }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: '10px',
                background: 'rgba(6, 182, 212, 0.18)',
                border: '1px solid rgba(6, 182, 212, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Compass size={22} color="#22d3ee" />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fff' }}>
                  🎯 {selectedStallIds.length} {selectedStallIds.length === 1 ? 'Stall' : 'Stalls'} Selected
                </span>
                <span style={{ fontSize: '0.8rem', color: '#22d3ee', fontWeight: 700 }}>
                  → {markedBlocks.length} {markedBlocks.length === 1 ? 'Block' : 'Blocks'} Marked
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                {markedBlocks.map(({ block, stallCount }) => (
                  <span
                    key={block.id}
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      background: `${block.color}25`,
                      color: block.color,
                      border: `1px solid ${block.color}60`,
                      padding: '0.1rem 0.45rem',
                      borderRadius: '5px',
                    }}
                  >
                    {block.name} ({stallCount})
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.8rem', color: 'var(--color-muted)', padding: '0.45rem 0.75rem' }}
              onClick={() => setSelectedStallIds([])}
            >
              Clear
            </button>

            <button
              className="btn btn-primary"
              style={{
                fontSize: '0.85rem',
                fontWeight: 800,
                padding: '0.55rem 1.2rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 14px rgba(6, 182, 212, 0.4)',
              }}
              onClick={() => {
                const firstSelectedId = selectedStallIds[0];
                if (firstSelectedId) {
                  navigate(`/map?to=${firstSelectedId}`);
                } else {
                  navigate('/map');
                }
              }}
            >
              <Navigation size={15} />
              <span>Locate on Map ({markedBlocks[0]?.block.name || 'Block'})</span>
            </button>
          </div>
        </aside>
      )}

    </div>
  );
}
