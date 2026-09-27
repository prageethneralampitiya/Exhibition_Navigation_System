import { useState, useMemo, useCallback } from 'react';
import {
  X,
  Search,
  Check,
  Compass,
  Store,
  MapPin,
  CheckSquare,
  Square,
  ArrowRight,
  Layers,
} from 'lucide-react';
import type { Store as StoreType, NavigationNode } from '../lib/supabase';
import {
  extractBlocksFromNodes,
  matchStoreToBlock,
  parseBlockAndFloor,
  type BlockEntity,
} from '../utils/blocks';

export interface StallTourSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  stores: StoreType[];
  nodes: NavigationNode[];
  onConfirmTour: (selectedStoreIds: string[]) => void;
  onOpenFreeMap?: () => void;
  initialSelectedStoreIds?: string[];
}

interface FloorStallsGroup {
  floorLevel: string;
  floorRank: number;
  stalls: StoreType[];
}

interface BlockStallsGroup {
  blockId: string;
  blockName: string;
  displayName: string;
  blockColor: string;
  allStalls: StoreType[];
  floors: FloorStallsGroup[];
}

/** Formats a block name into friendly "Block X" display */
export function formatFriendlyBlockName(name: string): string {
  const trimmed = (name || '').trim();
  if (/^\d+$/i.test(trimmed)) {
    return `Block ${trimmed}`;
  }
  if (/^b\s*(\d+)$/i.test(trimmed)) {
    const match = trimmed.match(/^b\s*(\d+)$/i);
    return `Block ${match ? match[1] : trimmed}`;
  }
  return trimmed || 'Campus Block';
}

/** Extracts numeric value for natural ascending sorting */
function extractSortNumber(str: string): number | null {
  const match = str.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/** Assigns a numeric rank to floor levels for ascending sorting */
function getFloorRank(floor: string): number {
  const lower = floor.toLowerCase().trim();
  if (lower.includes('basement') || lower === 'b' || lower.startsWith('b')) return -1;
  if (lower.includes('ground') || lower === 'g' || lower === '0') return 0;
  const numMatch = lower.match(/\d+/);
  if (numMatch) return parseInt(numMatch[0], 10);
  return 1;
}

/** Formats floor names consistently, e.g. "Ground Floor", "1st Floor" */
function normalizeFloorName(floorRaw: string): string {
  const trimmed = (floorRaw || '').trim();
  if (!trimmed) return 'Ground Floor';
  const lower = trimmed.toLowerCase();
  if (lower === 'g' || lower === 'ground' || lower.includes('ground')) return 'Ground Floor';
  if (lower === '1' || lower === 'floor 1' || lower === '1st floor') return '1st Floor';
  if (lower === '2' || lower === 'floor 2' || lower === '2nd floor') return '2nd Floor';
  if (lower === '3' || lower === 'floor 3' || lower === '3rd floor') return '3rd Floor';
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
    return `${n}${suffix} Floor`;
  }
  return trimmed;
}

