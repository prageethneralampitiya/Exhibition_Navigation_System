import { getDistance, projectPointToSegment } from './dijkstra';
import { type NavigationNode, type NodeType, type Store } from '../lib/supabase';

export interface KmlCoordinate {
  lat: number;
  lng: number;
  alt?: number;
}

export interface KmlPath {
  id: string;
  name: string;
  description?: string;
  coordinates: KmlCoordinate[];
}

export interface KmlPoint {
  id: string;
  name: string;
  description?: string;
  coordinate: KmlCoordinate;
  inferredType: NodeType;
}

export interface ParsedKmlData {
  title: string;
  paths: KmlPath[];
  points: KmlPoint[];
  rawCount: {
    placemarks: number;
    lines: number;
    points: number;
  };
}

export interface KmlStoreToCreate {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  floor: string;
  is_active: boolean;
  categoryType: 'store' | 'facility';
  presetCategoryName: string;
}

export interface KmlConvertOptions {
  snapToleranceMeters?: number; // default 5.0m (practical for Google Earth mouse clicks)
  floor?: string;               // default '1'
  isBidirectional?: boolean;    // default true
  nodePrefix?: string;          // default 'KML'
  snapToExisting?: boolean;     // snap to existing nodes in DB
  existingNodes?: NavigationNode[];
  existingStores?: Store[];     // venue stores to automatically connect to closest walkway
  autoBridgeGaps?: boolean;     // bridge gaps between path endpoints (up to 12m)
  storeConnectThresholdMeters?: number; // default 35m
  createStallsInStores?: boolean;     // default true: auto-create Store records for stall pins
  createFacilitiesInStores?: boolean; // default true: auto-create Facility records in stores table for POIs
}

export interface GeneratedGraph {
  nodes: Array<{
    id: string;
    label: string;
    latitude: number;
    longitude: number;
    floor: string | null;
    type: NodeType;
    store_id: string | null;
  }>;
  edges: Array<{
    id: string;
    from_node_id: string;
    to_node_id: string;
    distance: number;
    is_bidirectional: boolean;
  }>;
  storesToCreate?: KmlStoreToCreate[];
  stats: {
    pathsCount: number;
    rawVerticesCount: number;
    nodesCreated: number;
    nodesReused: number;
    edgesCreated: number;
    totalDistanceMeters: number;
    storesConnectedCount: number;
    bridgesCreatedCount: number;
    stallsCreatedCount?: number;
    facilitiesCreatedCount?: number;
  };
}

/**
 * Parses raw coordinate text from a KML <coordinates> tag.
 * KML format: "lon,lat,alt lon,lat,alt" or "lon,lat,alt\nlon,lat,alt"
 */
export function parseKmlCoordinates(coordString: string): KmlCoordinate[] {
  const result: KmlCoordinate[] = [];
  const tokens = coordString.trim().split(/\s+/);

  for (const token of tokens) {
    if (!token) continue;
    const parts = token.split(',');
    if (parts.length >= 2) {
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const alt = parts.length >= 3 ? parseFloat(parts[2]) : undefined;

      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        result.push({ lat, lng, alt: isNaN(alt as number) ? undefined : alt });
      }
    }
  }

  return result;
}

/**
 * Infers detailed point classification, including whether it should generate a
 * Store or Facility record in the stores table.
 */
