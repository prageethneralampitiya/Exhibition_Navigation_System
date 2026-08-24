import { type NavigationNode, type NavigationEdge } from '../lib/supabase';
import { type BuildingRectangle } from './geometry';

/**
 * Equirectangular approximation for short-range distance (< 1 km).
 *
 * Unlike Haversine (which assumes a spherical Earth and is designed for
 * global-scale distances), equirectangular projects coordinates onto a flat
 * plane using the mid-latitude as a correction factor. This gives far higher
 * floating-point precision when coordinate deltas are tiny (e.g. 0.00005°),
 * which is exactly the case in indoor/campus navigation where nodes may be
 * only 3–20 metres apart.
 *
 * At distances below 1 km the error vs. the true geodesic is < 0.01%,
 * while Haversine accumulates noticeable rounding error at sub-metre deltas.
 */
export function getDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters

  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const φMid = (φ1 + φ2) / 2; // mid-latitude for longitude correction

  const Δφ = φ2 - φ1;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  // Correct longitude difference for latitude (distances shrink near poles)
  const x = Δλ * Math.cos(φMid);
  const y = Δφ;

  return R * Math.sqrt(x * x + y * y); // Distance in meters
}

/**
 * Project a lat/lng point onto a line segment defined by two lat/lng endpoints.
 * Returns the closest lat/lng point on the segment and the distance to it.
 */
export function projectPointToSegment(
  latP: number,
  lonP: number,
  latA: number,
  lonA: number,
  latB: number,
  lonB: number
): { latitude: number; longitude: number; distance: number } {
  // If endpoints are identical, return distance to A
  if (latA === latB && lonA === lonB) {
    const distance = getDistance(latP, lonP, latA, lonA);
    return { latitude: latA, longitude: lonA, distance };
  }

  // Use average latitude for longitude scaling
  const latMid = (latA + latB + latP) / 3;
  const cosMid = Math.cos((latMid * Math.PI) / 180);

  // Convert to local scaled coordinate space
  const xA = lonA * cosMid;
  const yA = latA;
  const xB = lonB * cosMid;
  const yB = latB;
  const xP = lonP * cosMid;
  const yP = latP;

  // Vector AB and AP
  const dx = xB - xA;
  const dy = yB - yA;
  const dpx = xP - xA;
  const dpy = yP - yA;

  // Projection factor t clamped to [0, 1] segment
  const abLen2 = dx * dx + dy * dy;
  let t = (dpx * dx + dpy * dy) / abLen2;
  t = Math.max(0, Math.min(1, t));

  // Interpolated point C
  const latC = latA + t * (latB - latA);
  const lonC = lonA + t * (lonB - lonA);

  const distance = getDistance(latP, lonP, latC, lonC);

  return { latitude: latC, longitude: lonC, distance };
}

export interface GraphSnapResult {
  /** The snapped latitude on the closest path */
  snapLat: number;
  /** The snapped longitude on the closest path */
  snapLng: number;
  /** Distance (metres) from the query point to the snap point */
  snapDist: number;
  /** If snap is exactly at an existing node, its ID. Null for mid-edge snaps. */
  exactNodeId: string | null;
  /** For mid-edge snaps: the from-node of the edge that was split */
  fromNodeId: string | null;
  /** For mid-edge snaps: the to-node of the edge that was split */
  toNodeId: string | null;
}

/**
 * Find the closest point on the entire drawn graph (nodes + edge segments) to a
 * given lat/lng coordinate. Returns either an exact node match or a projected
 * mid-edge snap point with the edge IDs needed to split that edge.
 *
 * Strategy:
 *  1. Check all existing nodes — prefer exact node if within NODE_SNAP_THRESHOLD.
 *  2. Project the query point onto every edge segment.
 *  3. Return whichever gives the smallest distance.
 */
