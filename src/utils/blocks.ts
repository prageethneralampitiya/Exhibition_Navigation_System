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
 * Generates an array of floor names based on total floor count.
 * e.g., count = 1, includeGround = true => ['Ground Floor'] (1 floor, only ground floor)
 * e.g., count = 2, includeGround = true => ['Ground Floor', '1st Floor'] (2 floors)
 * e.g., count = 3, includeGround = true => ['Ground Floor', '1st Floor', '2nd Floor'] (3 floors)
 */
export function generateFloorList(totalFloors: number, includeGround = true): string[] {
  const count = Math.max(1, totalFloors);
  const list: string[] = [];

  if (includeGround) {
    list.push('Ground Floor');
    // Upper floors (e.g. if total is 3: Ground Floor + 1st + 2nd = 3 floors total)
    for (let i = 1; i < count; i++) {
      const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th';
      list.push(`${i}${suffix} Floor`);
    }
  } else {
    for (let i = 1; i <= count; i++) {
      const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th';
      list.push(`${i}${suffix} Floor`);
    }
  }

  return list;
}

/**
 * Resolves available floor options for a block or navigation node.
 * Defaults to 1 floor ('Ground Floor') unless multiple floors are specified.
 */
export function getBlockFloorOptions(block: { floor?: string | null } | null | undefined): string[] {
  if (!block || !block.floor) {
    return ['Ground Floor'];
  }

  const raw = block.floor.trim();
  if (raw.includes(',')) {
    const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length > 0) return items;
  }

  // Check if it's a number or contains "N floors" (e.g. "1", "1 floor", "3 floors")
  const numMatch = raw.match(/\b\d+\b/);
  if (numMatch) {
    const n = parseInt(numMatch[0], 10);
    if (n === 1) {
      return ['Ground Floor'];
    }
    if (n > 1 && n <= 50) {
      return generateFloorList(n, true);
    }
  }

  const lower = raw.toLowerCase();
  if (lower === 'g' || lower === 'ground' || lower.includes('ground')) {
    return ['Ground Floor'];
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

function normalizeBlockName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(block|building|hall|pavilion|arena|wing|complex|stall|stalls)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
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

  // If no separator, check if it starts with Block or Building
  if (/^(block|building|hall|pavilion|arena|wing)\b/i.test(raw) || raw.toLowerCase().includes('block')) {
    return { blockName: raw, floorLevel: 'Floor 1' };
  }

  // If it's a known floor name, e.g. "Ground Floor", "1st Floor", "Level 2"
  if (/^(ground|basement|\d+(?:st|nd|rd|th)?\s*floor|level\s*\d+)/i.test(raw)) {
    return { blockName: '', floorLevel: raw };
  }

  // Otherwise, raw could be a block name/number (e.g. "10", "A", "Block 10")
  return { blockName: raw, floorLevel: 'Floor 1' };
}

/**
 * Matches any store to its corresponding BlockEntity from the loaded blocks.
 * Uses a robust hierarchy:
 * 1. Explicit block name parsed from store.floor (e.g. "10 · Ground Floor" -> Block 10)
 * 2. Direct block_node_id link if provided
 * 3. Nearest coordinate block (minimum Euclidean distance, within ~25m)
 * 4. Fallback search in store name or description
 */
export function matchStoreToBlock(
  store: Partial<Store> | null | undefined,
  blocks: BlockEntity[]
): BlockEntity | null {
  if (!store || blocks.length === 0) return null;

  // 1. Explicit block name match from store.floor (100% accurate when admin selects a block)
  const parsed = parseBlockAndFloor(store.floor);
  if (parsed.blockName) {
    const normTarget = normalizeBlockName(parsed.blockName);
    const matches = blocks.filter((b) => normalizeBlockName(b.name) === normTarget);

    if (matches.length === 1) {
      return matches[0];
    }

    if (matches.length > 1) {
      // Tie-break with direct block_node_id if matching one of the candidates
      if (store.block_node_id) {
        const idMatch = matches.find((b) => b.id === store.block_node_id);
        if (idMatch) return idMatch;
      }
      // Tie-break with coordinates if available
      if (typeof store.latitude === 'number' && typeof store.longitude === 'number' && store.latitude !== 0) {
        let best = matches[0];
        let bestDist = Infinity;
        for (const m of matches) {
          const d = Math.hypot(store.latitude - m.latitude, store.longitude - m.longitude);
          if (d < bestDist) {
            bestDist = d;
            best = m;
          }
        }
        return best;
      }
      return matches[0];
    }
  }

  // 2. Direct ID match — if block_node_id matches a known block
  if (store.block_node_id) {
    const direct = blocks.find((b) => b.id === store.block_node_id);
    if (direct) return direct;
  }

  // 3. Minimum-distance coordinate match (finding the SINGLE closest block within 25m)
  if (typeof store.latitude === 'number' && typeof store.longitude === 'number' && store.latitude !== 0) {
    let closest: BlockEntity | null = null;
    let minDist = Infinity;

    for (const b of blocks) {
      const dist = Math.hypot(store.latitude - b.latitude, store.longitude - b.longitude);
      if (dist < minDist) {
        minDist = dist;
        closest = b;
      }
    }

    // 0.00025 degrees is ~27m at equatorial latitudes
    if (closest && minDist < 0.00025) {
      return closest;
    }
  }

  // 4. Token search in store name or description
  const nameDesc = `${store.name || ''} ${store.description || ''}`.toLowerCase();
  for (const b of blocks) {
    const bNorm = normalizeBlockName(b.name);
    if (bNorm && nameDesc.includes(b.name.toLowerCase())) {
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