export function inferKmlPointClassification(name: string = '', desc: string = ''): {
  nodeType: NodeType;
  isStore: boolean;
  isFacility: boolean;
  presetCategoryName: string;
} {
  const combined = `${name} ${desc}`.toLowerCase();

  // Emergency / Medical / First Aid
  if (
    combined.includes('emergency') ||
    combined.includes('fire exit') ||
    combined.includes('first aid') ||
    combined.includes('medical') ||
    combined.includes('ambulance') ||
    combined.includes('doctor')
  ) {
    return {
      nodeType: 'emergency',
      isStore: false,
      isFacility: true,
      presetCategoryName: 'Emergency & First Aid',
    };
  }

  // Entrances / Gates
  if (
    combined.includes('entrance') ||
    combined.includes('gate') ||
    combined.includes('entry') ||
    combined.includes('door') ||
    combined.includes('main gate') ||
    combined.includes('security check') ||
    combined.includes('ticket')
  ) {
    return {
      nodeType: 'entrance',
      isStore: false,
      isFacility: false,
      presetCategoryName: 'Entrances',
    };
  }

  // Restrooms / Washrooms / Toilets
  if (
    combined.includes('washroom') ||
    combined.includes('toilet') ||
    combined.includes('restroom') ||
    combined.includes('wc') ||
    combined.includes('lavatory') ||
    combined.includes('urinal')
  ) {
    return {
      nodeType: 'poi',
      isStore: false,
      isFacility: true,
      presetCategoryName: 'Restrooms',
    };
  }

  // Canteens / Cafeterias / Dining / Food Courts
  if (
    combined.includes('canteen') ||
    combined.includes('cafeteria') ||
    combined.includes('dining') ||
    combined.includes('food') ||
    combined.includes('cafe') ||
    combined.includes('coffee') ||
    combined.includes('beverage') ||
    combined.includes('restaurant') ||
    combined.includes('snack')
  ) {
    return {
      nodeType: 'poi',
      isStore: false,
      isFacility: true,
      presetCategoryName: 'Food & Dining',
    };
  }

  // Amenities / Information / Services / Water
  if (
    combined.includes('info') ||
    combined.includes('help') ||
    combined.includes('reception') ||
    combined.includes('water') ||
    combined.includes('drinking') ||
    combined.includes('atm') ||
    combined.includes('parking') ||
    combined.includes('lost') ||
    combined.includes('stage') ||
    combined.includes('auditorium') ||
    combined.includes('poi')
  ) {
    return {
      nodeType: 'poi',
      isStore: false,
      isFacility: true,
      presetCategoryName: 'Facilities',
    };
  }

  // Default for non-entrance points: Exhibition Stall / Store / Booth
  return {
    nodeType: 'store',
    isStore: true,
    isFacility: false,
    presetCategoryName: 'Exhibition Stalls',
  };
}

/**
 * Infers a node type based on placemark name / description.
 */
function inferNodeType(name: string = '', desc: string = ''): NodeType {
  return inferKmlPointClassification(name, desc).nodeType;
}

/**
 * Parses a KML XML string using the browser's native DOMParser.
 */
export function parseKML(kmlText: string): ParsedKmlData {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(kmlText, 'text/xml');

  // Check for parse error
  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`Invalid KML / XML format: ${parserError.textContent?.slice(0, 150)}`);
  }

  const title =
    xmlDoc.querySelector('Document > name')?.textContent?.trim() ||
    xmlDoc.querySelector('kml > name')?.textContent?.trim() ||
    'Google Earth Import';

  const placemarks = xmlDoc.querySelectorAll('Placemark');
  const paths: KmlPath[] = [];
  const points: KmlPoint[] = [];

  let lineCounter = 1;
  let pointCounter = 1;

  placemarks.forEach((pm, idx) => {
    const name = pm.querySelector('name')?.textContent?.trim() || `Feature ${idx + 1}`;
    const desc = pm.querySelector('description')?.textContent?.trim() || '';

    // Check for LineString (paths)
    const lineStrings = pm.querySelectorAll('LineString');
    lineStrings.forEach((ls) => {
      const coordEl = ls.querySelector('coordinates');
      if (coordEl && coordEl.textContent) {
        const coords = parseKmlCoordinates(coordEl.textContent);
        if (coords.length >= 2) {
          paths.push({
            id: `kml-path-${lineCounter++}`,
            name: name || `Path ${lineCounter - 1}`,
            description: desc,
            coordinates: coords,
          });
        }
      }
    });

    // Check for Polygon / LinearRing (boundary walkway loops or courtyards)
    const linearRings = pm.querySelectorAll('Polygon LinearRing, LinearRing');
    linearRings.forEach((lr) => {
      // Avoid parsing if parent is already an innerBoundary
      if (lr.parentElement?.nodeName?.toLowerCase().includes('innerboundary')) return;
      const coordEl = lr.querySelector('coordinates');
      if (coordEl && coordEl.textContent) {
        const coords = parseKmlCoordinates(coordEl.textContent);
        if (coords.length >= 3) {
          paths.push({
            id: `kml-ring-${lineCounter++}`,
            name: name ? `${name} (Loop)` : `Walkway Loop ${lineCounter - 1}`,
            description: desc,
            coordinates: coords,
          });
        }
      }
    });

    // Check for GPS Track (gx:Track or Track recorded in Google Earth)
    const tracks = pm.querySelectorAll('Track, gx\\:Track');
    tracks.forEach((tr) => {
      const coordEls = tr.querySelectorAll('coord, gx\\:coord');
      const trackCoords: KmlCoordinate[] = [];
      coordEls.forEach((ce) => {
        if (ce.textContent) {
          const parts = ce.textContent.trim().split(/\s+/);
          if (parts.length >= 2) {
            const lng = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const alt = parts.length >= 3 ? parseFloat(parts[2]) : undefined;
            if (!isNaN(lat) && !isNaN(lng)) {
              trackCoords.push({ lat, lng, alt });
            }
          }
        }
      });
      if (trackCoords.length >= 2) {
        paths.push({
          id: `kml-track-${lineCounter++}`,
          name: name ? `${name} (Track)` : `Track ${lineCounter - 1}`,
          description: desc,
          coordinates: trackCoords,
        });
      }
    });

    // Check for Point (standalone pins)
    const pointEls = pm.querySelectorAll('Point');
    pointEls.forEach((pt) => {
      const coordEl = pt.querySelector('coordinates');
      if (coordEl && coordEl.textContent) {
        const coords = parseKmlCoordinates(coordEl.textContent);
        if (coords.length > 0) {
          points.push({
            id: `kml-point-${pointCounter++}`,
            name: name || `Point ${pointCounter - 1}`,
            description: desc,
            coordinate: coords[0],
            inferredType: inferNodeType(name, desc),
          });
        }
      }
    });
  });

  return {
    title,
    paths,
    points,
    rawCount: {
      placemarks: placemarks.length,
      lines: paths.length,
      points: points.length,
    },
  };
}