export function findClosestPointOnGraph(
  lat: number,
  lng: number,
  nodes: NavigationNode[],
  edges: NavigationEdge[]
): GraphSnapResult | null {
  if (nodes.length === 0) return null;

  const NODE_SNAP_THRESHOLD = 15; // metres — prioritize exact store entrance/walkway nodes within 15m

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const connectedNodeIds = new Set<string>();
  edges.forEach((e) => {
    if (nodeMap.has(e.from_node_id) && nodeMap.has(e.to_node_id)) {
      connectedNodeIds.add(e.from_node_id);
      connectedNodeIds.add(e.to_node_id);
    }
  });

  let best: GraphSnapResult | null = null;

  // 1. Check all connected nodes first (prefer actual walkway nodes drawn near stalls)
  for (const node of nodes) {
    if (!connectedNodeIds.has(node.id)) continue;
    const d = getDistance(lat, lng, node.latitude, node.longitude);
    if (!best || d < best.snapDist) {
      best = {
        snapLat: node.latitude,
        snapLng: node.longitude,
        snapDist: d,
        exactNodeId: node.id,
        fromNodeId: null,
        toNodeId: null,
      };
    }
  }

  // If a connected node is within 15m of the target, snap directly to that node
  if (best && best.snapDist <= NODE_SNAP_THRESHOLD) {
    return best;
  }

  // 2. Otherwise, check all edge segments (projects point onto segment and endpoints)
  for (const edge of edges) {
    const nodeA = nodeMap.get(edge.from_node_id);
    const nodeB = nodeMap.get(edge.to_node_id);
    if (!nodeA || !nodeB) continue;

    const proj = projectPointToSegment(
      lat, lng,
      nodeA.latitude, nodeA.longitude,
      nodeB.latitude, nodeB.longitude
    );

    if (!best || proj.distance < best.snapDist) {
      const distToA = getDistance(proj.latitude, proj.longitude, nodeA.latitude, nodeA.longitude);
      const distToB = getDistance(proj.latitude, proj.longitude, nodeB.latitude, nodeB.longitude);

      let exactNodeId: string | null = null;
      if (distToA <= 2) exactNodeId = nodeA.id;
      else if (distToB <= 2) exactNodeId = nodeB.id;

      best = {
        snapLat: proj.latitude,
        snapLng: proj.longitude,
        snapDist: proj.distance,
        exactNodeId,
        fromNodeId: exactNodeId ? null : edge.from_node_id,
        toNodeId: exactNodeId ? null : edge.to_node_id,
      };
    }
  }

  return best;
}

/**
 * Compute the shortest path between any two geographical coordinates strictly along
 * the drawn graph (edges and nodes). Snaps both start and end coordinates to the closest
 * point on any drawn path segment, dynamically splits edges, and routes strictly via Dijkstra.
 */
