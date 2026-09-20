import { describe, it, expect } from 'vitest';
import {
  getDistance,
  projectPointToSegment,
  findClosestPointOnGraph,
  calculateShortestPath,
  calculateShortestPathBetweenCoordinates,
  computeGraphPathDistance,
  getHeading,
  advanceRouteOnEarlyTurn,
  computeCrowdCalibratedCoordinates,
} from '../dijkstra';
import { type NavigationNode, type NavigationEdge } from '../../lib/supabase';

describe('dijkstra.ts - Navigation Engine', () => {
  // ─── 1. Distance Calculation (Equirectangular) ──────────────────────────────
  describe('getDistance', () => {
    it('returns 0 for identical coordinates', () => {
      const d = getDistance(6.535472, 80.401000, 6.535472, 80.401000);
      expect(d).toBe(0);
    });

    it('accurately computes small-scale walking distances (< 100m)', () => {
      // Delta of approx 0.0001 degrees latitude is ~11.1 meters
      const d = getDistance(6.535000, 80.401000, 6.535100, 80.401000);
      expect(d).toBeGreaterThan(11.0);
      expect(d).toBeLessThan(11.3);
    });

    it('is symmetric: distance(A, B) === distance(B, A)', () => {
      const d1 = getDistance(6.535000, 80.401000, 6.535800, 80.401900);
      const d2 = getDistance(6.535800, 80.401900, 6.535000, 80.401000);
      expect(Math.abs(d1 - d2)).toBeLessThan(1e-6);
    });
  });

  // ─── 2. Segment Projection & Snapping ───────────────────────────────────────
  describe('projectPointToSegment', () => {
    it('returns the same point if query is already on the segment', () => {
      // Midpoint between lat 6.5350 and 6.5360
      const proj = projectPointToSegment(
        6.5355, 80.4010,
        6.5350, 80.4010,
        6.5360, 80.4010
      );
      expect(proj.distance).toBeLessThan(0.01);
      expect(proj.latitude).toBeCloseTo(6.5355, 5);
      expect(proj.longitude).toBeCloseTo(80.4010, 5);
    });

    it('clamps to endpoint A if point projects before start of segment', () => {
      const proj = projectPointToSegment(
        6.5340, 80.4010, // South of A
        6.5350, 80.4010, // A
        6.5360, 80.4010  // B
      );
      expect(proj.latitude).toBeCloseTo(6.5350, 5);
      expect(proj.longitude).toBeCloseTo(80.4010, 5);
    });

    it('clamps to endpoint B if point projects beyond end of segment', () => {
      const proj = projectPointToSegment(
        6.5370, 80.4010, // North of B
        6.5350, 80.4010, // A
        6.5360, 80.4010  // B
      );
      expect(proj.latitude).toBeCloseTo(6.5360, 5);
      expect(proj.longitude).toBeCloseTo(80.4010, 5);
    });
  });

  // ─── 3. Graph Snapping ──────────────────────────────────────────────────────
  describe('findClosestPointOnGraph', () => {
    const sampleNodes: NavigationNode[] = [
      { id: 'n1', label: 'Node 1', latitude: 6.5350, longitude: 80.4010, floor: '1', type: 'path', store_id: null, created_at: '' },
      { id: 'n2', label: 'Node 2', latitude: 6.5360, longitude: 80.4010, floor: '1', type: 'path', store_id: null, created_at: '' },
    ];
    const sampleEdges: NavigationEdge[] = [
      { id: 'e1', from_node_id: 'n1', to_node_id: 'n2', distance: 111, is_bidirectional: true, created_at: '' },
    ];

    it('returns exactNodeId when query is right at a node', () => {
      const snap = findClosestPointOnGraph(6.5350, 80.4010, sampleNodes, sampleEdges);
      expect(snap).not.toBeNull();
      expect(snap?.exactNodeId).toBe('n1');
      expect(snap?.snapDist).toBeLessThan(0.01);
    });

    it('returns mid-edge snap with fromNodeId and toNodeId when in the middle of a corridor', () => {
      // Query 5 meters east of the middle of the segment
      const midLat = 6.5355;
      const midLng = 80.40105;
      const snap = findClosestPointOnGraph(midLat, midLng, sampleNodes, sampleEdges);

      expect(snap).not.toBeNull();
      expect(snap?.snapLat).toBeCloseTo(6.5355, 4);
      expect(snap?.fromNodeId).toBe('n1');
      expect(snap?.toNodeId).toBe('n2');
    });

    it('returns null if graph has no nodes', () => {
      const snap = findClosestPointOnGraph(6.5350, 80.4010, [], []);
      expect(snap).toBeNull();
    });
  });

  // ─── 4. Pathfinding (calculateShortestPath) ─────────────────────────────────
  describe('calculateShortestPath', () => {
    const nodes: NavigationNode[] = [
      { id: 'A', label: 'Gate', latitude: 6.5350, longitude: 80.4010, floor: '1', type: 'entrance', store_id: null, created_at: '' },
      { id: 'B', label: 'Corridor Shortcut', latitude: 6.5352, longitude: 80.4010, floor: '1', type: 'path', store_id: null, created_at: '' },
      { id: 'C', label: 'Exhibition Hall', latitude: 6.5354, longitude: 80.4010, floor: '1', type: 'store', store_id: null, created_at: '' },
      { id: 'D', label: 'Courtyard Detour', latitude: 6.5352, longitude: 80.4020, floor: '1', type: 'path', store_id: null, created_at: '' },
      { id: 'Isolated', label: 'Isolated Node', latitude: 6.5380, longitude: 80.4080, floor: '1', type: 'path', store_id: null, created_at: '' },
    ];

    const edges: NavigationEdge[] = [
      // Short route: A -> B -> C (total dist: 20 + 20 = 40m)
      { id: 'e-ab', from_node_id: 'A', to_node_id: 'B', distance: 20, is_bidirectional: true, created_at: '' },
      { id: 'e-bc', from_node_id: 'B', to_node_id: 'C', distance: 20, is_bidirectional: true, created_at: '' },
      // Long route: A -> D -> C (total dist: 80 + 80 = 160m)
      { id: 'e-ad', from_node_id: 'A', to_node_id: 'D', distance: 80, is_bidirectional: true, created_at: '' },
      { id: 'e-dc', from_node_id: 'D', to_node_id: 'C', distance: 80, is_bidirectional: true, created_at: '' },
    ];

    it('always selects the true shortest path', () => {
      const path = calculateShortestPath('A', 'C', nodes, edges);
      expect(path.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    });

    it('returns a single node if startId === endId', () => {
      const path = calculateShortestPath('A', 'A', nodes, edges);
      expect(path.length).toBe(1);
      expect(path[0].id).toBe('A');
    });

    it('returns empty array if target is on a disconnected component', () => {
      const path = calculateShortestPath('A', 'Isolated', nodes, edges);
      expect(path).toEqual([]);
    });

    it('respects one-way edges (is_bidirectional: false)', () => {
      const oneWayEdges: NavigationEdge[] = [
        { id: 'e-one-way', from_node_id: 'A', to_node_id: 'B', distance: 20, is_bidirectional: false, created_at: '' },
      ];
      // A -> B is allowed
      const forwardPath = calculateShortestPath('A', 'B', nodes, oneWayEdges);
      expect(forwardPath.map((n) => n.id)).toEqual(['A', 'B']);

      // B -> A is forbidden
      const reversePath = calculateShortestPath('B', 'A', nodes, oneWayEdges);
      expect(reversePath).toEqual([]);
    });

    it('computes total path distance along graph correctly', () => {
      const dist = computeGraphPathDistance('A', 'C', nodes, edges);
      expect(dist).toBeCloseTo(44.48, 1);

      const unreachableDist = computeGraphPathDistance('A', 'Isolated', nodes, edges);
      expect(unreachableDist).toBe(Infinity);
    });
  });

  // ─── 5. Routing Between Arbitrary GPS Coordinates ───────────────────────────
  describe('calculateShortestPathBetweenCoordinates', () => {
    const nodes: NavigationNode[] = [
      { id: 'n1', label: 'Entrance Gate', latitude: 6.5350, longitude: 80.4010, floor: '1', type: 'entrance', store_id: null, created_at: '' },
      { id: 'n2', label: 'Main Hall', latitude: 6.5354, longitude: 80.4010, floor: '1', type: 'store', store_id: null, created_at: '' },
    ];
    const edges: NavigationEdge[] = [
      { id: 'e1', from_node_id: 'n1', to_node_id: 'n2', distance: 44, is_bidirectional: true, created_at: '' },
    ];

    it('routes successfully when coordinates are near graph endpoints', () => {
      const path = calculateShortestPathBetweenCoordinates(
        6.53501, 80.40101, // Near Entrance
        6.53539, 80.40099, // Near Hall
        nodes,
        edges
      );
      expect(path.length).toBeGreaterThanOrEqual(2);
    });

    it('handles start and destination coordinates placed along the same edge', () => {
      const path = calculateShortestPathBetweenCoordinates(
        6.5351, 80.4010, // Point 1 along edge
        6.5353, 80.4010, // Point 2 along edge
        nodes,
        edges
      );
      expect(path.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── 6. Compass Heading Calculations ────────────────────────────────────────
  describe('getHeading', () => {
    it('calculates cardinal North correctly', () => {
      const heading = getHeading(6.5350, 80.4010, 6.5360, 80.4010);
      expect(heading).toBe('North');
    });

    it('calculates cardinal South correctly', () => {
      const heading = getHeading(6.5360, 80.4010, 6.5350, 80.4010);
      expect(heading).toBe('South');
    });

    it('calculates cardinal East correctly', () => {
      const heading = getHeading(6.5350, 80.4010, 6.5350, 80.4020);
      expect(heading).toBe('East');
    });

    it('calculates cardinal West correctly', () => {
      const heading = getHeading(6.5350, 80.4020, 6.5350, 80.4010);
      expect(heading).toBe('West');
    });
  });

  // ─── 8. Adaptive Early-Turn Detection & Route Calibration ────────────────────
  describe('advanceRouteOnEarlyTurn', () => {
    const route: NavigationNode[] = [
      { id: 'n1', label: 'Start', latitude: 6.5350, longitude: 80.4010, floor: '1', type: 'path', store_id: null, created_at: '' },
      { id: 'n2', label: 'Corner Junction', latitude: 6.5355, longitude: 80.4010, floor: '1', type: 'path', store_id: null, created_at: '' },
      { id: 'n3', label: 'Destination Aisle', latitude: 6.5355, longitude: 80.4020, floor: '1', type: 'path', store_id: null, created_at: '' },
    ];

    it('advances route when user turns early onto next segment without reaching corner', () => {
      // User cuts the corner at (6.53545, 80.4013), which is close to edge n2->n3
      const userLat = 6.5355;
      const userLng = 80.4014;

      const result = advanceRouteOnEarlyTurn(userLat, userLng, route, 10);
      expect(result.didAdvance).toBe(true);
      expect(result.skippedNodes.map(n => n.id)).toContain('n2');
      expect(result.updatedRoute[result.updatedRoute.length - 1].id).toBe('n3');
    });

    it('does not advance if user is still on current segment walking towards corner', () => {
      // User is at (6.5352, 80.4010) on leg n1->n2
      const userLat = 6.5352;
      const userLng = 80.4010;

      const result = advanceRouteOnEarlyTurn(userLat, userLng, route, 8);
      expect(result.didAdvance).toBe(false);
      expect(result.updatedRoute).toEqual(route);
    });
  });

  // ─── 9. Crowd-Based Node Calibration ─────────────────────────────────────────
  describe('computeCrowdCalibratedCoordinates', () => {
    it('returns original coordinates when no crowd samples exist', () => {
      const res = computeCrowdCalibratedCoordinates(6.535000, 80.401000, []);
      expect(res.lat).toBe(6.535000);
      expect(res.lng).toBe(80.401000);
      expect(res.shiftMeters).toBe(0);
    });

    it('calibrates node towards crowd centroid using blend factor', () => {
      const originalLat = 6.535000;
      const originalLng = 80.401000;
      // Crowd turned 5 meters south at 6.534950, 80.401000
      const samples = [
        { lat: 6.534950, lng: 80.401000 },
        { lat: 6.534960, lng: 80.401010 },
      ];

      const res = computeCrowdCalibratedCoordinates(originalLat, originalLng, samples, 0.5);
      expect(res.shiftMeters).toBeGreaterThan(0);
      expect(res.lat).toBeLessThan(originalLat); // Shifted toward crowd samples
    });
  });
});