/**
 * Computes 2D segment intersection point in [lng, lat] coordinates if two segments cross.
 */
function getSegmentsIntersection(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): [number, number] | null {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t >= 0.001 && t <= 0.999 && u >= 0.001 && u <= 0.999) {
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }
  return null;
}

/**
 * Converts parsed KML paths and points into structured graph nodes and edges
 * with spatial snapping for junctions, edge segment splitting for T-junctions,
 * cross-intersection detection, and automatic connection to nearby existing nodes.
 */
export function convertKmlToGraph(
  data: ParsedKmlData,
  options: KmlConvertOptions = {}
): GeneratedGraph {
  // Default snap tolerance 5.0m: accommodates manual Google Earth digitization clicks
  const snapTolerance = options.snapToleranceMeters ?? 5.0;
  const floor = options.floor || '1';
  const isBidirectional = options.isBidirectional ?? true;
  const prefix = options.nodePrefix || 'KML';
  const existingNodes = options.snapToExisting && options.existingNodes ? options.existingNodes : [];
  const storeConnectThreshold = options.storeConnectThresholdMeters ?? 35.0;

  type ActiveNode = {
    id: string;
    label: string;
    latitude: number;
    longitude: number;
    floor: string | null;
    type: NodeType;
    store_id: string | null;
    isExisting?: boolean;
  };

  const activeNodes: ActiveNode[] = [];
  const edges: GeneratedGraph['edges'] = [];
  const edgeSet = new Set<string>(); // avoid duplicate edges

  let nodeCounter = 1;
  let rawVerticesCount = 0;
  let nodesReused = 0;
  let totalDistanceMeters = 0;

  function findCloseNode(lat: number, lng: number): ActiveNode | null {
    // 1. Check existing database nodes if snapping is enabled
    for (const en of existingNodes) {
      const dist = getDistance(lat, lng, en.latitude, en.longitude);
      if (dist <= snapTolerance) {
        return {
          id: en.id,
          label: en.label,
          latitude: en.latitude,
          longitude: en.longitude,
          floor: en.floor,
          type: en.type,
          store_id: en.store_id,
          isExisting: true,
        };
      }
    }

    // 2. Check newly created nodes in this conversion batch
    for (const an of activeNodes) {
      const dist = getDistance(lat, lng, an.latitude, an.longitude);
      if (dist <= snapTolerance) {
        return an;
      }
    }

    return null;
  }

  function addEdge(fromId: string, toId: string) {
    if (fromId === toId) return;
    const edgeKey1 = `${fromId}->${toId}`;
    const edgeKey2 = `${toId}->${fromId}`;

    if (edgeSet.has(edgeKey1) || (isBidirectional && edgeSet.has(edgeKey2))) {
      return;
    }

    const fromNode = activeNodes.find(n => n.id === fromId) || existingNodes.find(n => n.id === fromId);
    const toNode = activeNodes.find(n => n.id === toId) || existingNodes.find(n => n.id === toId);
    if (!fromNode || !toNode) return;

    const dist = Math.round(getDistance(fromNode.latitude, fromNode.longitude, toNode.latitude, toNode.longitude) * 100) / 100;
    totalDistanceMeters += dist;

    edges.push({
      id: crypto.randomUUID(),
      from_node_id: fromId,
      to_node_id: toId,
      distance: dist,
      is_bidirectional: isBidirectional,
    });

    edgeSet.add(edgeKey1);
    if (isBidirectional) edgeSet.add(edgeKey2);
  }

  function removeEdge(fromId: string, toId: string) {
    const idx = edges.findIndex(
      e => (e.from_node_id === fromId && e.to_node_id === toId) || (e.from_node_id === toId && e.to_node_id === fromId)
    );
    if (idx !== -1) {
      const removed = edges.splice(idx, 1)[0];
      totalDistanceMeters = Math.max(0, totalDistanceMeters - removed.distance);
      edgeSet.delete(`${fromId}->${toId}`);
      edgeSet.delete(`${toId}->${fromId}`);
    }
  }

  /**
   * Checks if a point lies near an existing edge segment. If so, splits the edge
   * and returns the newly inserted junction node.
   */
  function findOrSplitCloseEdge(lat: number, lng: number): ActiveNode | null {
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const nodeA = activeNodes.find(n => n.id === edge.from_node_id) || existingNodes.find(n => n.id === edge.from_node_id);
      const nodeB = activeNodes.find(n => n.id === edge.to_node_id) || existingNodes.find(n => n.id === edge.to_node_id);
      if (!nodeA || !nodeB) continue;

      const proj = projectPointToSegment(lat, lng, nodeA.latitude, nodeA.longitude, nodeB.latitude, nodeB.longitude);
      if (proj.distance <= snapTolerance) {
        const distToA = getDistance(proj.latitude, proj.longitude, nodeA.latitude, nodeA.longitude);
        const distToB = getDistance(proj.latitude, proj.longitude, nodeB.latitude, nodeB.longitude);

        if (distToA <= snapTolerance) {
          return nodeA;
        }
        if (distToB <= snapTolerance) {
          return nodeB;
        }

        // Mid-segment junction point: split edge A-B
        const junctionNode: ActiveNode = {
          id: crypto.randomUUID(),
          label: `${prefix}-Junction-${nodeCounter++}`,
          latitude: Math.round(proj.latitude * 1e7) / 1e7,
          longitude: Math.round(proj.longitude * 1e7) / 1e7,
          floor: nodeA.floor || floor || null,
          type: 'path',
          store_id: null,
        };
        activeNodes.push(junctionNode);
        nodesReused++;

        // Remove old edge and insert two split edges
        removeEdge(nodeA.id, nodeB.id);
        addEdge(nodeA.id, junctionNode.id);
        addEdge(junctionNode.id, nodeB.id);

        return junctionNode;
      }
    }
    return null;
  }

  const createStallsInStores = options.createStallsInStores ?? true;
  const createFacilitiesInStores = options.createFacilitiesInStores ?? true;
  const storesToCreate: KmlStoreToCreate[] = [];
  let stallsCreatedCount = 0;
  let facilitiesCreatedCount = 0;
  const standaloneNodes: ActiveNode[] = [];

  // 1. Process Standalone Points (Entrances, POIs, Stalls) first
  for (const pt of data.points) {
    const classification = inferKmlPointClassification(pt.name, pt.description);
    const shouldCreateStoreRecord =
      (classification.isStore && createStallsInStores) ||
      (classification.isFacility && createFacilitiesInStores);

    let storeId: string | null = null;
    if (shouldCreateStoreRecord) {
      storeId = crypto.randomUUID();
      storesToCreate.push({
        id: storeId,
        name: pt.name || (classification.isFacility ? 'Venue Facility' : `Stall ${stallsCreatedCount + 1}`),
        description: pt.description || (classification.isFacility ? 'Facility imported from KML' : 'Exhibition stall imported from KML'),
        latitude: Math.round(pt.coordinate.lat * 1e7) / 1e7,
        longitude: Math.round(pt.coordinate.lng * 1e7) / 1e7,
        floor: floor || '1',
        is_active: true,
        categoryType: classification.isFacility ? 'facility' : 'store',
        presetCategoryName: classification.presetCategoryName,
      });

      if (classification.isFacility) {
        facilitiesCreatedCount++;
      } else {
        stallsCreatedCount++;
      }
    }

    const existing = findCloseNode(pt.coordinate.lat, pt.coordinate.lng);
    if (existing) {
      nodesReused++;
      if (storeId && !existing.store_id) {
        existing.store_id = storeId;
        existing.type = classification.nodeType;
      }
      standaloneNodes.push(existing);
    } else {
      const newNode: ActiveNode = {
        id: crypto.randomUUID(),
        label: pt.name || `${prefix}-${classification.nodeType.toUpperCase()}-${nodeCounter++}`,
        latitude: Math.round(pt.coordinate.lat * 1e7) / 1e7,
        longitude: Math.round(pt.coordinate.lng * 1e7) / 1e7,
        floor: floor || null,
        type: classification.nodeType,
        store_id: storeId,
      };
      activeNodes.push(newNode);
      standaloneNodes.push(newNode);
    }
  }

  // 2. Process Paths (LineStrings)
  for (const path of data.paths) {
    const pathNodes: ActiveNode[] = [];

    for (let i = 0; i < path.coordinates.length; i++) {
      rawVerticesCount++;
      const coord = path.coordinates[i];
      // 1. Check exact/close vertex
      let matchedNode = findCloseNode(coord.lat, coord.lng);

      // 2. If no direct vertex match, check if this vertex connects to an edge segment (T-junction)
      if (!matchedNode) {
        matchedNode = findOrSplitCloseEdge(coord.lat, coord.lng);
      }

      if (matchedNode) {
        pathNodes.push(matchedNode);
        nodesReused++;
      } else {
        const isEndpoint = i === 0 || i === path.coordinates.length - 1;
        const nodeLabel = isEndpoint && path.name
          ? `${path.name} (${i === 0 ? 'Start' : 'End'})`
          : `${prefix}-${nodeCounter++}`;

        const newNode: ActiveNode = {
          id: crypto.randomUUID(),
          label: nodeLabel,
          latitude: Math.round(coord.lat * 1e7) / 1e7,
          longitude: Math.round(coord.lng * 1e7) / 1e7,
          floor: floor || null,
          type: 'path',
          store_id: null,
        };
        activeNodes.push(newNode);
        pathNodes.push(newNode);
      }
    }

    // Connect consecutive path nodes, checking for cross-line intersections
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const from = pathNodes[i];
      const to = pathNodes[i + 1];

      if (from.id === to.id) continue;

      // Check if this new edge (from -> to) intersects any already-created edge
      let intersectionInserted = false;
      const currentEdgesSnapshot = [...edges];
      for (const existingEdge of currentEdgesSnapshot) {
        if (existingEdge.from_node_id === from.id || existingEdge.from_node_id === to.id ||
            existingEdge.to_node_id === from.id || existingEdge.to_node_id === to.id) {
          continue; // Share an endpoint, not a crossing intersection
        }

        const nodeA = activeNodes.find(n => n.id === existingEdge.from_node_id) || existingNodes.find(n => n.id === existingEdge.from_node_id);
        const nodeB = activeNodes.find(n => n.id === existingEdge.to_node_id) || existingNodes.find(n => n.id === existingEdge.to_node_id);
        if (!nodeA || !nodeB) continue;

        const interPt = getSegmentsIntersection(
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
          [nodeA.longitude, nodeA.latitude],
          [nodeB.longitude, nodeB.latitude]
        );

        if (interPt) {
          const interNode: ActiveNode = {
            id: crypto.randomUUID(),
            label: `${prefix}-Intersection-${nodeCounter++}`,
            latitude: Math.round(interPt[1] * 1e7) / 1e7,
            longitude: Math.round(interPt[0] * 1e7) / 1e7,
            floor: from.floor || floor || null,
            type: 'path',
            store_id: null,
          };
          activeNodes.push(interNode);

          // Split existing edge
          removeEdge(nodeA.id, nodeB.id);
          addEdge(nodeA.id, interNode.id);
          addEdge(interNode.id, nodeB.id);

          // Connect from -> interNode -> to
          addEdge(from.id, interNode.id);
          addEdge(interNode.id, to.id);
          intersectionInserted = true;
          break;
        }
      }

      if (!intersectionInserted) {
        addEdge(from.id, to.id);
      }
    }
  }

  // 3. Connect nearby existing nodes (stores, stalls, entrances) to the new walkway graph
  let storesConnectedCount = 0;
  let bridgesCreatedCount = 0;

  if (existingNodes.length > 0 && edges.length > 0) {
    const proximityThreshold = Math.max(snapTolerance * 4, 30); // up to 30m for stalls/entrances
    for (const en of existingNodes) {
      // If this existing node is already connected to the graph edges, skip it!
      const alreadyConnected = edges.some(e => e.from_node_id === en.id || e.to_node_id === en.id);
      if (alreadyConnected) continue;

      let bestDist = Infinity;
      let targetNodeId: string | null = null;
      let bestEdge: typeof edges[0] | null = null;
      let bestProj: { latitude: number; longitude: number; distance: number } | null = null;

      for (const an of activeNodes) {
        const d = getDistance(en.latitude, en.longitude, an.latitude, an.longitude);
        if (d < bestDist) {
          bestDist = d;
          targetNodeId = an.id;
        }
      }

      for (const edge of edges) {
        const nodeA = activeNodes.find(n => n.id === edge.from_node_id) || existingNodes.find(n => n.id === edge.from_node_id);
        const nodeB = activeNodes.find(n => n.id === edge.to_node_id) || existingNodes.find(n => n.id === edge.to_node_id);
        if (!nodeA || !nodeB) continue;

        const proj = projectPointToSegment(en.latitude, en.longitude, nodeA.latitude, nodeA.longitude, nodeB.latitude, nodeB.longitude);
        if (proj.distance < bestDist) {
          bestDist = proj.distance;
          bestEdge = edge;
          bestProj = proj;
          targetNodeId = null;
        }
      }

      if (bestDist <= proximityThreshold) {
        if (targetNodeId) {
          addEdge(en.id, targetNodeId);
          storesConnectedCount++;
        } else if (bestEdge && bestProj) {
          const nodeA = activeNodes.find(n => n.id === bestEdge.from_node_id) || existingNodes.find(n => n.id === bestEdge.from_node_id)!;
          const nodeB = activeNodes.find(n => n.id === bestEdge.to_node_id) || existingNodes.find(n => n.id === bestEdge.to_node_id)!;
          const junctionNode: ActiveNode = {
            id: crypto.randomUUID(),
            label: `${en.label} Connection`,
            latitude: Math.round(bestProj.latitude * 1e7) / 1e7,
            longitude: Math.round(bestProj.longitude * 1e7) / 1e7,
            floor: en.floor || nodeA.floor || floor || null,
            type: 'path',
            store_id: null,
          };
          activeNodes.push(junctionNode);
          removeEdge(nodeA.id, nodeB.id);
          addEdge(nodeA.id, junctionNode.id);
          addEdge(junctionNode.id, nodeB.id);
          addEdge(en.id, junctionNode.id);
          storesConnectedCount++;
        }
      }
    }
  }

  // 4. Automatically connect venue stores & facilities to the closest walkway edge
  const existingStores = options.existingStores || [];
  if (existingStores.length > 0 && edges.length > 0) {
    for (const store of existingStores) {
      if (store.latitude == null || store.longitude == null) continue;

      // Check if store already has an active node in graph
      const alreadyHasConnectedNode = activeNodes.some(
        n => (n.store_id === store.id || (Math.abs(n.latitude - store.latitude!) < 0.00003 && Math.abs(n.longitude - store.longitude!) < 0.00003)) &&
          edges.some(e => e.from_node_id === n.id || e.to_node_id === n.id)
      ) || existingNodes.some(
        n => (n.store_id === store.id || (Math.abs(n.latitude - store.latitude!) < 0.00003 && Math.abs(n.longitude - store.longitude!) < 0.00003)) &&
          edges.some(e => e.from_node_id === n.id || e.to_node_id === n.id)
      );

      if (alreadyHasConnectedNode) continue;

      // Check if a node already exists for this store in existingNodes
      let storeNode = existingNodes.find(n => n.store_id === store.id) ||
        activeNodes.find(n => n.store_id === store.id);

      if (!storeNode) {
        const isGate = (store.name || '').toLowerCase().includes('entrance') || (store.name || '').toLowerCase().includes('gate');
        storeNode = {
          id: crypto.randomUUID(),
          label: store.name,
          latitude: Math.round(store.latitude * 1e7) / 1e7,
          longitude: Math.round(store.longitude * 1e7) / 1e7,
          floor: String(store.floor || floor || '1'),
          type: isGate ? 'entrance' : 'store',
          store_id: store.id,
        };
        activeNodes.push(storeNode);
      }

      // Find closest edge to connect perpendicular access
      let bestDist = Infinity;
      let bestEdge: typeof edges[0] | null = null;
      let bestProj: { latitude: number; longitude: number; distance: number } | null = null;

      for (const edge of edges) {
        const nodeA = activeNodes.find(n => n.id === edge.from_node_id) || existingNodes.find(n => n.id === edge.from_node_id);
        const nodeB = activeNodes.find(n => n.id === edge.to_node_id) || existingNodes.find(n => n.id === edge.to_node_id);
        if (!nodeA || !nodeB) continue;

        const proj = projectPointToSegment(storeNode.latitude, storeNode.longitude, nodeA.latitude, nodeA.longitude, nodeB.latitude, nodeB.longitude);
        if (proj.distance < bestDist) {
          bestDist = proj.distance;
          bestEdge = edge;
          bestProj = proj;
        }
      }

      if (bestDist <= storeConnectThreshold && bestEdge && bestProj) {
        const nodeA = activeNodes.find(n => n.id === bestEdge.from_node_id) || existingNodes.find(n => n.id === bestEdge.from_node_id)!;
        const nodeB = activeNodes.find(n => n.id === bestEdge.to_node_id) || existingNodes.find(n => n.id === bestEdge.to_node_id)!;

        const distToA = getDistance(bestProj.latitude, bestProj.longitude, nodeA.latitude, nodeA.longitude);
        const distToB = getDistance(bestProj.latitude, bestProj.longitude, nodeB.latitude, nodeB.longitude);

        if (distToA <= 2.5) {
          addEdge(storeNode.id, nodeA.id);
        } else if (distToB <= 2.5) {
          addEdge(storeNode.id, nodeB.id);
        } else {
          // Mid-edge perpendicular connection point for seamless turn-by-turn guidance
          const junctionNode: ActiveNode = {
            id: crypto.randomUUID(),
            label: `${store.name} Access Junction`,
            latitude: Math.round(bestProj.latitude * 1e7) / 1e7,
            longitude: Math.round(bestProj.longitude * 1e7) / 1e7,
            floor: storeNode.floor || nodeA.floor || floor || null,
            type: 'path',
            store_id: null,
          };
          activeNodes.push(junctionNode);
          removeEdge(nodeA.id, nodeB.id);
          addEdge(nodeA.id, junctionNode.id);
          addEdge(junctionNode.id, nodeB.id);
          addEdge(storeNode.id, junctionNode.id);
        }
        storesConnectedCount++;
      }
    }
  }

  // 4b. Connect newly created standalone stall/facility pins perpendicularly to the closest walkway edge
  for (const sNode of standaloneNodes) {
    const isConnected = edges.some(e => e.from_node_id === sNode.id || e.to_node_id === sNode.id);
    if (isConnected) continue;

    let bestDist = Infinity;
    let bestEdge: typeof edges[0] | null = null;
    let bestProj: { latitude: number; longitude: number; distance: number } | null = null;

    for (const edge of edges) {
      const nodeA = activeNodes.find(n => n.id === edge.from_node_id) || existingNodes.find(n => n.id === edge.from_node_id);
      const nodeB = activeNodes.find(n => n.id === edge.to_node_id) || existingNodes.find(n => n.id === edge.to_node_id);
      if (!nodeA || !nodeB) continue;

      const proj = projectPointToSegment(sNode.latitude, sNode.longitude, nodeA.latitude, nodeA.longitude, nodeB.latitude, nodeB.longitude);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        bestEdge = edge;
        bestProj = proj;
      }
    }

    if (bestDist <= storeConnectThreshold && bestEdge && bestProj) {
      const nodeA = activeNodes.find(n => n.id === bestEdge.from_node_id) || existingNodes.find(n => n.id === bestEdge.from_node_id)!;
      const nodeB = activeNodes.find(n => n.id === bestEdge.to_node_id) || existingNodes.find(n => n.id === bestEdge.to_node_id)!;

      const distToA = getDistance(bestProj.latitude, bestProj.longitude, nodeA.latitude, nodeA.longitude);
      const distToB = getDistance(bestProj.latitude, bestProj.longitude, nodeB.latitude, nodeB.longitude);

      if (distToA <= 2.5) {
        addEdge(sNode.id, nodeA.id);
      } else if (distToB <= 2.5) {
        addEdge(sNode.id, nodeB.id);
      } else {
        const junctionNode: ActiveNode = {
          id: crypto.randomUUID(),
          label: `${sNode.label} Access Junction`,
          latitude: Math.round(bestProj.latitude * 1e7) / 1e7,
          longitude: Math.round(bestProj.longitude * 1e7) / 1e7,
          floor: sNode.floor || nodeA.floor || floor || null,
          type: 'path',
          store_id: null,
        };
        activeNodes.push(junctionNode);
        removeEdge(nodeA.id, nodeB.id);
        addEdge(nodeA.id, junctionNode.id);
        addEdge(junctionNode.id, nodeB.id);
        addEdge(sNode.id, junctionNode.id);
      }
      storesConnectedCount++;
    }
  }

  // 5. Automatic Endpoint Gap Bridging between separate paths (up to 12m)
  if (options.autoBridgeGaps !== false && edges.length > 0) {
    const deadEndNodes = activeNodes.filter(n => {
      const edgeCount = edges.filter(e => e.from_node_id === n.id || e.to_node_id === n.id).length;
      return edgeCount === 1;
    });

    for (let i = 0; i < deadEndNodes.length; i++) {
      const nodeA = deadEndNodes[i];
      let closestNode: ActiveNode | null = null;
      let minGap = Infinity;

      for (let j = 0; j < deadEndNodes.length; j++) {
        if (i === j) continue;
        const nodeB = deadEndNodes[j];
        const d = getDistance(nodeA.latitude, nodeA.longitude, nodeB.latitude, nodeB.longitude);
        if (d > snapTolerance && d <= 12.0 && d < minGap) {
          minGap = d;
          closestNode = nodeB;
        }
      }

      if (closestNode && minGap <= 12.0) {
        addEdge(nodeA.id, closestNode.id);
        bridgesCreatedCount++;
      }
    }
  }

  // 6. Inferred Entrance: if graph has no entrance, designate the start node of the first path as entrance
  const hasEntrance = activeNodes.some(n => n.type === 'entrance') ||
    existingNodes.some(n => n.type === 'entrance' && edges.some(e => e.from_node_id === n.id || e.to_node_id === n.id));

  if (!hasEntrance && activeNodes.length > 0) {
    const firstPathNode = activeNodes.find(n => n.type === 'path' && !n.store_id);
    if (firstPathNode) {
      firstPathNode.type = 'entrance';
      if (!firstPathNode.label.toLowerCase().includes('entrance') && !firstPathNode.label.toLowerCase().includes('gate')) {
        firstPathNode.label = `${prefix}-Entrance-1`;
      }
    }
  }

  // Filter out any nodes that were already existing in DB so we only insert newly created ones
  const newNodesToInsert = activeNodes.filter((n) => !n.isExisting);

  return {
    nodes: newNodesToInsert.map(({ isExisting: _isExisting, ...rest }) => rest),
    edges,
    storesToCreate,
    stats: {
      pathsCount: data.paths.length,
      rawVerticesCount,
      nodesCreated: newNodesToInsert.length,
      nodesReused,
      edgesCreated: edges.length,
      totalDistanceMeters: Math.round(totalDistanceMeters * 10) / 10,
      storesConnectedCount,
      bridgesCreatedCount,
      stallsCreatedCount,
      facilitiesCreatedCount,
    },
  };
}