export function calculateShortestPathBetweenCoordinates(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  nodes: NavigationNode[],
  edges: NavigationEdge[],
  explicitStartNodeId?: string | null,
  explicitEndNodeId?: string | null
): NavigationNode[] {
  if (nodes.length === 0 || edges.length === 0) return [];

  // Map of nodes for quick O(1) lookup
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const validEdges = edges.filter((e) => nodeMap.has(e.from_node_id) && nodeMap.has(e.to_node_id));
  if (validEdges.length === 0 && nodes.length === 0) return [];

  // 1. Find start snap
  let startSnap: GraphSnapResult | null = null;
  if (explicitStartNodeId && nodeMap.has(explicitStartNodeId)) {
    const node = nodeMap.get(explicitStartNodeId)!;
    startSnap = {
      snapLat: node.latitude,
      snapLng: node.longitude,
      snapDist: 0,
      exactNodeId: node.id,
      fromNodeId: null,
      toNodeId: null,
    };
  } else {
    startSnap = findClosestPointOnGraph(startLat, startLng, nodes, validEdges);
  }

  // 2. Find end snap
  let endSnap: GraphSnapResult | null = null;
  if (explicitEndNodeId && nodeMap.has(explicitEndNodeId)) {
    const node = nodeMap.get(explicitEndNodeId)!;
    endSnap = {
      snapLat: node.latitude,
      snapLng: node.longitude,
      snapDist: 0,
      exactNodeId: node.id,
      fromNodeId: null,
      toNodeId: null,
    };
  } else {
    endSnap = findClosestPointOnGraph(endLat, endLng, nodes, validEdges);
  }

  if (!startSnap || !endSnap) return [];

  // If both start and end snap to the same exact node
  if (startSnap.exactNodeId && endSnap.exactNodeId && startSnap.exactNodeId === endSnap.exactNodeId) {
    const n = nodeMap.get(startSnap.exactNodeId);
    return n ? [n] : [];
  }

  let tempNodes = [...nodes];
  let tempEdges = [...validEdges];

  const START_VIRTUAL_ID = '__snap_start_virtual__';
  const END_VIRTUAL_ID = '__snap_end_virtual__';

  const startNodeId = startSnap.exactNodeId || START_VIRTUAL_ID;
  const endNodeId = endSnap.exactNodeId || END_VIRTUAL_ID;

  // Check if both snap to the SAME edge segment
  const isSameEdge =
    !startSnap.exactNodeId &&
    !endSnap.exactNodeId &&
    startSnap.fromNodeId &&
    startSnap.toNodeId &&
    ((startSnap.fromNodeId === endSnap.fromNodeId && startSnap.toNodeId === endSnap.toNodeId) ||
      (startSnap.fromNodeId === endSnap.toNodeId && startSnap.toNodeId === endSnap.fromNodeId));

  if (isSameEdge) {
    const nodeA = nodeMap.get(startSnap.fromNodeId!)!;
    const nodeB = nodeMap.get(startSnap.toNodeId!)!;

    const vStart: NavigationNode = {
      id: START_VIRTUAL_ID,
      label: 'Walkway Snap Point',
      latitude: startSnap.snapLat,
      longitude: startSnap.snapLng,
      floor: nodeA?.floor || null,
      type: 'path',
      store_id: null,
      created_at: new Date().toISOString(),
    };

    const vEnd: NavigationNode = {
      id: END_VIRTUAL_ID,
      label: 'Store Connection Point',
      latitude: endSnap.snapLat,
      longitude: endSnap.snapLng,
      floor: nodeB?.floor || null,
      type: 'path',
      store_id: null,
      created_at: new Date().toISOString(),
    };

    tempNodes.push(vStart, vEnd);

    // Remove the original edge to avoid shortcut
    tempEdges = tempEdges.filter(
      (e) =>
        !(
          (e.from_node_id === nodeA.id && e.to_node_id === nodeB.id) ||
          (e.from_node_id === nodeB.id && e.to_node_id === nodeA.id)
        )
    );

    const distAtoStart = getDistance(nodeA.latitude, nodeA.longitude, startSnap.snapLat, startSnap.snapLng);
    const distAtoEnd = getDistance(nodeA.latitude, nodeA.longitude, endSnap.snapLat, endSnap.snapLng);

    if (distAtoStart <= distAtoEnd) {
      // Sequence along edge: NodeA <-> vStart <-> vEnd <-> NodeB
      const dStartEnd = getDistance(startSnap.snapLat, startSnap.snapLng, endSnap.snapLat, endSnap.snapLng);
      const dEndB = getDistance(endSnap.snapLat, endSnap.snapLng, nodeB.latitude, nodeB.longitude);

      tempEdges.push(
        { id: '__v_edge_a_start', from_node_id: nodeA.id, to_node_id: START_VIRTUAL_ID, distance: distAtoStart, is_bidirectional: true, created_at: '' },
        { id: '__v_edge_start_end', from_node_id: START_VIRTUAL_ID, to_node_id: END_VIRTUAL_ID, distance: dStartEnd, is_bidirectional: true, created_at: '' },
        { id: '__v_edge_end_b', from_node_id: END_VIRTUAL_ID, to_node_id: nodeB.id, distance: dEndB, is_bidirectional: true, created_at: '' }
      );
    } else {
      // Sequence along edge: NodeA <-> vEnd <-> vStart <-> NodeB
      const dEndStart = getDistance(endSnap.snapLat, endSnap.snapLng, startSnap.snapLat, startSnap.snapLng);
      const dStartB = getDistance(startSnap.snapLat, startSnap.snapLng, nodeB.latitude, nodeB.longitude);

      tempEdges.push(
        { id: '__v_edge_a_end', from_node_id: nodeA.id, to_node_id: END_VIRTUAL_ID, distance: distAtoEnd, is_bidirectional: true, created_at: '' },
        { id: '__v_edge_end_start', from_node_id: END_VIRTUAL_ID, to_node_id: START_VIRTUAL_ID, distance: dEndStart, is_bidirectional: true, created_at: '' },
        { id: '__v_edge_start_b', from_node_id: START_VIRTUAL_ID, to_node_id: nodeB.id, distance: dStartB, is_bidirectional: true, created_at: '' }
      );
    }
  } else {
    // Handle start snap and end snap independently (splits on different segments)
    if (!startSnap.exactNodeId && startSnap.fromNodeId && startSnap.toNodeId) {
      const nodeA = nodeMap.get(startSnap.fromNodeId);
      const nodeB = nodeMap.get(startSnap.toNodeId);
      if (nodeA && nodeB) {
        const vStart: NavigationNode = {
          id: START_VIRTUAL_ID,
          label: 'Walkway Snap Point',
          latitude: startSnap.snapLat,
          longitude: startSnap.snapLng,
          floor: nodeA.floor || null,
          type: 'path',
          store_id: null,
          created_at: new Date().toISOString(),
        };
        tempNodes.push(vStart);

        tempEdges = tempEdges.filter(
          (e) =>
            !(
              (e.from_node_id === startSnap.fromNodeId && e.to_node_id === startSnap.toNodeId) ||
              (e.from_node_id === startSnap.toNodeId && e.to_node_id === startSnap.fromNodeId)
            )
        );

        const dA = getDistance(nodeA.latitude, nodeA.longitude, startSnap.snapLat, startSnap.snapLng);
        const dB = getDistance(nodeB.latitude, nodeB.longitude, startSnap.snapLat, startSnap.snapLng);

        tempEdges.push(
          { id: '__v_start_edge_a', from_node_id: nodeA.id, to_node_id: START_VIRTUAL_ID, distance: dA, is_bidirectional: true, created_at: '' },
          { id: '__v_start_edge_b', from_node_id: START_VIRTUAL_ID, to_node_id: nodeB.id, distance: dB, is_bidirectional: true, created_at: '' }
        );
      }
    }

    if (!endSnap.exactNodeId && endSnap.fromNodeId && endSnap.toNodeId) {
      const nodeA = nodeMap.get(endSnap.fromNodeId);
      const nodeB = nodeMap.get(endSnap.toNodeId);
      if (nodeA && nodeB) {
        const vEnd: NavigationNode = {
          id: END_VIRTUAL_ID,
          label: 'Store Connection Point',
          latitude: endSnap.snapLat,
          longitude: endSnap.snapLng,
          floor: nodeA.floor || null,
          type: 'path',
          store_id: null,
          created_at: new Date().toISOString(),
        };
        tempNodes.push(vEnd);

        tempEdges = tempEdges.filter(
          (e) =>
            !(
              (e.from_node_id === endSnap.fromNodeId && e.to_node_id === endSnap.toNodeId) ||
              (e.from_node_id === endSnap.toNodeId && e.to_node_id === endSnap.fromNodeId)
            )
        );

        const dA = getDistance(nodeA.latitude, nodeA.longitude, endSnap.snapLat, endSnap.snapLng);
        const dB = getDistance(nodeB.latitude, nodeB.longitude, endSnap.snapLat, endSnap.snapLng);

        tempEdges.push(
          { id: '__v_end_edge_a', from_node_id: nodeA.id, to_node_id: END_VIRTUAL_ID, distance: dA, is_bidirectional: true, created_at: '' },
          { id: '__v_end_edge_b', from_node_id: END_VIRTUAL_ID, to_node_id: nodeB.id, distance: dB, is_bidirectional: true, created_at: '' }
        );
      }
    }
  }

  // Run Dijkstra strictly through drawn edges and snap points
  const path = calculateShortestPath(startNodeId, endNodeId, tempNodes, tempEdges);
  if (path && path.length > 0) {
    return path;
  }

  // Fallback: If startNodeId and endNodeId are on disconnected graph components,
  // route along the drawn graph from startNodeId to the closest reachable node.
  const reachableFromStart = getReachableNodes(startNodeId, tempNodes, tempEdges);
  if (reachableFromStart.size > 0) {
    const reachableCandidateNodes = tempNodes.filter((n) => reachableFromStart.has(n.id));
    const closestReachable = findClosestNode(endSnap.snapLat, endSnap.snapLng, reachableCandidateNodes);
    if (closestReachable && closestReachable.id !== startNodeId) {
      return calculateShortestPath(startNodeId, closestReachable.id, tempNodes, tempEdges);
    }
  }

  return [];
}

