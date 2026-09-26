import { useEffect, useState, useMemo } from 'react';
import {
  Building2, Plus, Edit2, Trash2, Search,
  Upload, Navigation2, QrCode, Store as StoreIcon, Layers
} from 'lucide-react';
import { supabase, type NavigationNode, type Store } from '../../lib/supabase';
import { AdminTable, type Column } from '../../components/admin/AdminTable';
import { AdminModal } from '../../components/admin/AdminModal';
import { FormMapPicker } from '../../components/admin/FormMapPicker';
import { KmlImportModal } from '../../components/admin/KmlImportModal';
import { QrCodeModal } from '../../components/admin/QrCodeModal';
import { type QrCalibrateTarget } from '../../utils/qrCodeGenerator';
import {
  extractBlocksFromNodes,
  generateFloorList,
  getBlockFloorOptions,
  matchStoreToBlock,
  type BlockEntity,
} from '../../utils/blocks';

export function AdminBlocksPage() {
  const [allNodes, setAllNodes] = useState<NavigationNode[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState<boolean>(false);

  // Modals state
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isKmlModalOpen, setIsKmlModalOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<QrCalibrateTarget | null>(null);

  // Floor setup inside block modal (defaults to 1 floor: Ground Floor)
  const [floorCount, setFloorCount] = useState<number>(1);
  const [includeGround, setIncludeGround] = useState<boolean>(true);
  const [blockFloors, setBlockFloors] = useState<string[]>(['Ground Floor']);
  const [newFloorInput, setNewFloorInput] = useState('');

  const [currentBlock, setCurrentBlock] = useState<Partial<NavigationNode> | null>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    try {
      setLoading(true);
      const [nodesRes, storesRes] = await Promise.all([
        supabase.from('navigation_nodes').select('*').order('created_at', { ascending: false }),
        supabase.from('stores').select('*'),
      ]);

      setAllNodes(nodesRes.data || []);
      setStores(storesRes.data || []);
    } catch (err) {
      console.error('Error loading blocks data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Real building blocks extracted from navigation_nodes
  const blocks: BlockEntity[] = useMemo(() => {
    return extractBlocksFromNodes(allNodes);
  }, [allNodes]);

  // Count stalls under each block
  const stallsCountByBlock = useMemo(() => {
    const counts = new Map<string, number>();
    blocks.forEach((b) => counts.set(b.id, 0));

    stores.forEach((st) => {
      const matched = matchStoreToBlock(st, blocks);
      if (matched && counts.has(matched.id)) {
        counts.set(matched.id, (counts.get(matched.id) || 0) + 1);
      }
    });

    return counts;
  }, [blocks, stores]);

  const query = searchQuery.trim().toLowerCase();
  const filteredBlocks = useMemo(() => {
    if (!query) return blocks;
    return blocks.filter((b) =>
      b.name.toLowerCase().includes(query) ||
      (b.floor && b.floor.toLowerCase().includes(query))
    );
  }, [blocks, query]);

  const handleOpenAdd = () => {
    const defaultFloors = generateFloorList(1, true);
    setFloorCount(1);
    setIncludeGround(true);
    setBlockFloors(defaultFloors);
    setNewFloorInput('');

    setCurrentBlock({
      label: `Block ${blocks.length + 1}`,
      floor: defaultFloors.join(', '),
      latitude: 6.535472,
      longitude: 80.401000,
      type: 'poi',
    });
    setFormError('');
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (block: BlockEntity) => {
    const originalNode = allNodes.find((n) => n.id === block.id);
    const resolvedFloors = getBlockFloorOptions(originalNode || block);
    const hasGround = resolvedFloors.some((f) => f.toLowerCase().includes('ground'));

    setFloorCount(resolvedFloors.length);
    setIncludeGround(hasGround);
    setBlockFloors(resolvedFloors);
    setNewFloorInput('');

    if (originalNode) {
      setCurrentBlock(originalNode);
    } else {
      setCurrentBlock({
        id: block.id,
        label: block.name,
        floor: resolvedFloors.join(', '),
        latitude: block.latitude,
        longitude: block.longitude,
        type: 'poi',
      });
    }
    setFormError('');
    setIsFormModalOpen(true);
  };

  const handleFloorConfigChange = (newCount: number, newHasGround: boolean) => {
    setFloorCount(newCount);
    setIncludeGround(newHasGround);
    const generated = generateFloorList(newCount, newHasGround);
    setBlockFloors(generated);
  };

  const handleRemoveFloor = (floorToRemove: string) => {
    if (blockFloors.length <= 1) return;
    setBlockFloors((prev) => prev.filter((f) => f !== floorToRemove));
  };

  const handleAddCustomFloor = () => {
    const trimmed = newFloorInput.trim();
    if (!trimmed) return;
    if (!blockFloors.includes(trimmed)) {
      setBlockFloors((prev) => [...prev, trimmed]);
    }
    setNewFloorInput('');
  };

  const handleOpenDelete = (block: BlockEntity) => {
    const originalNode = allNodes.find((n) => n.id === block.id);
    setCurrentBlock(originalNode || { id: block.id, label: block.name });
    setIsDeleteModalOpen(true);
  };

  const handleOpenQrCode = (block: BlockEntity) => {
    setQrTarget({
      id: block.id,
      name: block.name,
      type: 'poi',
      latitude: Number(block.latitude),
      longitude: Number(block.longitude),
      floor: block.floor || '1',
      category: 'Building Block',
    });
    setIsQrModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBlock || !currentBlock.label) {
      setFormError('Block label/name is required');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      const finalFloorsStr = blockFloors.length > 0 ? blockFloors.join(', ') : 'Ground Floor, 1st Floor';
      const payload = {
        label: currentBlock.label.trim(),
        floor: finalFloorsStr,
        latitude: currentBlock.latitude ? Number(currentBlock.latitude) : 6.535472,
        longitude: currentBlock.longitude ? Number(currentBlock.longitude) : 80.401000,
        type: 'poi' as const,
      };

      if (currentBlock.id) {
        // Update existing block node
        const { error } = await supabase
          .from('navigation_nodes')
          .update(payload)
          .eq('id', currentBlock.id);
        if (error) throw error;
      } else {
        // Create new block node
        const { error } = await supabase
          .from('navigation_nodes')
          .insert(payload);
        if (error) throw error;
      }

      setIsFormModalOpen(false);
      await loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save building block');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleSelectBlock = (id: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (filteredBlocks.length === 0) return;
    const allSelected = filteredBlocks.every((b) => selectedBlockIds.has(b.id));
    if (allSelected) {
      setSelectedBlockIds(new Set());
    } else {
      setSelectedBlockIds(new Set(filteredBlocks.map((b) => b.id)));
    }
  };

  const executeBulkDeleteBlocks = async () => {
    if (selectedBlockIds.size === 0) return;
    try {
      setIsBulkDeleting(true);
      const ids = Array.from(selectedBlockIds);

      // Clean up connected walkway edges first
      await supabase.from('navigation_edges').delete().in('from_node_id', ids);
      await supabase.from('navigation_edges').delete().in('to_node_id', ids);

      // Delete the nodes
      const { error } = await supabase.from('navigation_nodes').delete().in('id', ids);
      if (error) throw error;

      setSelectedBlockIds(new Set());
      setIsBulkDeleteModalOpen(false);
      await loadAllData();
    } catch (err: any) {
      console.error('Error deleting selected blocks:', err);
      alert(`Error deleting selected blocks: ${err.message || 'Unknown error'}`);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentBlock?.id) return;
    try {
      setSubmitting(true);
      // Clean up connected walkway edges first
      await supabase.from('navigation_edges').delete().or(`from_node_id.eq.${currentBlock.id},to_node_id.eq.${currentBlock.id}`);

      const { error } = await supabase
        .from('navigation_nodes')
        .delete()
        .eq('id', currentBlock.id);
      if (error) throw error;

      setSelectedBlockIds((prev) => {
        const next = new Set(prev);
        next.delete(currentBlock.id!);
        return next;
      });

      setIsDeleteModalOpen(false);
      await loadAllData();
    } catch (err: any) {
      alert(`Error deleting block: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const columns: Column<BlockEntity>[] = [
    {
      key: 'select',
      width: '46px',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <input
            type="checkbox"
            checked={filteredBlocks.length > 0 && filteredBlocks.every((b) => selectedBlockIds.has(b.id))}
            onChange={handleToggleSelectAll}
            style={{ cursor: 'pointer', width: 17, height: 17, accentColor: 'var(--color-primary)' }}
            title="Select all blocks"
            aria-label="Select all blocks"
          />
        </div>
      ),
      render: (row: BlockEntity) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <input
            type="checkbox"
            checked={selectedBlockIds.has(row.id)}
            onChange={() => handleToggleSelectBlock(row.id)}
            style={{ cursor: 'pointer', width: 17, height: 17, accentColor: 'var(--color-primary)' }}
            title={`Select ${row.name}`}
            aria-label={`Select ${row.name}`}
          />
        </div>
      ),
    },
    {
      key: 'name',
      label: 'Building Block',
      render: (row: BlockEntity) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '8px',
              background: `${row.color}20`,
              border: `1.5px solid ${row.color}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: row.color,
              fontWeight: 800,
              fontSize: '0.9rem',
              flexShrink: 0,
            }}
          >
            <Building2 size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{row.name}</div>
            <div style={{ fontSize: '0.73rem', color: 'var(--color-muted)', display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '0.25rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#22d3ee' }}>
                {row.floors && row.floors.length > 0 ? `${row.floors.length} Floors:` : 'Levels:'}
              </span>
              {(row.floors || ['Ground Floor']).map((fl) => (
                <span
                  key={fl}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.09)',
                    padding: '0.05rem 0.4rem',
                    borderRadius: '4px',
                    fontSize: '0.68rem',
                  }}
                >
                  {fl}
                </span>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'stalls',
      label: 'Stalls Assigned',
      render: (row: BlockEntity) => {
        const count = stallsCountByBlock.get(row.id) || 0;
        return (
          <span
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              color: count > 0 ? '#22d3ee' : 'var(--color-muted)',
              background: count > 0 ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255, 255, 255, 0.04)',
              padding: '0.2rem 0.6rem',
              borderRadius: '6px',
              border: `1px solid ${count > 0 ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
            }}
          >
            <StoreIcon size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
            {count} {count === 1 ? 'Stall' : 'Stalls'}
          </span>
        );
      },
    },
    {
      key: 'coords',
      label: 'Map Coordinates',
      render: (row: BlockEntity) => (
        <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--color-muted)' }}>
          {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row: BlockEntity) => (
        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => handleOpenQrCode(row)}
            title="Generate Block QR Sticker"
          >
            <QrCode size={15} />
          </button>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => handleOpenEdit(row)}
            title="Edit Block"
          >
            <Edit2 size={15} />
          </button>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            style={{ color: 'var(--color-danger)' }}
            onClick={() => handleOpenDelete(row)}
            title="Delete Block"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={24} color="var(--color-accent)" />
            Building Blocks Management
          </h1>
          <p className="admin-page-subtitle">
            Manage exhibition building blocks. Import KML files to auto-populate paths and blocks. Only blocks are marked on the campus map!
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem' }}>
          <button
            className="btn btn-ghost"
            onClick={() => setIsKmlModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 600 }}
          >
            <Upload size={16} />
            Import KML File
          </button>

          <button
            className="btn btn-primary"
            onClick={handleOpenAdd}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}
          >
            <Plus size={16} />
            Add Block
          </button>
        </div>
      </div>

      {/* Info Banner */}
      <div
        className="glass"
        style={{
          padding: '0.85rem 1.25rem',
          borderRadius: '12px',
          marginBottom: '1.25rem',
          background: 'rgba(6, 182, 212, 0.05)',
          border: '1px solid rgba(6, 182, 212, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: '0.84rem',
        }}
      >
        <Navigation2 size={18} color="#22d3ee" style={{ flexShrink: 0 }} />
        <span>
          <strong>How it works:</strong> Paths from your KML file go to the <strong>Nav Nodes</strong> panel for walking routes, while building placemarks go here as <strong>Blocks</strong>. When you manually add stalls in the <strong>Stores</strong> panel, assign them to these blocks. On the campus map, only the blocks are marked!
        </span>
      </div>

      {/* Filter / Search Bar & Bulk Selection Actions */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="search-wrap" style={{ flex: 1, minWidth: 260 }}>
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search blocks by name or floor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Selection & Bulk Actions */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            className={`btn btn-sm ${filteredBlocks.length > 0 && filteredBlocks.every((b) => selectedBlockIds.has(b.id)) ? 'btn-primary' : 'btn-ghost'}`}
            onClick={handleToggleSelectAll}
            disabled={filteredBlocks.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, fontSize: '0.8rem' }}
          >
            {filteredBlocks.length > 0 && filteredBlocks.every((b) => selectedBlockIds.has(b.id))
              ? 'Deselect All'
              : `Select All (${filteredBlocks.length})`}
          </button>

          {selectedBlockIds.size > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setIsBulkDeleteModalOpen(true)}
              disabled={isBulkDeleting}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 700,
                fontSize: '0.8rem',
              }}
            >
              <Trash2 size={14} />
              {isBulkDeleting ? 'Deleting...' : `Delete Selected (${selectedBlockIds.size})`}
            </button>
          )}
        </div>
      </div>

      {/* Table / Empty State */}
      <div className="glass" style={{ borderRadius: '14px', overflow: 'hidden' }}>
        {blocks.length === 0 && !loading ? (
          <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center' }}>
            <Building2 size={48} style={{ opacity: 0.3, margin: '0 auto 1rem auto', color: 'var(--color-accent)' }} />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>
              No Building Blocks Added Yet
            </h2>
            <p style={{ color: 'var(--color-muted)', maxWidth: 460, margin: '0 auto 1.5rem auto', fontSize: '0.86rem' }}>
              Import a KML file with your campus paths and building placemarks, or manually add your first exhibition building block.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={() => setIsKmlModalOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
              >
                <Upload size={16} />
                Import KML File
              </button>
              <button
                className="btn btn-ghost"
                onClick={handleOpenAdd}
                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
              >
                <Plus size={16} />
                Add Block Manually
              </button>
            </div>
          </div>
        ) : (
          <AdminTable<BlockEntity>
            columns={columns}
            rows={filteredBlocks}
            loading={loading}
            emptyMessage="No building blocks found matching your query."
          />
        )}
      </div>

      {/* Add / Edit Block Modal */}
      {isFormModalOpen && currentBlock && (
        <AdminModal
          title={currentBlock.id ? `Edit Building Block: ${currentBlock.label}` : 'Add New Building Block'}
          onClose={() => setIsFormModalOpen(false)}
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', width: '100%' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsFormModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleFormSubmit}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : currentBlock.id ? 'Save Changes' : 'Create Block'}
              </button>
            </div>
          }
        >
          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {formError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                {formError}
              </div>
            )}

            {/* Block Name */}
            <div className="form-group">
              <label className="form-label">Block Name / Label *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Block 1, Block 7 - Innovation Lab"
                value={currentBlock.label || ''}
                onChange={(e) => setCurrentBlock({ ...currentBlock, label: e.target.value })}
                required
              />
            </div>

            {/* Floor Setup Card */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Layers size={16} color="#22d3ee" />
                  Floors in this Building Block
                </label>
                <span style={{ fontSize: '0.74rem', color: '#22d3ee', background: 'rgba(6, 182, 212, 0.12)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                  {blockFloors.length} {blockFloors.length === 1 ? 'Floor Level' : 'Floor Levels'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.85rem', marginBottom: '0.85rem' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--color-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    Number of Floors
                  </label>
                  <select
                    className="form-select"
                    value={floorCount}
                    onChange={(e) => handleFloorConfigChange(Number(e.target.value), includeGround)}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                      <option key={num} value={num}>
                        {num} {num === 1 ? 'Floor' : 'Floors'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
                  <label
                    style={{
                      fontSize: '0.78rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                      marginTop: '1.1rem',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={includeGround}
                      onChange={(e) => handleFloorConfigChange(floorCount, e.target.checked)}
                      style={{ accentColor: 'var(--color-primary)' }}
                    />
                    <span>Include Ground Floor</span>
                  </label>
                </div>
              </div>

              {/* Floor tags preview */}
              <div style={{ marginBottom: '0.65rem' }}>
                <div style={{ fontSize: '0.73rem', color: 'var(--color-muted)', marginBottom: '0.4rem' }}>
                  Available floors that can be selected when assigning stalls:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {blockFloors.map((fl) => (
                    <span
                      key={fl}
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: 'rgba(6, 182, 212, 0.14)',
                        border: '1px solid rgba(6, 182, 212, 0.3)',
                        color: '#22d3ee',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      {fl}
                      {blockFloors.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveFloor(fl)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#22d3ee',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            lineHeight: 1,
                            fontSize: '0.85rem',
                          }}
                          title={`Remove ${fl}`}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>

              {/* Add Custom Floor Option */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Rooftop, Mezzanine, Basement"
                  value={newFloorInput}
                  onChange={(e) => setNewFloorInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomFloor();
                    }
                  }}
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleAddCustomFloor}
                  style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                >
                  + Add Custom Level
                </button>
              </div>
            </div>

            {/* Coordinates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Latitude</label>
                <input
                  type="number"
                  step="any"
                  className="form-input"
                  value={currentBlock.latitude ?? ''}
                  onChange={(e) => setCurrentBlock({ ...currentBlock, latitude: Number(e.target.value) })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Longitude</label>
                <input
                  type="number"
                  step="any"
                  className="form-input"
                  value={currentBlock.longitude ?? ''}
                  onChange={(e) => setCurrentBlock({ ...currentBlock, longitude: Number(e.target.value) })}
                />
              </div>
            </div>

            {/* Position Picker */}
            <div className="form-group">
              <label className="form-label">Pick Location on Campus Map</label>
              <div style={{ height: '200px', width: '100%', borderRadius: '8px', overflow: 'hidden' }}>
                <FormMapPicker
                  latitude={currentBlock.latitude || 6.535472}
                  longitude={currentBlock.longitude || 80.401000}
                  onChange={(lat, lng) => setCurrentBlock({ ...currentBlock, latitude: lat, longitude: lng })}
                />
              </div>
            </div>
          </form>
        </AdminModal>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && currentBlock && (
        <AdminModal
          title="Delete Building Block"
          onClose={() => setIsDeleteModalOpen(false)}
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', width: '100%' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteConfirm}
                disabled={submitting}
              >
                {submitting ? 'Deleting...' : 'Delete Block'}
              </button>
            </div>
          }
        >
          <p style={{ margin: 0 }}>
            Are you sure you want to delete <strong>{currentBlock.label}</strong>?
            Any stalls linked to this block will lose their building association.
          </p>
        </AdminModal>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {isBulkDeleteModalOpen && (
        <AdminModal
          title={`Delete ${selectedBlockIds.size} Selected Blocks`}
          onClose={() => setIsBulkDeleteModalOpen(false)}
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', width: '100%' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsBulkDeleteModalOpen(false)}
                disabled={isBulkDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={executeBulkDeleteBlocks}
                disabled={isBulkDeleting}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Trash2 size={14} />
                {isBulkDeleting ? 'Deleting...' : `Delete ${selectedBlockIds.size} Blocks`}
              </button>
            </div>
          }
        >
          <p style={{ margin: '0 0 0.75rem 0' }}>
            Are you sure you want to delete <strong>{selectedBlockIds.size}</strong> selected building block{selectedBlockIds.size === 1 ? '' : 's'}?
          </p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
            This will remove the selected blocks and any walkway navigation connections linked to them. This action cannot be undone.
          </p>
        </AdminModal>
      )}

      {/* KML Import Modal */}
      {isKmlModalOpen && (
        <KmlImportModal
          isOpen={isKmlModalOpen}
          onClose={() => setIsKmlModalOpen(false)}
          existingNodes={allNodes}
          existingStores={stores}
          onSuccess={() => {
            setIsKmlModalOpen(false);
            loadAllData();
          }}
        />
      )}

      {/* QR Code Modal */}
      {isQrModalOpen && qrTarget && (
        <QrCodeModal
          isOpen={isQrModalOpen}
          onClose={() => setIsQrModalOpen(false)}
          target={qrTarget}
        />
      )}
    </div>
  );
}
