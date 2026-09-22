import { describe, it, expect } from 'vitest';
import {
  parseKmlCoordinates,
  parseKML,
  inferKmlPointClassification,
  convertKmlToGraph,
  exportGraphToKML,
  type ParsedKmlData,
} from '../kmlParser';
import { type NavigationNode, type Store } from '../../lib/supabase';

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

  describe('parseKML XML string parsing', () => {
    it('parses LineStrings, Polygons and Points from KML string if DOMParser is present', () => {
      if (typeof DOMParser === 'undefined') return;

      const sampleKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Campus Boundary and Walkways</name>
    <Placemark>
      <name>Main Walkway</name>
      <LineString>
        <coordinates>
          80.4010,6.5350,0 80.4020,6.5350,0
        </coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <name>Central Courtyard Loop</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              80.4010,6.5350,0 80.4020,6.5350,0 80.4020,6.5360,0 80.4010,6.5350,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
    <Placemark>
      <name>Main Entrance Gate</name>
      <Point>
        <coordinates>80.4010,6.5350,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;

      const parsed = parseKML(sampleKml);
      expect(parsed.title).toBe('Campus Boundary and Walkways');
      expect(parsed.paths.length).toBe(2); // 1 LineString + 1 LinearRing Loop
      expect(parsed.points.length).toBe(1); // 1 Entrance Point
      expect(parsed.points[0].inferredType).toBe('entrance');
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

    it('splits edge and inserts junction node when a branch path forms a T-junction with another segment', () => {
      // Main Path: (6.5350, 80.4010) -> (6.5360, 80.4010) [approx 111m long North-South]
      // Branch Path: starts at midpoint (6.5355, 80.4010) and goes East to (6.5355, 80.4020)
      const mockTData: ParsedKmlData = {
        title: 'T-Junction Test',
        paths: [
          {
            id: 'main-road',
            name: 'Main Walkway',
            coordinates: [
              { lat: 6.5350, lng: 80.4010 },
              { lat: 6.5360, lng: 80.4010 },
            ],
          },
          {
            id: 'branch-road',
            name: 'Side Aisle',
            coordinates: [
              { lat: 6.535502, lng: 80.401002 }, // Near midpoint of main road (~0.3m)
              { lat: 6.5355, lng: 80.4020 },
            ],
          },
        ],
        points: [],
        rawCount: { placemarks: 2, lines: 2, points: 0 },
      };

      const graph = convertKmlToGraph(mockTData, { snapToleranceMeters: 5.0 });

      // There should be a junction node inserted on the main road
      const junctionNode = graph.nodes.find(n => n.label.includes('Junction'));
      expect(junctionNode).toBeDefined();
      expect(junctionNode!.latitude).toBeCloseTo(6.5355, 3);
      // Main road was split into 2 edges, plus branch road has 1 edge = 3 edges total
      expect(graph.edges.length).toBe(3);
    });

    it('automatically connects nearby existing store nodes to the walkway graph', () => {
      const existingStores: NavigationNode[] = [
        {
          id: 'store-alpha',
          label: 'Health Stall A',
          latitude: 6.5352,
          longitude: 80.4011, // ~11m East of the path (6.5350 -> 6.5360 at 80.4010)
          floor: '1',
          type: 'store',
          store_id: 'stall-123',
          created_at: '',
        },
      ];

      const mockData: ParsedKmlData = {
        title: 'Store Connectivity Test',
        paths: [
          {
            id: 'path-1',
            name: 'Exhibition Corridor',
            coordinates: [
              { lat: 6.5350, lng: 80.4010 },
              { lat: 6.5360, lng: 80.4010 },
            ],
          },
        ],
        points: [],
        rawCount: { placemarks: 1, lines: 1, points: 0 },
      };

      const graph = convertKmlToGraph(mockData, {
        snapToleranceMeters: 5.0,
        snapToExisting: true,
        existingNodes: existingStores,
      });

      // Existing store should have an edge connecting it to the graph
      const storeEdge = graph.edges.find(e => e.from_node_id === 'store-alpha' || e.to_node_id === 'store-alpha');
      expect(storeEdge).toBeDefined();
    });

    it('automatically connects venue Store records perpendicularly to the closest walkway edge', () => {
      const mockStores: Store[] = [
        {
          id: 'store-vitality',
          name: 'Vitality Health Stall',
          description: 'Herbal Supplements',
          logo_url: null,
          category_id: null,
          exhibition_id: null,
          floor: '1',
          opening_time: null,
          closing_time: null,
          latitude: 6.5355,
          longitude: 80.4011, // ~11m East of the path
          phone: null,
          email: null,
          website: null,
          is_active: true,
          created_by: null,
          store_admin_id: null,
          created_at: '',
          updated_at: '',
        },
      ];

      const mockData: ParsedKmlData = {
        title: 'Walkway Import',
        paths: [
          {
            id: 'walkway-1',
            name: 'Main Aisle',
            coordinates: [
              { lat: 6.5350, lng: 80.4010 },
              { lat: 6.5360, lng: 80.4010 },
            ],
          },
        ],
        points: [],
        rawCount: { placemarks: 1, lines: 1, points: 0 },
      };

      const graph = convertKmlToGraph(mockData, {
        existingStores: mockStores,
        storeConnectThresholdMeters: 35,
      });

      // Should have created a store node, an access junction node on the walkway, and connector edge
      expect(graph.stats.storesConnectedCount).toBe(1);
      const storeNode = graph.nodes.find(n => n.store_id === 'store-vitality');
      expect(storeNode).toBeDefined();
      expect(storeNode?.label).toBe('Vitality Health Stall');

      // The store node must have a connection to the walkway
      const storeEdge = graph.edges.find(e => e.from_node_id === storeNode?.id || e.to_node_id === storeNode?.id);
      expect(storeEdge).toBeDefined();
      expect(storeEdge?.distance).toBeLessThan(35);
    });

    it('automatically bridges endpoint gaps between separate paths when autoBridgeGaps is enabled', () => {
      // Path 1 ends at (6.535000, 80.401000)
      // Path 2 starts at (6.535050, 80.401000) -> approx ~5.5 meters away
      const mockData: ParsedKmlData = {
        title: 'Gapped Paths',
        paths: [
          {
            id: 'p1',
            name: 'North Corridor',
            coordinates: [
              { lat: 6.5348, lng: 80.4010 },
              { lat: 6.5350, lng: 80.4010 },
            ],
          },
          {
            id: 'p2',
            name: 'South Corridor',
            coordinates: [
              { lat: 6.53505, lng: 80.4010 }, // ~5.5m gap
              { lat: 6.5353, lng: 80.4010 },
            ],
          },
        ],
        points: [],
        rawCount: { placemarks: 2, lines: 2, points: 0 },
      };

      // With autoBridgeGaps enabled (tolerance default 12m)
      const graph = convertKmlToGraph(mockData, {
        autoBridgeGaps: true,
        snapToleranceMeters: 2.0, // small snap tolerance so they are not merged directly
      });

      expect(graph.stats.bridgesCreatedCount).toBeGreaterThanOrEqual(1);
      // The total edges should include the bridging edge
      expect(graph.edges.length).toBe(3);
    });

    it('automatically classifies KML points and generates storesToCreate records for stalls and facilities', () => {
      const mockDataWithPoints: ParsedKmlData = {
        title: 'Exhibition Ground Plan',
        paths: [
          {
            id: 'walkway-main',
            name: 'Main Avenue',
            coordinates: [
              { lat: 6.5350, lng: 80.4010 },
              { lat: 6.5360, lng: 80.4010 },
            ],
          },
        ],
        points: [
          {
            id: 'pt-1',
            name: 'Stall 42 - Herbal Remedies',
            description: 'Organic Teas & Medicines',
            coordinate: { lat: 6.5353, lng: 80.4011 }, // ~11m from walkway
            inferredType: 'store',
          },
          {
            id: 'pt-2',
            name: 'Men & Women Restrooms',
            description: 'Public Washroom Block',
            coordinate: { lat: 6.5357, lng: 80.4011 }, // ~11m from walkway
            inferredType: 'poi',
          },
        ],
        rawCount: { placemarks: 3, lines: 1, points: 2 },
      };

      const graph = convertKmlToGraph(mockDataWithPoints, {
        createStallsInStores: true,
        createFacilitiesInStores: true,
        storeConnectThresholdMeters: 35,
      });

      // Verification of storesToCreate
      expect(graph.storesToCreate).toBeDefined();
      expect(graph.storesToCreate?.length).toBe(2);

      const stallRecord = graph.storesToCreate?.find(s => s.name === 'Stall 42 - Herbal Remedies');
      expect(stallRecord).toBeDefined();
      expect(stallRecord?.categoryType).toBe('store');

      const facilityRecord = graph.storesToCreate?.find(s => s.name.includes('Restrooms'));
      expect(facilityRecord).toBeDefined();
      expect(facilityRecord?.categoryType).toBe('facility');
      expect(facilityRecord?.presetCategoryName).toBe('Restrooms');

      // Stats check
      expect(graph.stats.stallsCreatedCount).toBe(1);
      expect(graph.stats.facilitiesCreatedCount).toBe(1);

      // Node check: navigation nodes have linked store_id
      const stallNode = graph.nodes.find(n => n.store_id === stallRecord?.id);
      expect(stallNode).toBeDefined();
      expect(stallNode?.type).toBe('store');

      const facilityNode = graph.nodes.find(n => n.store_id === facilityRecord?.id);
      expect(facilityNode).toBeDefined();
      expect(facilityNode?.type).toBe('poi');

      // Edge check: both stall and facility are connected to the walkway via perpendicular edges
      const stallEdge = graph.edges.find(e => e.from_node_id === stallNode?.id || e.to_node_id === stallNode?.id);
      expect(stallEdge).toBeDefined();

      const facilityEdge = graph.edges.find(e => e.from_node_id === facilityNode?.id || e.to_node_id === facilityNode?.id);
      expect(facilityEdge).toBeDefined();
    });
  });

  describe('inferKmlPointClassification', () => {
    it('correctly classifies stalls, facilities, restrooms, emergency and entrance points', () => {
      const stall = inferKmlPointClassification('Stall 15', 'Electronics booth');
      expect(stall.isStore).toBe(true);
      expect(stall.isFacility).toBe(false);
      expect(stall.nodeType).toBe('store');

      const restroom = inferKmlPointClassification('Visitor Restroom', 'Clean toilets');
      expect(restroom.isStore).toBe(false);
      expect(restroom.isFacility).toBe(true);
      expect(restroom.presetCategoryName).toBe('Restrooms');
      expect(restroom.nodeType).toBe('poi');

      const canteen = inferKmlPointClassification('School Canteen', 'Snacks and beverages');
      expect(canteen.isStore).toBe(false);
      expect(canteen.isFacility).toBe(true);
      expect(canteen.presetCategoryName).toBe('Food & Dining');
      expect(canteen.nodeType).toBe('poi');

      const firstAid = inferKmlPointClassification('First Aid Tent', 'Medical doctor on duty');
      expect(firstAid.isFacility).toBe(true);
      expect(firstAid.presetCategoryName).toBe('Emergency & First Aid');
      expect(firstAid.nodeType).toBe('emergency');

      const entrance = inferKmlPointClassification('North Main Gate', 'Entrance ticket checkpoint');
      expect(entrance.isStore).toBe(false);
      expect(entrance.isFacility).toBe(false);
      expect(entrance.nodeType).toBe('entrance');
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
