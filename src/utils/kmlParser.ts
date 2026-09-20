import { getDistance } from './dijkstra';
import { type NavigationNode, type NodeType } from '../lib/supabase';

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

export interface KmlConvertOptions {
  snapToleranceMeters?: number; // default 1.5m
  floor?: string;               // default '1'
  isBidirectional?: boolean;    // default true
  nodePrefix?: string;          // default 'N'
  snapToExisting?: boolean;     // snap to existing nodes in DB
  existingNodes?: NavigationNode[];
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
  stats: {
    pathsCount: number;
    rawVerticesCount: number;
    nodesCreated: number;
    nodesReused: number;
    edgesCreated: number;
    totalDistanceMeters: number;
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
 * Infers a node type based on placemark name / description.
 */
function inferNodeType(name: string = '', desc: string = ''): NodeType {
  const combined = `${name} ${desc}`.toLowerCase();
  if (combined.includes('emergency') || combined.includes('fire exit')) return 'emergency';
  if (combined.includes('entrance') || combined.includes('gate') || combined.includes('entry') || combined.includes('door')) return 'entrance';
  if (combined.includes('stall') || combined.includes('store') || combined.includes('shop') || combined.includes('booth')) return 'store';
  if (combined.includes('washroom') || combined.includes('toilet') || combined.includes('canteen') || combined.includes('poi') || combined.includes('info')) return 'poi';
  return 'path';
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
 * Converts parsed KML paths and points into structured graph nodes and edges
 * with spatial snapping for junctions.
 */
export function convertKmlToGraph(
  data: ParsedKmlData,
  options: KmlConvertOptions = {}
): GeneratedGraph {
  const snapTolerance = options.snapToleranceMeters ?? 1.5;
  const floor = options.floor || '1';
  const isBidirectional = options.isBidirectional ?? true;
  const prefix = options.nodePrefix || 'KML';
  const existingNodes = options.snapToExisting && options.existingNodes ? options.existingNodes : [];

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

  // 1. Process Standalone Points (Entrances, POIs, Stalls) first
  for (const pt of data.points) {
    const existing = findCloseNode(pt.coordinate.lat, pt.coordinate.lng);
    if (existing) {
      nodesReused++;
    } else {
      const newNode: ActiveNode = {
        id: crypto.randomUUID(),
        label: pt.name || `${prefix}-POI-${nodeCounter++}`,
        latitude: Math.round(pt.coordinate.lat * 1e7) / 1e7,
        longitude: Math.round(pt.coordinate.lng * 1e7) / 1e7,
        floor: floor || null,
        type: pt.inferredType,
        store_id: null,
      };
      activeNodes.push(newNode);
    }
  }

  // 2. Process Paths (LineStrings)
  for (const path of data.paths) {
    const pathNodes: ActiveNode[] = [];

    for (let i = 0; i < path.coordinates.length; i++) {
      rawVerticesCount++;
      const coord = path.coordinates[i];
      const match = findCloseNode(coord.lat, coord.lng);

      if (match) {
        pathNodes.push(match);
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

    // Create edges connecting consecutive path nodes
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const from = pathNodes[i];
      const to = pathNodes[i + 1];

      // Avoid self-loops if two consecutive vertices snapped to same node
      if (from.id === to.id) continue;

      const edgeKey1 = `${from.id}->${to.id}`;
      const edgeKey2 = `${to.id}->${from.id}`;

      if (edgeSet.has(edgeKey1) || (isBidirectional && edgeSet.has(edgeKey2))) {
        continue; // Already connected
      }

      const dist = Math.round(getDistance(from.latitude, from.longitude, to.latitude, to.longitude) * 100) / 100;
      totalDistanceMeters += dist;

      edges.push({
        id: crypto.randomUUID(),
        from_node_id: from.id,
        to_node_id: to.id,
        distance: dist,
        is_bidirectional: isBidirectional,
      });

      edgeSet.add(edgeKey1);
      if (isBidirectional) edgeSet.add(edgeKey2);
    }
  }

  // Filter out any nodes that were already existing in DB so we only insert newly created ones
  const newNodesToInsert = activeNodes.filter((n) => !n.isExisting);

  return {
    nodes: newNodesToInsert.map(({ isExisting: _isExisting, ...rest }) => rest),
    edges,
    stats: {
      pathsCount: data.paths.length,
      rawVerticesCount,
      nodesCreated: newNodesToInsert.length,
      nodesReused,
      edgesCreated: edges.length,
      totalDistanceMeters: Math.round(totalDistanceMeters * 10) / 10,
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
