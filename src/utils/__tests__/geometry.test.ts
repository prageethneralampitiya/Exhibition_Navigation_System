import { describe, it, expect } from 'vitest';
import {
  isPointInRectangle,
  doSegmentsIntersect,
  segmentIntersectsRectangle,
  segmentIntersectsAnyBuilding,
  getBuildingCornerWaypoints,
  contourPathAroundBuildings,
  type BuildingRectangle,
} from '../geometry';
import { type NavigationNode } from '../../lib/supabase';

describe('geometry.ts - Obstacle Avoidance & Boundary Checks', () => {
  const sampleBuilding: BuildingRectangle = {
    id: 'hall-1',
    name: 'Main Exhibition Hall',
    minLat: 6.535200,
    maxLat: 6.535500,
    minLng: 80.401000,
    maxLng: 80.401400,
  };

  describe('isPointInRectangle', () => {
    it('returns true for a point strictly inside the building', () => {
      expect(isPointInRectangle(6.535350, 80.401200, sampleBuilding)).toBe(true);
    });

    it('returns false for a point outside the building', () => {
      expect(isPointInRectangle(6.535100, 80.401200, sampleBuilding)).toBe(false);
      expect(isPointInRectangle(6.535350, 80.401500, sampleBuilding)).toBe(false);
    });
  });

  describe('doSegmentsIntersect', () => {
    it('returns true for two crossing line segments', () => {
      // Crossing + shape: (0, 1) -> (2, 1) and (1, 0) -> (1, 2)
      const s1A: [number, number] = [0, 1];
      const s1B: [number, number] = [2, 1];
      const s2A: [number, number] = [1, 0];
      const s2B: [number, number] = [1, 2];

      expect(doSegmentsIntersect(s1A, s1B, s2A, s2B)).toBe(true);
    });

    it('returns false for parallel or non-overlapping segments', () => {
      const s1A: [number, number] = [0, 0];
      const s1B: [number, number] = [2, 0];
      const s2A: [number, number] = [0, 1];
      const s2B: [number, number] = [2, 1];

      expect(doSegmentsIntersect(s1A, s1B, s2A, s2B)).toBe(false);
    });
  });

  describe('segmentIntersectsRectangle', () => {
    it('detects a path cutting directly through a building', () => {
      // Path from South of building to North of building
      const intersects = segmentIntersectsRectangle(
        6.535100, 80.401200, // South
        6.535600, 80.401200, // North
        sampleBuilding
      );
      expect(intersects).toBe(true);
    });

    it('allows a path running along the walkway outside the building', () => {
      // Path running parallel along the East side of the building
      const intersects = segmentIntersectsRectangle(
        6.535100, 80.401600,
        6.535600, 80.401600,
        sampleBuilding
      );
      expect(intersects).toBe(false);
    });
  });

  describe('segmentIntersectsAnyBuilding', () => {
    it('returns true if any building in the array is intersected', () => {
      const intersects = segmentIntersectsAnyBuilding(
        6.535100, 80.401200,
        6.535600, 80.401200,
        [sampleBuilding]
      );
      expect(intersects).toBe(true);
    });
  });

  describe('getBuildingCornerWaypoints', () => {
    it('generates 4 perimeter corner waypoints around building', () => {
      const corners = getBuildingCornerWaypoints(sampleBuilding, 2);
      expect(corners.nw.lat).toBeGreaterThan(sampleBuilding.maxLat);
      expect(corners.se.lat).toBeLessThan(sampleBuilding.minLat);
    });
  });

  describe('contourPathAroundBuildings', () => {
    it('bypasses a building when a route cuts through it', () => {
      const startNode: NavigationNode = {
        id: 'start',
        label: 'Start Node',
        latitude: 6.535100,
        longitude: 80.401200,
        floor: '1',
        type: 'path',
        store_id: null,
        created_at: '',
      };

      const endNode: NavigationNode = {
        id: 'end',
        label: 'End Node',
        latitude: 6.535600,
        longitude: 80.401200,
        floor: '1',
        type: 'path',
        store_id: null,
        created_at: '',
      };

      const originalRoute = [startNode, endNode];
      const contouredRoute = contourPathAroundBuildings(originalRoute, [sampleBuilding]);

      // Route must have added detour waypoints around corners
      expect(contouredRoute.length).toBeGreaterThan(originalRoute.length);
      expect(contouredRoute[0].id).toBe('start');
      expect(contouredRoute[contouredRoute.length - 1].id).toBe('end');
    });

    it('leaves route untouched if no buildings are intersected', () => {
      const startNode: NavigationNode = {
        id: 'start',
        label: 'Start Node',
        latitude: 6.535100,
        longitude: 80.402000,
        floor: '1',
        type: 'path',
        store_id: null,
        created_at: '',
      };

      const endNode: NavigationNode = {
        id: 'end',
        label: 'End Node',
        latitude: 6.535600,
        longitude: 80.402000,
        floor: '1',
        type: 'path',
        store_id: null,
        created_at: '',
      };

      const originalRoute = [startNode, endNode];
      const contouredRoute = contourPathAroundBuildings(originalRoute, [sampleBuilding]);
      expect(contouredRoute.length).toBe(2);
    });
  });
});