/**
 * Exports current navigation nodes and edges to standard OGC KML 2.2 format.
 */
export function exportGraphToKML(
  nodes: NavigationNode[],
  edges: Array<{ from_node_id: string; to_node_id: string; distance?: number; is_bidirectional?: boolean }>,
  title: string = 'Campus Navigation Graph'
): string {
  const nodeMap = new Map<string, NavigationNode>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const placemarkPoints = nodes
    .map(
      (n) => `    <Placemark>
      <name>${escapeXml(n.label)}</name>
      <description>Type: ${n.type} | Floor: ${n.floor || '1'}</description>
      <styleUrl>#nodeStyle</styleUrl>
      <Point>
        <coordinates>${n.longitude},${n.latitude},0</coordinates>
      </Point>
    </Placemark>`
    )
    .join('\n');

  const placemarkLines = edges
    .map((e, idx) => {
      const from = nodeMap.get(e.from_node_id);
      const to = nodeMap.get(e.to_node_id);
      if (!from || !to) return '';
      return `    <Placemark>
      <name>Path ${idx + 1} (${from.label} - ${to.label})</name>
      <description>Distance: ${e.distance ?? 'N/A'}m | Bidirectional: ${e.is_bidirectional ?? true}</description>
      <styleUrl>#pathStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          ${from.longitude},${from.latitude},0
          ${to.longitude},${to.latitude},0
        </coordinates>
      </LineString>
    </Placemark>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(title)}</name>
    <description>Exported navigation paths and nodes</description>
    <Style id="pathStyle">
      <LineStyle>
        <color>ff00aaff</color>
        <width>4</width>
      </LineStyle>
    </Style>
    <Style id="nodeStyle">
      <IconStyle>
        <scale>0.8</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Folder>
      <name>Navigation Paths</name>
${placemarkLines}
    </Folder>
    <Folder>
      <name>Navigation Nodes</name>
${placemarkPoints}
    </Folder>
  </Document>
</kml>`;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Helper to trigger a browser file download of KML content.
 */
export function downloadKmlFile(kmlContent: string, filename: string = 'campus-navigation.kml') {
  const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