export function StallTourSelectModal({
  isOpen,
  onClose,
  stores,
  nodes,
  onConfirmTour,
  onOpenFreeMap,
  initialSelectedStoreIds,
}: StallTourSelectModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Real building blocks from navigation nodes
  const realBlocks: BlockEntity[] = useMemo(() => {
    return extractBlocksFromNodes(nodes);
  }, [nodes]);

  // Filter out pure venue facilities (washroom, first aid, security) from exhibition tour stall list
  const validStalls = useMemo(() => {
    const FACILITY_KEYWORDS = [
      'washroom', 'restroom', 'toilet', 'wc', 'bathroom',
      'clinic', 'first aid', 'medical', 'security',
    ];
    return stores.filter((st) => {
      if (st.id === 'kalawana-national-school-landmark') return false;
      const text = `${st.name} ${st.description || ''}`.toLowerCase();
      return !FACILITY_KEYWORDS.some((kw) => text.includes(kw));
    });
  }, [stores]);

  // Group stalls under blocks, then subdivide by floor, sorted in ascending order
  const blockGroups: BlockStallsGroup[] = useMemo(() => {
    // Map: blockId -> { block info, Map: floorLevel -> stalls[] }
    const rawBlocksMap = new Map<
      string,
      {
        blockId: string;
        blockName: string;
        displayName: string;
        blockColor: string;
        floorsMap: Map<string, StoreType[]>;
      }
    >();

    validStalls.forEach((st) => {
      const matched = matchStoreToBlock(st, realBlocks);
      const parsed = parseBlockAndFloor(st.floor);

      const blockId = matched?.id || parsed.blockName || 'campus-general';
      const rawBlockName = matched?.name || parsed.blockName || 'Campus General';
      const displayName = formatFriendlyBlockName(rawBlockName);
      const rawFloor = parsed.floorLevel || (matched?.floor ? `Floor ${matched.floor}` : 'Ground Floor');
      const floorLevel = normalizeFloorName(rawFloor);
      const blockColor = matched?.color || '#06b6d4';

      if (!rawBlocksMap.has(blockId)) {
        rawBlocksMap.set(blockId, {
          blockId,
          blockName: rawBlockName,
          displayName,
          blockColor,
          floorsMap: new Map(),
        });
      }

      const blk = rawBlocksMap.get(blockId)!;
      if (!blk.floorsMap.has(floorLevel)) {
        blk.floorsMap.set(floorLevel, []);
      }
      blk.floorsMap.get(floorLevel)!.push(st);
    });

    const list: BlockStallsGroup[] = Array.from(rawBlocksMap.values()).map((raw) => {
      const floors: FloorStallsGroup[] = Array.from(raw.floorsMap.entries()).map(([floorLevel, stalls]) => {
        // Sort stalls under each floor in ascending order by stall number or name
        stalls.sort((a, b) => {
          const numA = extractSortNumber(a.name);
          const numB = extractSortNumber(b.name);
          if (numA !== null && numB !== null && numA !== numB) {
            return numA - numB;
          }
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        return {
          floorLevel,
          floorRank: getFloorRank(floorLevel),
          stalls,
        };
      });

      // Sort floors in ascending order (Ground Floor < 1st Floor < 2nd Floor)
      floors.sort((a, b) => a.floorRank - b.floorRank);

      const allStalls = floors.flatMap((f) => f.stalls);

      return {
        blockId: raw.blockId,
        blockName: raw.blockName,
        displayName: raw.displayName,
        blockColor: raw.blockColor,
        allStalls,
        floors,
      };
    });

    // Sort blocks in natural ascending order (Block 2 < Block 3 < Block 10 < Block 15)
    list.sort((a, b) => {
      const numA = extractSortNumber(a.displayName);
      const numB = extractSortNumber(b.displayName);
      if (numA !== null && numB !== null && numA !== numB) {
        return numA - numB;
      }
      return a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: 'base' });
    });

    return list;
  }, [validStalls, realBlocks]);

  // Selected stall IDs state (defaults to all valid stalls or initialSelectedStoreIds)
  const [selectedStallIds, setSelectedStallIds] = useState<string[]>(() => {
    if (initialSelectedStoreIds && initialSelectedStoreIds.length > 0) {
      return initialSelectedStoreIds;
    }
    return validStalls.map((s) => s.id);
  });

  // Filter groups according to search query
  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return blockGroups;

    return blockGroups
      .map((grp) => {
        const blockMatches =
          grp.displayName.toLowerCase().includes(q) ||
          grp.blockName.toLowerCase().includes(q);

        const filteredFloors: FloorStallsGroup[] = grp.floors
          .map((flr) => {
            const floorMatches = blockMatches || flr.floorLevel.toLowerCase().includes(q);
            const matchingStalls = flr.stalls.filter((s) => {
              if (floorMatches) return true;
              const nameMatch = s.name.toLowerCase().includes(q);
              const catMatch = (s.categories?.name || '').toLowerCase().includes(q);
              const descMatch = (s.description || '').toLowerCase().includes(q);
              return nameMatch || catMatch || descMatch;
            });
            if (matchingStalls.length === 0) return null;
            return {
              ...flr,
              stalls: matchingStalls,
            };
          })
          .filter((f): f is FloorStallsGroup => f !== null);

        if (filteredFloors.length === 0) return null;

        return {
          ...grp,
          floors: filteredFloors,
          allStalls: filteredFloors.flatMap((f) => f.stalls),
        };
      })
      .filter((g): g is BlockStallsGroup => g !== null);
  }, [blockGroups, searchQuery]);

  const totalStallsCount = useMemo(() => {
    return blockGroups.reduce((acc, g) => acc + g.allStalls.length, 0);
  }, [blockGroups]);

  // Toggle selection for a single stall
  const handleToggleStall = useCallback((id: string) => {
    setSelectedStallIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  // Toggle all stalls in a block
  const handleToggleBlock = useCallback((grp: BlockStallsGroup) => {
    const blockStallIds = grp.allStalls.map((s) => s.id);
    const allSelected = blockStallIds.every((id) => selectedStallIds.includes(id));

    if (allSelected) {
      // Deselect this entire block
      setSelectedStallIds((prev) => prev.filter((id) => !blockStallIds.includes(id)));
    } else {
      // Select all stalls in this block
      setSelectedStallIds((prev) => Array.from(new Set([...prev, ...blockStallIds])));
    }
  }, [selectedStallIds]);

  // Toggle all stalls on a specific floor
  const handleToggleFloor = useCallback((stallsOnFloor: StoreType[]) => {
    const floorStallIds = stallsOnFloor.map((s) => s.id);
    const allSelected = floorStallIds.every((id) => selectedStallIds.includes(id));

    if (allSelected) {
      setSelectedStallIds((prev) => prev.filter((id) => !floorStallIds.includes(id)));
    } else {
      setSelectedStallIds((prev) => Array.from(new Set([...prev, ...floorStallIds])));
    }
  }, [selectedStallIds]);

  // Select all stalls across all blocks
  const handleSelectAll = useCallback(() => {
    setSelectedStallIds(validStalls.map((s) => s.id));
  }, [validStalls]);

  // Deselect all stalls
  const handleDeselectAll = useCallback(() => {
    setSelectedStallIds([]);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="animate-fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11, 15, 26, 0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass"
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '92vh',
          background: 'linear-gradient(165deg, rgba(26, 34, 53, 0.98), rgba(15, 23, 42, 0.99))',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          borderRadius: '24px',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.8), 0 0 30px rgba(99, 102, 241, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Ambient Top Glow */}
        <div
          style={{
            position: 'absolute',
            top: '-50px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '280px',
            height: '100px',
            background: 'radial-gradient(ellipse, rgba(99, 102, 241, 0.4), transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* ── Modal Header ────────────────────────────────────── */}
        <div
          style={{
            padding: '1.25rem 1.5rem 1rem',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.45)',
                flexShrink: 0,
              }}
            >
              <Compass size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '1.2rem',
                    fontWeight: 800,
                    color: 'var(--color-text)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  Exhibition Tour Planner
                </h3>
                <span
                  style={{
                    background: 'rgba(34, 211, 238, 0.15)',
                    color: 'var(--color-accent)',
                    border: '1px solid rgba(34, 211, 238, 0.3)',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Smart Route
                </span>
              </div>
              <p
                style={{
                  margin: '0.2rem 0 0',
                  fontSize: '0.82rem',
                  color: 'var(--color-muted)',
                  lineHeight: 1.4,
                }}
              >
                Select the stalls you wish to visit under each block and floor level.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-icon"
            style={{
              borderRadius: '50%',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-muted)',
              flexShrink: 0,
            }}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Toolbar: Search & Selection Controls ───────────── */}
        <div
          style={{
            padding: '0.85rem 1.5rem',
            background: 'rgba(255, 255, 255, 0.02)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
          }}
        >
          {/* Search Input */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              padding: '0.5rem 0.85rem',
            }}
          >
            <Search size={16} color="var(--color-muted)" style={{ flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search stall name, block number, floor, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                width: '100%',
                fontSize: '0.88rem',
                color: 'var(--color-text)',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0,
                }}
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Quick Action Chips & Counter */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: selectedStallIds.length > 0 ? '#22c55e' : 'var(--color-muted)',
                  background:
                    selectedStallIds.length > 0
                      ? 'rgba(34, 197, 94, 0.12)'
                      : 'rgba(255, 255, 255, 0.05)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '8px',
                  border: `1px solid ${
                    selectedStallIds.length > 0
                      ? 'rgba(34, 197, 94, 0.3)'
                      : 'rgba(255, 255, 255, 0.08)'
                  }`,
                }}
              >
                ✓ {selectedStallIds.length} of {totalStallsCount} Selected
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                across {blockGroups.length} Blocks
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={handleSelectAll}
                className="btn btn-ghost btn-sm"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.6rem',
                  color: 'var(--color-accent)',
                  border: '1px solid rgba(34, 211, 238, 0.3)',
                  borderRadius: '8px',
                  height: 'unset',
                  minHeight: 'unset',
                }}
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="btn btn-ghost btn-sm"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.6rem',
                  color: 'var(--color-warning)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: '8px',
                  height: 'unset',
                  minHeight: 'unset',
                }}
              >
                Deselect
              </button>
            </div>
          </div>
        </div>

        {/* ── Scrollable Blocks & Stalls List (Fully Open, Vertical Only) ── */}
        <div
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            padding: '1rem 1.25rem 2.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          {filteredGroups.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '3rem 1rem',
                color: 'var(--color-muted)',
              }}
            >
              <Store size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.35 }} />
              <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>
                No stalls found matching "{searchQuery}"
              </p>
              <span style={{ fontSize: '0.78rem', opacity: 0.8 }}>
                Try searching for a different block number, floor, or stall name.
              </span>
            </div>
          ) : (
            filteredGroups.map((grp) => {
              const blockStallIds = grp.allStalls.map((s) => s.id);
              const selectedCountInBlock = blockStallIds.filter((id) =>
                selectedStallIds.includes(id)
              ).length;
              const allBlockSelected =
                blockStallIds.length > 0 && selectedCountInBlock === blockStallIds.length;
              const someBlockSelected =
                selectedCountInBlock > 0 && selectedCountInBlock < blockStallIds.length;

              return (
                <div
                  key={grp.blockId}
                  style={{
                    background: 'rgba(255, 255, 255, 0.025)',
                    border: `1px solid ${
                      selectedCountInBlock > 0 ? `${grp.blockColor}40` : 'rgba(255, 255, 255, 0.08)'
                    }`,
                    borderRadius: '16px',
                    overflow: 'hidden',
                    flexShrink: 0,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {/* Block Header (Static, Not Collapsible) */}
                  <div
                    style={{
                      padding: '0.85rem 1.1rem',
                      background:
                        selectedCountInBlock > 0
                          ? `linear-gradient(90deg, ${grp.blockColor}22, rgba(255,255,255,0.02))`
                          : 'rgba(255, 255, 255, 0.03)',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.65rem',
                      userSelect: 'none',
                    }}
                  >
                    {/* Left: Checkbox + Block Badge + Title */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {/* Block-level Select Toggle */}
                      <button
                        type="button"
                        onClick={() => handleToggleBlock(grp)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: allBlockSelected
                            ? grp.blockColor
                            : someBlockSelected
                            ? 'var(--color-accent)'
                            : 'var(--color-muted)',
                        }}
                        title={allBlockSelected ? 'Deselect Block' : 'Select All in Block'}
                      >
                        {allBlockSelected ? (
                          <CheckSquare size={20} />
                        ) : someBlockSelected ? (
                          <div
                            style={{
                              width: 20,
                              height: 20,
                              border: `2px solid var(--color-accent)`,
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <div
                              style={{
                                width: 10,
                                height: 3,
                                background: 'var(--color-accent)',
                                borderRadius: '2px',
                              }}
                            />
                          </div>
                        ) : (
                          <Square size={20} />
                        )}
                      </button>

                      {/* Block Number Circle */}
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '10px',
                          background: grp.blockColor,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: '0.85rem',
                          flexShrink: 0,
                          boxShadow: `0 2px 8px ${grp.blockColor}50`,
                        }}
                      >
                        {grp.displayName.match(/\d+/)?.[0] ?? grp.displayName.slice(0, 2).toUpperCase()}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: '0.96rem',
                            color: 'var(--color-text)',
                            letterSpacing: '-0.01em',
                          }}
                        >
                          🏢 {grp.displayName}
                        </span>
                      </div>
                    </div>

                    {/* Right: Selected Count in Block */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          color: selectedCountInBlock > 0 ? grp.blockColor : 'var(--color-muted)',
                        }}
                      >
                        {selectedCountInBlock}/{grp.allStalls.length} Stalls
                      </span>
                    </div>
                  </div>

                  {/* Stalls Grouped under Floor Tags (Vertical only) */}
                  <div
                    style={{
                      padding: '0.75rem 0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                    }}
                  >
                    {grp.floors.map((flr) => {
                      const floorStallIds = flr.stalls.map((s) => s.id);
                      const floorSelectedCount = floorStallIds.filter((id) =>
                        selectedStallIds.includes(id)
                      ).length;
                      const allFloorSelected =
                        floorStallIds.length > 0 && floorSelectedCount === floorStallIds.length;

                      return (
                        <div
                          key={`${grp.blockId}-${flr.floorLevel}`}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.45rem',
                            flexShrink: 0,
                          }}
                        >
                          {/* Floor Level Tag Header (Only when block has multiple floors) */}
                          {grp.floors.length > 1 && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0.2rem 0.4rem',
                                borderBottom: '1px dashed rgba(255, 255, 255, 0.08)',
                                paddingBottom: '0.35rem',
                                marginBottom: '0.15rem',
                              }}
                            >
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                  background: 'rgba(34, 211, 238, 0.1)',
                                  border: '1px solid rgba(34, 211, 238, 0.25)',
                                  borderRadius: '16px',
                                  padding: '0.15rem 0.6rem',
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  color: 'var(--color-accent)',
                                }}
                              >
                                <Layers size={13} />
                                <span>{flr.floorLevel}</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleToggleFloor(flr.stalls)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  fontSize: '0.7rem',
                                  color: allFloorSelected ? 'var(--color-accent)' : 'var(--color-muted)',
                                  fontWeight: 600,
                                  padding: '0.1rem 0.35rem',
                                }}
                                title={allFloorSelected ? 'Deselect floor stalls' : 'Select all floor stalls'}
                              >
                                {allFloorSelected ? '✓ All Selected' : `${floorSelectedCount}/${flr.stalls.length} Selected`}
                              </button>
                            </div>
                          )}

                          {/* Pure Vertical Stalls List (One per row, full width) */}
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.45rem',
                              width: '100%',
                            }}
                          >
                            {flr.stalls.map((stall, stallIdx) => {
                              const isSelected = selectedStallIds.includes(stall.id);
                              const stallNum =
                                stall.name.match(/(?:stall|booth|#|\b)\s*#?\s*(\d+)/i)?.[1] ||
                                String(stallIdx + 1);

                              return (
                                <div
                                  key={stall.id}
                                  onClick={() => handleToggleStall(stall.id)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.85rem',
                                    padding: '0.7rem 0.95rem',
                                    borderRadius: '12px',
                                    background: isSelected
                                      ? 'rgba(99, 102, 241, 0.14)'
                                      : 'rgba(255, 255, 255, 0.02)',
                                    border: `1px solid ${
                                      isSelected
                                        ? 'rgba(99, 102, 241, 0.5)'
                                        : 'rgba(255, 255, 255, 0.06)'
                                    }`,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    flexShrink: 0,
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isSelected) {
                                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isSelected) {
                                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                                    }
                                  }}
                                >
                                  {/* Stall Checkbox */}
                                  <div
                                    style={{
                                      width: 20,
                                      height: 20,
                                      borderRadius: '6px',
                                      border: `2px solid ${
                                        isSelected ? '#6366f1' : 'rgba(255, 255, 255, 0.3)'
                                      }`,
                                      background: isSelected ? '#6366f1' : 'transparent',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: '#fff',
                                      flexShrink: 0,
                                      transition: 'all 0.15s ease',
                                    }}
                                  >
                                    {isSelected && <Check size={14} strokeWidth={3} />}
                                  </div>

                                  {/* Stall Logo / Icon */}
                                  <div
                                    style={{
                                      width: 36,
                                      height: 36,
                                      borderRadius: '10px',
                                      background: 'rgba(255, 255, 255, 0.06)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      overflow: 'hidden',
                                      flexShrink: 0,
                                      border: '1px solid rgba(255, 255, 255, 0.08)',
                                    }}
                                  >
                                    {stall.logo_url ? (
                                      <img
                                        src={stall.logo_url}
                                        alt={stall.name}
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          objectFit: 'cover',
                                        }}
                                        loading="lazy"
                                      />
                                    ) : (
                                      <Store
                                        size={18}
                                        color={stall.categories?.color || grp.blockColor}
                                      />
                                    )}
                                  </div>

                                  {/* Stall Details: Full width with ample space */}
                                  <div
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '0.15rem',
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.45rem',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: '0.68rem',
                                          fontWeight: 800,
                                          color: grp.blockColor,
                                          background: `${grp.blockColor}18`,
                                          padding: '0.1rem 0.4rem',
                                          borderRadius: '5px',
                                          flexShrink: 0,
                                        }}
                                      >
                                        #{stallNum}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: '0.92rem',
                                          fontWeight: 700,
                                          color: isSelected ? '#fff' : 'var(--color-text)',
                                          wordBreak: 'break-word',
                                        }}
                                        title={stall.name}
                                      >
                                        {stall.name}
                                      </span>
                                    </div>

                                    {/* Category and Subtitle details */}
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.45rem',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      {stall.categories && (
                                        <span
                                          style={{
                                            fontSize: '0.7rem',
                                            fontWeight: 600,
                                            color: stall.categories.color || 'var(--color-muted)',
                                            background: `${stall.categories.color || '#6366f1'}15`,
                                            padding: '0.05rem 0.45rem',
                                            borderRadius: '4px',
                                          }}
                                        >
                                          {stall.categories.name}
                                        </span>
                                      )}
                                      {stall.description && (
                                        <span
                                          style={{
                                            fontSize: '0.72rem',
                                            color: 'var(--color-muted)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            maxWidth: '300px',
                                          }}
                                        >
                                          {stall.description}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Modal Footer with Locate on Map Button ──────────── */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--color-border)',
            background: 'rgba(15, 23, 42, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          {/* Skip / Free Explore Button */}
          {onOpenFreeMap && (
            <button
              type="button"
              onClick={onOpenFreeMap}
              className="btn btn-ghost"
              style={{
                fontSize: '0.84rem',
                color: 'var(--color-muted)',
                padding: '0.6rem 1rem',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              Open Free Map Directly
            </button>
          )}

          {/* Primary CTA: Locate on the Map */}
          <button
            type="button"
            disabled={selectedStallIds.length === 0}
            onClick={() => onConfirmTour(selectedStallIds)}
            className="btn btn-primary"
            id="locate-on-map-submit-btn"
            style={{
              flex: onOpenFreeMap ? '1 1 auto' : '1',
              padding: '0.75rem 1.5rem',
              borderRadius: '12px',
              fontSize: '0.92rem',
              fontWeight: 800,
              background:
                selectedStallIds.length === 0
                  ? 'rgba(255, 255, 255, 0.1)'
                  : 'linear-gradient(135deg, #6366f1, #a855f7)',
              border: 'none',
              color: selectedStallIds.length === 0 ? 'var(--color-muted)' : '#fff',
              boxShadow:
                selectedStallIds.length === 0
                  ? 'none'
                  : '0 4px 18px rgba(99, 102, 241, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.55rem',
              cursor: selectedStallIds.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <MapPin size={18} />
            <span>
              {selectedStallIds.length === 0
                ? 'Select Stalls to Locate'
                : `Locate on the Map (${selectedStallIds.length} ${
                    selectedStallIds.length === 1 ? 'Stall' : 'Stalls'
                  })`}
            </span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
