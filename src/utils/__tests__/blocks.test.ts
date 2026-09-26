import { describe, it, expect } from 'vitest';
import {
  extractBlocksFromNodes,
  matchStoreToBlock,
  formatBlockAndFloor,
  parseBlockAndFloor,
  generateFloorList,
  getBlockFloorOptions,
  getStoreBlock,
  type BlockEntity,
} from '../blocks';
import { type NavigationNode, type Store } from '../../lib/supabase';

describe('blocks.ts - Dynamic Building Blocks Utility', () => {
  describe('generateFloorList & getBlockFloorOptions', () => {
    it('generates ground floor + 3 upper floors when count is 3 with ground floor', () => {
      const floors = generateFloorList(3, true);
      expect(floors).toEqual(['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor']);
    });

    it('generates upper floors only when includeGround is false', () => {
      const floors = generateFloorList(2, false);
      expect(floors).toEqual(['1st Floor', '2nd Floor']);
    });

    it('parses comma-separated floor strings', () => {
      const floors = getBlockFloorOptions({ floor: 'Ground Floor, 1st Floor, 2nd Floor, Rooftop' });
      expect(floors).toEqual(['Ground Floor', '1st Floor', '2nd Floor', 'Rooftop']);
    });

    it('generates floors from numeric string like "3" or "3 floors"', () => {
      const floors1 = getBlockFloorOptions({ floor: '3' });
      expect(floors1).toEqual(['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor']);

      const floors2 = getBlockFloorOptions({ floor: '4 floors' });
      expect(floors2).toEqual(['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor', '4th Floor']);
    });

    it('provides sensible defaults when floor is null or empty', () => {
      expect(getBlockFloorOptions(null)).toEqual(['Ground Floor', '1st Floor']);
      expect(getBlockFloorOptions({ floor: '' })).toEqual(['Ground Floor', '1st Floor']);
    });
  });
  const mockNodes: NavigationNode[] = [
    {
      id: 'node-block-1',
      label: 'Block 1 - Main Science Hall',
      latitude: 6.5351,
      longitude: 80.4011,
      floor: '1',
      type: 'poi',
      store_id: null,
      created_at: '2026-01-01',
    },
    {
      id: 'node-block-2',
      label: 'Engineering Pavilion (Block 2)',
      latitude: 6.5358,
      longitude: 80.4019,
      floor: '2',
      type: 'poi',
      store_id: null,
      created_at: '2026-01-01',
    },
    {
      id: 'node-path-1',
      label: 'Walkway Junction 1',
      latitude: 6.5355,
      longitude: 80.4015,
      floor: '1',
      type: 'path',
      store_id: null,
      created_at: '2026-01-01',
    },
    {
      id: 'node-entrance',
      label: 'Main Gate',
      latitude: 6.5349,
      longitude: 80.4008,
      floor: '1',
      type: 'entrance',
      store_id: null,
      created_at: '2026-01-01',
    },
  ];

  describe('extractBlocksFromNodes', () => {
    it('extracts POI and building/block nodes while excluding normal path waypoints', () => {
      const blocks = extractBlocksFromNodes(mockNodes);
      expect(blocks.length).toBe(2);
      expect(blocks[0].id).toBe('node-block-1');
      expect(blocks[0].name).toBe('Block 1 - Main Science Hall');
      expect(blocks[1].id).toBe('node-block-2');
      expect(blocks[1].name).toBe('Engineering Pavilion (Block 2)');
    });

    it('returns empty array when no blocks are present', () => {
      const empty = extractBlocksFromNodes([]);
      expect(empty).toEqual([]);
    });
  });

  describe('formatBlockAndFloor & parseBlockAndFloor', () => {
    it('formats block name and floor level cleanly', () => {
      expect(formatBlockAndFloor('Block 7', 'Floor 2')).toBe('Block 7 · Floor 2');
      expect(formatBlockAndFloor('Block 3', 'Ground Floor')).toBe('Block 3 · Ground Floor');
      expect(formatBlockAndFloor('Block 1', '1')).toBe('Block 1 · Floor 1');
    });

    it('parses formatted block and floor string', () => {
      const parsed1 = parseBlockAndFloor('Block 7 · Floor 2');
      expect(parsed1.blockName).toBe('Block 7');
      expect(parsed1.floorLevel).toBe('Floor 2');

      const parsed2 = parseBlockAndFloor('Block 4 - Ground Floor');
      expect(parsed2.blockName).toBe('Block 4');
      expect(parsed2.floorLevel).toBe('Ground Floor');

      const parsedSingle = parseBlockAndFloor('Block 9');
      expect(parsedSingle.blockName).toBe('Block 9');
      expect(parsedSingle.floorLevel).toBe('Floor 1');
    });
  });

  describe('matchStoreToBlock', () => {
    const blocks: BlockEntity[] = [
      {
        id: 'blk-7',
        name: 'Block 7',
        floor: '1',
        latitude: 6.5360,
        longitude: 80.4020,
        color: '#06b6d4',
      },
      {
        id: 'blk-8',
        name: 'Block 8 (Robotics)',
        floor: '2',
        latitude: 6.5370,
        longitude: 80.4030,
        color: '#3b82f6',
      },
    ];

    it('matches store by floor string containing block name', () => {
      const store: Partial<Store> = {
        id: 'st-64',
        name: 'Stall 64 - AI Robotics',
        floor: 'Block 7 · Floor 1',
      };
      const matched = matchStoreToBlock(store, blocks);
      expect(matched).not.toBeNull();
      expect(matched?.id).toBe('blk-7');
    });

    it('matches store by coordinates matching block', () => {
      const store: Partial<Store> = {
        id: 'st-65',
        name: 'Stall 65 - Sensor Lab',
        latitude: 6.536005,
        longitude: 80.402005,
      };
      const matched = matchStoreToBlock(store, blocks);
      expect(matched).not.toBeNull();
      expect(matched?.id).toBe('blk-7');
    });

    it('returns null if store has no matching block info', () => {
      const store: Partial<Store> = {
        id: 'st-99',
        name: 'Isolated Stall',
        latitude: 6.5999,
        longitude: 80.4999,
        floor: 'Unknown',
      };
      expect(matchStoreToBlock(store, blocks)).toBeNull();
    });
  });

  describe('getStoreBlock', () => {
    it('returns exhibition block details when matched with real blocks', () => {
      const blocks: BlockEntity[] = [
        {
          id: 'blk-7',
          name: 'Block 7 - Tech Arena',
          floor: '1',
          latitude: 6.5360,
          longitude: 80.4020,
          color: '#06b6d4',
        },
      ];
      const store: Partial<Store> = {
        id: 'store-1',
        name: 'AI Innovations',
        floor: 'Block 7 - Tech Arena · Floor 1',
      };
      const info = getStoreBlock(store, blocks);
      expect(info.id).toBe('blk-7');
      expect(info.number).toBe('7');
      expect(info.name).toBe('Block 7 - Tech Arena');
    });

    it('returns graceful fallback block details when no blocks provided', () => {
      const store: Partial<Store> = {
        id: 'store-2',
        name: 'Medical Stall',
        floor: 'Block 3 · Floor 2',
      };
      const info = getStoreBlock(store, []);
      expect(info.number).toBe('3');
      expect(info.name).toBe('Block 3');
      expect(info.floor).toBe('Floor 2');
    });
  });
});