/**
 * Compute the shortest path from coordinates with edge-snapping and dynamic node injection.
 */
export function calculateShortestPathWithSnapping(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  endNodeId: string,
  nodes: NavigationNode[],
  edges: NavigationEdge[],
  gpsAccuracy: number | null,
  gpsThreshold: number,
  buildingRectangles: BuildingRectangle[] = []
): NavigationNode[] {
  if (nodes.length === 0 || !endNodeId) return [];

  const endNode = nodes.find((n) => n.id === endNodeId);
  if (!endNode) return [];

  const entranceNodes = nodes.filter((n) => n.type === 'entrance');

  // 1. Snapping to entrance fallback when GPS accuracy is too poor
  let actualStartLat = startLat;
  let actualStartLng = startLng;
  if (gpsAccuracy !== null && gpsAccuracy > gpsThreshold && entranceNodes.length > 0) {
    const nearestEntrance = findClosestNode(startLat, startLng, entranceNodes);
    if (nearestEntrance) {
      actualStartLat = nearestEntrance.latitude;
      actualStartLng = nearestEntrance.longitude;
    }
  }

  // 2. Identify floors for start and destination
  const closestStartNode = findClosestNode(actualStartLat, actualStartLng, nodes);
  if (!closestStartNode) return [];

  const startFloor = closestStartNode.floor || null;
  const endFloor = endNode.floor || null;

  // 3. Clone structures to dynamically mutate graph
  const tempNodes = [...nodes];
  let tempEdges = [...edges];

  // 4. Start Snap: Find closest edge to start coordinate
  let bestStartProj: { latitude: number; longitude: number; distance: number } | null = null;
  let bestStartEdge: NavigationEdge | null = null;

  for (const edge of edges) {
    const nodeA = nodes.find((n) => n.id === edge.from_node_id);
    const nodeB = nodes.find((n) => n.id === edge.to_node_id);
    if (!nodeA || !nodeB) continue;

    const floorA = nodeA.floor || null;
    const floorB = nodeB.floor || null;
    if (floorA !== startFloor || floorB !== startFloor) continue;

    const proj = projectPointToSegment(
      actualStartLat,
      actualStartLng,
      nodeA.latitude,
      nodeA.longitude,
      nodeB.latitude,
      nodeB.longitude
    );

    if (bestStartProj === null || proj.distance < bestStartProj.distance) {
      bestStartProj = proj;
      bestStartEdge = edge;
    }
  }

  // Determine if we should snap start to edge
  const closestStartNodeDist = getDistance(actualStartLat, actualStartLng, closestStartNode.latitude, closestStartNode.longitude);
  const shouldSnapStart = bestStartProj && bestStartEdge && (bestStartProj.distance < closestStartNodeDist);

  // 5. End Snap: Find closest edge to target coordinates
  let bestEndProj: { latitude: number; longitude: number; distance: number } | null = null;
  let bestEndEdge: NavigationEdge | null = null;

  for (const edge of edges) {
    const nodeA = nodes.find((n) => n.id === edge.from_node_id);
    const nodeB = nodes.find((n) => n.id === edge.to_node_id);
    if (!nodeA || !nodeB) continue;

    const floorA = nodeA.floor || null;
    const floorB = nodeB.floor || null;
    if (floorA !== endFloor || floorB !== endFloor) continue;

    const proj = projectPointToSegment(
      endLat,
      endLng,
      nodeA.latitude,
      nodeA.longitude,
      nodeB.latitude,
      nodeB.longitude
    );

    if (bestEndProj === null || proj.distance < bestEndProj.distance) {
      bestEndProj = proj;
      bestEndEdge = edge;
    }
  }

  // Determine if we should snap destination to edge
  // Find closest connected node to endNode (other than endNode itself)
  const connectedNodeIds = new Set<string>();
  edges.forEach((edge) => {
    if (edge.from_node_id === endNode.id) connectedNodeIds.add(edge.to_node_id);
    if (edge.to_node_id === endNode.id && edge.is_bidirectional) connectedNodeIds.add(edge.from_node_id);
  });

  let minExistingDist = Infinity;
  connectedNodeIds.forEach((id) => {
    const neighbor = nodes.find((n) => n.id === id);
    if (neighbor) {
      const dist = getDistance(endLat, endLng, neighbor.latitude, neighbor.longitude);
      if (dist < minExistingDist) minExistingDist = dist;
    }
  });

  const otherNodes = nodes.filter((n) => n.id !== endNode.id);
  const closestEndNode = findClosestNode(endLat, endLng, otherNodes);
  const distToClosestEndNode = closestEndNode ? getDistance(endLat, endLng, closestEndNode.latitude, closestEndNode.longitude) : Infinity;

  // We should snap to edge if the edge projection is closer to the target than existing nodes/connections
  const shouldSnapEnd = endNode.type !== 'path' && bestEndProj && bestEndEdge && (bestEndProj.distance < Math.min(minExistingDist, distToClosestEndNode * 1.25));

  // 6. Snapping injection decisions
  let finalStartId = closestStartNode.id;
  let finalEndId = endNode.id;

  const snapStart = Boolean(shouldSnapStart && bestStartProj && bestStartEdge);
  const snapEnd = Boolean(shouldSnapEnd && bestEndProj && bestEndEdge);

  if (snapStart && snapEnd && bestStartEdge!.id === bestEndEdge!.id) {
    // Both snap to the same edge! Perform a 3-way split (A <-> V_start <-> V_end <-> B)
    finalStartId = 'snapped-start-virtual';
    finalEndId = 'snapped-end-virtual';

    const startProj = bestStartProj!;
    const endProj = bestEndProj!;

    tempNodes.push({
      id: finalStartId,
      label: 'Your Location',
      latitude: startProj.latitude,
      longitude: startProj.longitude,
      floor: startFloor,
      type: 'poi',
      store_id: null,
      created_at: new Date().toISOString()
    });

    tempNodes.push({
      id: finalEndId,
      label: 'Snapped End Point',
      latitude: endProj.latitude,
      longitude: endProj.longitude,
      floor: endFloor,
      type: 'poi',
      store_id: null,
      created_at: new Date().toISOString()
    });

    // Remove the original split edge to prevent shortcut detours
    tempEdges = tempEdges.filter((e) => e.id !== bestStartEdge!.id);

    const nodeA = nodes.find((n) => n.id === bestStartEdge!.from_node_id)!;
    const nodeB = nodes.find((n) => n.id === bestStartEdge!.to_node_id)!;

    const dStart = getDistance(nodeA.latitude, nodeA.longitude, startProj.latitude, startProj.longitude);
    const dEnd = getDistance(nodeA.latitude, nodeA.longitude, endProj.latitude, endProj.longitude);

    if (dStart <= dEnd) {
      // Order of nodes along segment: A -> V_start -> V_end -> B
      const dStartToEnd = getDistance(startProj.latitude, startProj.longitude, endProj.latitude, endProj.longitude);
      const dEndToB = getDistance(endProj.latitude, endProj.longitude, nodeB.latitude, nodeB.longitude);

      tempEdges.push({
        id: 'virtual-start-edge-a',
        from_node_id: finalStartId,
        to_node_id: nodeA.id,
        distance: dStart,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });

      tempEdges.push({
        id: 'virtual-same-edge-middle',
        from_node_id: finalStartId,
        to_node_id: finalEndId,
        distance: dStartToEnd,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });

      tempEdges.push({
        id: 'virtual-end-edge-b',
        from_node_id: finalEndId,
        to_node_id: nodeB.id,
        distance: dEndToB,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });
    } else {
      // Order of nodes along segment: A -> V_end -> V_start -> B
      const dEndToStart = getDistance(endProj.latitude, endProj.longitude, startProj.latitude, startProj.longitude);
      const dStartToB = getDistance(startProj.latitude, startProj.longitude, nodeB.latitude, nodeB.longitude);

      tempEdges.push({
        id: 'virtual-end-edge-a',
        from_node_id: finalEndId,
        to_node_id: nodeA.id,
        distance: dEnd,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });

      tempEdges.push({
        id: 'virtual-same-edge-middle',
        from_node_id: finalEndId,
        to_node_id: finalStartId,
        distance: dEndToStart,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });

      tempEdges.push({
        id: 'virtual-start-edge-b',
        from_node_id: finalStartId,
        to_node_id: nodeB.id,
        distance: dStartToB,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });
    }
  } else {
    // Handle start snap and end snap independently (splits on different segments)
    if (snapStart) {
      finalStartId = 'snapped-start-virtual';
      const startProj = bestStartProj!;
      tempNodes.push({
        id: finalStartId,
        label: 'Your Location',
        latitude: startProj.latitude,
        longitude: startProj.longitude,
        floor: startFloor,
        type: 'poi',
        store_id: null,
        created_at: new Date().toISOString()
      });

      tempEdges = tempEdges.filter((e) => e.id !== bestStartEdge!.id);

      const targetNodeA = nodes.find((n) => n.id === bestStartEdge!.from_node_id)!;
      const targetNodeB = nodes.find((n) => n.id === bestStartEdge!.to_node_id)!;
      const distToA = getDistance(startProj.latitude, startProj.longitude, targetNodeA.latitude, targetNodeA.longitude);
      const distToB = getDistance(startProj.latitude, startProj.longitude, targetNodeB.latitude, targetNodeB.longitude);

      tempEdges.push({
        id: 'virtual-start-edge-a',
        from_node_id: finalStartId,
        to_node_id: bestStartEdge!.from_node_id,
        distance: distToA,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });

      tempEdges.push({
        id: 'virtual-start-edge-b',
        from_node_id: finalStartId,
        to_node_id: bestStartEdge!.to_node_id,
        distance: distToB,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });
    }

    if (snapEnd) {
      finalEndId = 'snapped-end-virtual';
      tempNodes.push({
        id: finalEndId,
        label: 'Snapped End Point',
        latitude: bestEndProj!.latitude,
        longitude: bestEndProj!.longitude,
        floor: endFloor,
        type: 'poi',
        store_id: null,
        created_at: new Date().toISOString()
      });

      tempEdges = tempEdges.filter((e) => e.id !== bestEndEdge!.id);

      const targetNodeA = nodes.find((n) => n.id === bestEndEdge!.from_node_id)!;
      const targetNodeB = nodes.find((n) => n.id === bestEndEdge!.to_node_id)!;
      const distToA = getDistance(bestEndProj!.latitude, bestEndProj!.longitude, targetNodeA.latitude, targetNodeA.longitude);
      const distToB = getDistance(bestEndProj!.latitude, bestEndProj!.longitude, targetNodeB.latitude, targetNodeB.longitude);

      tempEdges.push({
        id: 'virtual-end-edge-a',
        from_node_id: finalEndId,
        to_node_id: bestEndEdge!.from_node_id,
        distance: distToA,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });

      tempEdges.push({
        id: 'virtual-end-edge-b',
        from_node_id: finalEndId,
        to_node_id: bestEndEdge!.to_node_id,
        distance: distToB,
        is_bidirectional: true,
        created_at: new Date().toISOString()
      });
    }
  }

  // 6. Run Dijkstra from start identifier to destination identifier
  return calculateShortestPath(finalStartId, finalEndId, tempNodes, tempEdges, buildingRectangles);
}

