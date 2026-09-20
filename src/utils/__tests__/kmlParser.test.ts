import { describe, it, expect } from 'vitest';
import {
  parseKmlCoordinates,
  convertKmlToGraph,
  exportGraphToKML,
  type ParsedKmlData,
} from '../kmlParser';
import { type NavigationNode } from '../../lib/supabase';

describe('kmlParser.ts - Google Earth KML Engine', () => {
  describe('parseKmlCoordinates', () => {
    it('correctly parses lon,lat,alt whitespace-delimited coordinate string', () => {
      const coordStr = `
        80.401000,6.535000,0
        80.401200,6.535200,10.5
        80.401400,6.535400
      `;
      const coords = parseKmlCoordinates(coordStr);

      expect(coords.length).toBe(3);
      expect(coords[0]).toEqual({ lat: 6.535000, lng: 80.401000, alt: 0 });
      expect(coords[1]).toEqual({ lat: 6.535200, lng: 80.401200, alt: 10.5 });
      expect(coords[2]).toEqual({ lat: 6.535400, lng: 80.401400, alt: undefined });
    });

    it('filters out invalid or out-of-range coordinates', () => {
      const invalidStr = `999.0,999.0,0 invalid,text 80.4010,6.5350`;
      const coords = parseKmlCoordinates(invalidStr);

      expect(coords.length).toBe(1);
      expect(coords[0].lat).toBe(6.5350);
      expect(coords[0].lng).toBe(80.4010);
    });
  });

  describe('convertKmlToGraph & Junction Snapping', () => {
    it('merges path endpoints that meet at a junction within snap tolerance', () => {
      // Two paths that intersect at Gate 1:
      // Path 1 ends at (6.535000, 80.401000)
      // Path 2 starts at (6.535005, 80.401005) - ~0.7m away
      const mockParsedData: ParsedKmlData = {
        title: 'Campus Test',
        paths: [
          {
            id: 'p1',
            name: 'Main Walkway',
            coordinates: [
              { lat: 6.534800, lng: 80.401000 },
              { lat: 6.535000, lng: 80.401000 }, // Junction
            ],
          },
          {
            id: 'p2',
            name: 'Library Corridor',
            coordinates: [
              { lat: 6.535005, lng: 80.401005 }, // Slightly off click in Google Earth (~0.7m)
              { lat: 6.535200, lng: 80.401000 },
            ],
          },
        ],
        points: [],
        rawCount: { placemarks: 2, lines: 2, points: 0 },
      };

      const graph = convertKmlToGraph(mockParsedData, {
        snapToleranceMeters: 1.5,
        floor: '1',
        isBidirectional: true,
      });

      // Instead of 4 separate nodes, junction vertices should snap into 1 shared node -> 3 nodes total!
      expect(graph.stats.nodesCreated).toBe(3);
      expect(graph.stats.nodesReused).toBe(1);
      expect(graph.edges.length).toBe(2);
      expect(graph.stats.totalDistanceMeters).toBeGreaterThan(0);
    });

    it('snaps new paths to existing database nodes when requested', () => {
      const existingDbNodes: NavigationNode[] = [
        {
          id: 'existing-gate-1',
          label: 'Existing Main Gate',
          latitude: 6.535000,
          longitude: 80.401000,
          floor: '1',
          type: 'entrance',
          store_id: null,
          created_at: '',
        },
      ];

      const mockParsedData: ParsedKmlData = {
        title: 'New Path',
        paths: [
          {
            id: 'p-new',
            name: 'New Pathway',
            coordinates: [
              { lat: 6.535004, lng: 80.401002 }, // Close to existing gate (~0.5m)
              { lat: 6.535300, lng: 80.401000 },
            ],
          },
        ],
        points: [],
        rawCount: { placemarks: 1, lines: 1, points: 0 },
      };

      const graph = convertKmlToGraph(mockParsedData, {
        snapToleranceMeters: 1.5,
        snapToExisting: true,
        existingNodes: existingDbNodes,
      });

      // The first point should have snapped to the existing node, so only 1 new node is created!
      expect(graph.stats.nodesCreated).toBe(1);
      // The edge connects from existing node to the new node
      expect(graph.edges[0].from_node_id).toBe('existing-gate-1');
    });
  });

  describe('exportGraphToKML', () => {
    it('generates a valid KML string with nodes and paths', () => {
      const nodes: NavigationNode[] = [
        { id: '1', label: 'Entrance Gate', latitude: 6.5350, longitude: 80.4010, floor: '1', type: 'entrance', store_id: null, created_at: '' },
        { id: '2', label: 'Tech Pavilion', latitude: 6.5355, longitude: 80.4015, floor: '1', type: 'store', store_id: null, created_at: '' },
      ];
      const edges = [
        { from_node_id: '1', to_node_id: '2', distance: 60, is_bidirectional: true },
      ];

      const kml = exportGraphToKML(nodes, edges, 'Test Export');

      expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
      expect(kml).toContain('<name>Test Export</name>');
      expect(kml).toContain('Entrance Gate');
      expect(kml).toContain('Tech Pavilion');
      expect(kml).toContain('<LineString>');
      expect(kml).toContain('80.401,6.535,0');
    });
  });
});
