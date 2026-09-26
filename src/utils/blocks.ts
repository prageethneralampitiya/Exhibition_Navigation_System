/**
 * Dynamic Building & Block Utilities
 * 
 * Works with real building blocks stored in `navigation_nodes`.
 * No hardcoded dummy blocks — blocks come directly from KML import or manual creation.
 */

import { type Store, type NavigationNode } from '../lib/supabase';

export interface BlockEntity {
  id: string;
  name: string;
  floor: string | null;
  latitude: number;
  longitude: number;
  color: string;
  floors?: string[];
}

const BLOCK_COLORS = [
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#6366f1', // Indigo
  '#ec4899', // Pink
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#f97316', // Orange
  '#14b8a6', // Teal
  '#e11d48', // Rose
];

/**
 * Generates an array of floor names based on floor count.
 * e.g., count = 3, hasGround = true => ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor']
 */
export function generateFloorList(floorCount: number, includeGround = true): string[] {
  const list: string[] = [];
  if (includeGround) {
    list.push('Ground Floor');
  }
  const count = Math.max(1, floorCount);
  for (let i = 1; i <= count; i++) {
    const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th';
    list.push(`${i}${suffix} Floor`);
  }
  return list;
}

/**
 * Resolves available floor options for a block or navigation node.
 * If floor string contains comma-separated values, splits them.
 * If floor string contains a number (e.g. "3" or "3 floors"), generates floor list.
 * Otherwise returns default floor list.
 */
export function getBlockFloorOptions(block: { floor?: string | null } | null | undefined): string[] {
  if (!block || !block.floor) {
    return ['Ground Floor', '1st Floor'];
  }

  const raw = block.floor.trim();
  if (raw.includes(',')) {
    const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length > 0) return items;
  }

  // Check if it's a number or contains "N floors" (e.g. "3", "3 floors")
  const numMatch = raw.match(/\b\d+\b/);
  if (numMatch) {
    const n = parseInt(numMatch[0], 10);
    if (n >= 1 && n <= 50) {
      return generateFloorList(n, true);
    }
  }

  if (raw.toLowerCase().includes('ground')) {
    return ['Ground Floor', '1st Floor'];
  }

  return [raw];
}

/**
 * Filters navigation nodes to extract real exhibition building blocks
 * (Nodes with type 'poi' or labels containing 'block', 'building', 'hall', 'pavilion', etc.)
 */
export function extractBlocksFromNodes(nodes: NavigationNode[]): BlockEntity[] {
  const blockNodes = nodes.filter((n) => {
    const lbl = (n.label || '').toLowerCase();
    // Exclude basic path waypoints and pure entrance gates if not labeled block
    if (n.type === 'path') return false;
    return (
      n.type === 'poi' ||
      lbl.includes('block') ||
      lbl.includes('building') ||
      lbl.includes('hall') ||
      lbl.includes('pavilion') ||
      lbl.includes('arena') ||
      lbl.includes('wing') ||
      lbl.includes('complex')
    );
  });

  return blockNodes.map((n, idx) => ({
    id: n.id,
    name: n.label,
    floor: n.floor || '1',
    latitude: n.latitude,
    longitude: n.longitude,
    color: BLOCK_COLORS[idx % BLOCK_COLORS.length],
    floors: getBlockFloorOptions(n),
  }));
}

/**
 * Matches any store to its corresponding BlockEntity from the loaded blocks
 */