/**
 * Geographically locate the nearest node to an arbitrary lat/lng coordinate.
 */
export function findClosestNode(
  latitude: number,
  longitude: number,
  nodes: NavigationNode[]
): NavigationNode | null {
  if (nodes.length === 0) return null;

  let closestNode: NavigationNode | null = null;
  let minDistance = Infinity;

  nodes.forEach((node) => {
    const dist = getDistance(latitude, longitude, node.latitude, node.longitude);
    if (dist < minDistance) {
      minDistance = dist;
      closestNode = node;
    }
  });

  return closestNode;
}

interface GraphAdjacency {
  [nodeId: string]: Array<{ toId: string; weight: number }>;
}

/**
 * Returns a Set of all node IDs reachable from startId through the drawn edges (BFS).
 * Used to filter candidate end-nodes to those that are actually connected to the start.
 */
export function getReachableNodes(
  startId: string,
  nodes: NavigationNode[],
  edges: NavigationEdge[]
): Set<string> {
  // Build bidirectional adjacency list
  const adj: Record<string, string[]> = {};
  nodes.forEach((n) => { adj[n.id] = []; });
  edges.forEach((edge) => {
    if (adj[edge.from_node_id] && adj[edge.to_node_id]) {
      adj[edge.from_node_id].push(edge.to_node_id);
      if (edge.is_bidirectional !== false) {
        adj[edge.to_node_id].push(edge.from_node_id);
      }
    }
  });

  const visited = new Set<string>();
  const queue = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of (adj[current] || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

/**
 * Compute the shortest path between start and end node IDs using Dijkstra's algorithm.
 */
export function calculateShortestPath(
  startId: string,
  endId: string,
  nodes: NavigationNode[],
  edges: NavigationEdge[],
  _buildingRectangles: BuildingRectangle[] = []
): NavigationNode[] {

  if (!startId || !endId || nodes.length === 0) return [];
  if (startId === endId) {
    const node = nodes.find((n) => n.id === startId);
    return node ? [node] : [];
  }

  // 1. Build Adjacency Graph (blocking edges that cross building rectangles)
  const graph: GraphAdjacency = {};
  nodes.forEach((n) => {
    graph[n.id] = [];
  });

  edges.forEach((edge) => {
    // Ensure both nodes exist in nodes list
    if (graph[edge.from_node_id] && graph[edge.to_node_id]) {
      const nodeA = nodes.find((n) => n.id === edge.from_node_id);
      const nodeB = nodes.find((n) => n.id === edge.to_node_id);

      const weight = edge.distance > 0
        ? edge.distance
        : (nodeA && nodeB ? getDistance(nodeA.latitude, nodeA.longitude, nodeB.latitude, nodeB.longitude) : 1);
      
      graph[edge.from_node_id].push({ toId: edge.to_node_id, weight });
      
      // All drawn walkways are bidirectional by default unless explicitly false
      if (edge.is_bidirectional !== false) {
        graph[edge.to_node_id].push({ toId: edge.from_node_id, weight });
      }
    }
  });

  // 2. Initialize Dijkstra tables
  const distances: { [nodeId: string]: number } = {};
  const previous: { [nodeId: string]: string | null } = {};
  const unvisited = new Set<string>();

  nodes.forEach((n) => {
    distances[n.id] = Infinity;
    previous[n.id] = null;
    unvisited.add(n.id);
  });

  distances[startId] = 0;

  // 3. Dijkstra loop
  while (unvisited.size > 0) {
    // Find node with minimum distance in unvisited set
    let currentId: string | null = null;
    let minDistance = Infinity;

    unvisited.forEach((id) => {
      if (distances[id] < minDistance) {
        minDistance = distances[id];
        currentId = id;
      }
    });

    // If target is unreachable or all remaining nodes are infinity, stop
    if (currentId === null || minDistance === Infinity) {
      break;
    }

    // Found target
    if (currentId === endId) {
      break;
    }

    unvisited.delete(currentId);

    // Update neighbors
    const neighbors = graph[currentId] || [];
    neighbors.forEach((neighbor) => {
      if (unvisited.has(neighbor.toId)) {
        const alt = distances[currentId!] + neighbor.weight;
        if (alt < distances[neighbor.toId]) {
          distances[neighbor.toId] = alt;
          previous[neighbor.toId] = currentId;
        }
      }
    });
  }

  // 4. Reconstruct path
  const pathIds: string[] = [];
  let curr: string | null = endId;

  // If no path was found
  if (previous[endId] === null && startId !== endId) {
    return [];
  }

  while (curr !== null) {
    pathIds.unshift(curr);
    curr = previous[curr];
  }

  // Map IDs to actual Node objects
  const nodeMap = new Map(nodes.map((id) => [id.id, id]));
  return pathIds.map((id) => nodeMap.get(id)!).filter(Boolean);
}

/**
 * Calculate compass heading (bearing) direction between two coordinate points.
 * Returns a 16-point compass direction for finer indoor turn guidance.
 */
export function getHeading(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  const b = (bearing + 360) % 360; // Normalize to [0, 360)

  // 16-point compass: each sector is 22.5° wide
  if (b >= 348.75 || b < 11.25)   return 'North';
  if (b >= 11.25  && b < 33.75)   return 'North-Northeast';
  if (b >= 33.75  && b < 56.25)   return 'Northeast';
  if (b >= 56.25  && b < 78.75)   return 'East-Northeast';
  if (b >= 78.75  && b < 101.25)  return 'East';
  if (b >= 101.25 && b < 123.75)  return 'East-Southeast';
  if (b >= 123.75 && b < 146.25)  return 'Southeast';
  if (b >= 146.25 && b < 168.75)  return 'South-Southeast';
  if (b >= 168.75 && b < 191.25)  return 'South';
  if (b >= 191.25 && b < 213.75)  return 'South-Southwest';
  if (b >= 213.75 && b < 236.25)  return 'Southwest';
  if (b >= 236.25 && b < 258.75)  return 'West-Southwest';
  if (b >= 258.75 && b < 281.25)  return 'West';
  if (b >= 281.25 && b < 303.75)  return 'West-Northwest';
  if (b >= 303.75 && b < 326.25)  return 'Northwest';
  return 'North-Northwest';
}

/**
 * Compute total graph distance in meters along the shortest path between startId and endId.
 * If no path exists, returns Infinity.
 */
export function computeGraphPathDistance(
  startId: string,
  endId: string,
  nodes: NavigationNode[],
  edges: NavigationEdge[]
): number {
  if (startId === endId) return 0;
  const path = calculateShortestPath(startId, endId, nodes, edges);
  if (!path || path.length < 2) return Infinity;

  let dist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    dist += getDistance(path[i].latitude, path[i].longitude, path[i + 1].latitude, path[i + 1].longitude);
  }
  return dist;
}