export function matchStoreToBlock(
  store: Partial<Store> | null | undefined,
  blocks: BlockEntity[]
): BlockEntity | null {
  if (!store || blocks.length === 0) return null;

  const floorText = (store.floor || '').toLowerCase().trim();
  const nameText = (store.name || '').toLowerCase().trim();
  const descText = (store.description || '').toLowerCase().trim();

  // 1. Direct name / id match in floor string (e.g. "Block 7 · Floor 1")
  for (const b of blocks) {
    const bName = b.name.toLowerCase().trim();
    if (floorText.includes(bName) || floorText.includes(b.id.toLowerCase())) {
      return b;
    }
  }

  // 2. Exact or close coordinate match
  if (typeof store.latitude === 'number' && typeof store.longitude === 'number' && store.latitude !== 0) {
    for (const b of blocks) {
      if (
        Math.abs(store.latitude - b.latitude) < 0.0003 &&
        Math.abs(store.longitude - b.longitude) < 0.0003
      ) {
        return b;
      }
    }
  }

  // 3. Name or description mentions the block
  for (const b of blocks) {
    const bName = b.name.toLowerCase().trim();
    if (nameText.includes(bName) || descText.includes(bName)) {
      return b;
    }
  }

  return null;
}

/**
 * Formats a block and floor level for storage in store.floor
 */
export function formatBlockAndFloor(blockName: string, floorLevel: string): string {
  const b = blockName.trim();
  const f = floorLevel.trim();
  if (b && f) {
    return `${b} · ${f.startsWith('Floor') || f.startsWith('Ground') ? f : `Floor ${f}`}`;
  }
  return b || f || 'Floor 1';
}

/**
 * Parses block name and floor level from store.floor
 */
export function parseBlockAndFloor(floorRaw: string | null | undefined): {
  blockName: string;
  floorLevel: string;
} {
  if (!floorRaw) return { blockName: '', floorLevel: 'Floor 1' };
  const raw = floorRaw.trim();
  const parts = raw.split(/[·|\-–—]/);

  if (parts.length > 1) {
    return {
      blockName: parts[0].trim(),
      floorLevel: parts[1].trim() || 'Floor 1',
    };
  }

  // If no separator, check if it starts with Block or Floor
  if (raw.toLowerCase().includes('block') || raw.toLowerCase().includes('building')) {
    return { blockName: raw, floorLevel: 'Floor 1' };
  }

  return { blockName: '', floorLevel: raw };
}

export interface ExhibitionBlock {
  id: string;
  number: string;
  name: string;
  fullName: string;
  description: string;
  floor: string;
  color: string;
  latitude: number;
  longitude: number;
}

/**
 * Returns complete exhibition block details for a store, matching against real blocks
 * or falling back gracefully to the store's floor string.
 */
export function getStoreBlock(
  store: Partial<Store> | null | undefined,
  blocks?: BlockEntity[]
): ExhibitionBlock {
  const matched = blocks && blocks.length > 0 ? matchStoreToBlock(store, blocks) : null;
  if (matched) {
    const numMatch = matched.name.match(/\d+/);
    return {
      id: matched.id,
      number: numMatch ? numMatch[0] : matched.name.slice(0, 3).toUpperCase(),
      name: matched.name,
      fullName: matched.name,
      description: `Exhibition Building · Floor ${matched.floor || '1'}`,
      floor: matched.floor || '1',
      color: matched.color,
      latitude: matched.latitude,
      longitude: matched.longitude,
    };
  }

  const parsed = parseBlockAndFloor(store?.floor);
  const blockName = parsed.blockName || (store?.floor ? store.floor : 'Exhibition Building');
  const numMatch = blockName.match(/\d+/);

  let hash = 0;
  for (let i = 0; i < blockName.length; i++) {
    hash = (hash << 5) - hash + blockName.charCodeAt(i);
  }
  const colorIndex = Math.abs(hash) % BLOCK_COLORS.length;

  return {
    id: store?.id ? `block-${store.id}` : 'block-default',
    number: numMatch ? numMatch[0] : (blockName.startsWith('Block') ? blockName.replace('Block', '').trim() : '1'),
    name: blockName,
    fullName: blockName,
    description: `Exhibition Area · ${parsed.floorLevel}`,
    floor: parsed.floorLevel,
    color: BLOCK_COLORS[colorIndex],
    latitude: typeof store?.latitude === 'number' ? store.latitude : 0,
    longitude: typeof store?.longitude === 'number' ? store.longitude : 0,
  };
}
