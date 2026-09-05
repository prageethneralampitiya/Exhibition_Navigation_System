/**
 * Open Source Routing Machine (OSRM) Outdoor Road Routing Service
 * Fetches walking paths that follow real OpenStreetMap streets, sidewalks, and footpaths,
 * automatically avoiding buildings on public roads.
 */

import { type NavigationNode } from '../lib/supabase';
import { getHeading } from './dijkstra';

export interface OSRMRouteResult {
  nodes: NavigationNode[];
  totalDistanceMeters: number;
  guideSteps: string[];
}

/** OSRM v5 maneuver → human-readable turn instruction */
function maneuverToText(type: string, modifier?: string, name?: string): string {
  const road = name && name.trim() ? ` onto ${name}` : '';
  switch (type) {
    case 'depart': return `Head out${road}`;
    case 'arrive': return `Arrive at destination`;
    case 'turn': {
      const dir = modifier === 'left' ? 'Turn left' :
                  modifier === 'right' ? 'Turn right' :
                  modifier === 'slight left' ? 'Slight left' :
                  modifier === 'slight right' ? 'Slight right' :
                  modifier === 'sharp left' ? 'Sharp left' :
                  modifier === 'sharp right' ? 'Sharp right' :
                  modifier === 'uturn' ? 'Make a U-turn' : 'Continue';
      return `${dir}${road}`;
    }
    case 'continue': return `Continue${road}`;
    case 'merge': return `Merge${modifier ? ` ${modifier}` : ''}${road}`;
    case 'fork': return `At the fork, keep ${modifier || 'straight'}${road}`;
    case 'end of road': return `At the end of road, turn ${modifier || 'right'}${road}`;
    case 'roundabout': return `Enter roundabout${road}`;
    case 'rotary': return `Enter rotary${road}`;
    case 'roundabout turn': return `At the roundabout, turn ${modifier || 'right'}${road}`;
    case 'exit roundabout': return `Exit the roundabout${road}`;
    case 'exit rotary': return `Exit the rotary${road}`;
    default: return `Continue${road}`;
  }
}

/**
 * Attempt to fetch a walking route from a given OSRM endpoint.
 * Returns parsed data or null on failure.
 */
async function tryOSRMEndpoint(
  baseUrl: string,
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
  timeoutMs: number
): Promise<any | null> {
  try {
    const url = `${baseUrl}${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Fetch a walking route from OSRM public API between start and end coordinates.
 * Tries the public OSRM server first, then falls back to a secondary endpoint.
 * Returns null if all attempts fail or no route is found.
 */
export async function fetchOSRMRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  startLabel = 'Your Location',
  targetLabel = 'Destination'
): Promise<OSRMRouteResult | null> {
  // Primary: public OSRM demo server (foot profile = same as walking)
  // Secondary: router.project-osrm.org with driving (last resort, less accurate for pedestrians)
  const ENDPOINTS = [
    'https://router.project-osrm.org/route/v1/foot/',
    'https://routing.openstreetmap.de/routed-foot/route/v1/driving/',
  ];

  let data: any = null;

  for (const endpoint of ENDPOINTS) {
    data = await tryOSRMEndpoint(endpoint, startLng, startLat, endLng, endLat, 8000);
    if (data) break;
  }

  if (!data) {
    console.warn('All OSRM endpoints failed — no street route available.');
    return null;
  }

  try {
    const route = data.routes[0];
    const geometry = route.geometry; // GeoJSON LineString: [[lng, lat], ...]
    const distanceMeters = Math.round(route.distance || 0);

    if (!geometry?.coordinates?.length) return null;

    const coords: [number, number][] = geometry.coordinates;

    // Convert GeoJSON [lng, lat] pairs → NavigationNode[]
    const nodes: NavigationNode[] = coords.map((c, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === coords.length - 1;
      let label = `Street Waypoint ${idx + 1}`;
      if (isStart) label = startLabel;
      if (isEnd) label = targetLabel;

      return {
        id: `osrm-node-${idx}-${c[0].toFixed(5)}-${c[1].toFixed(5)}`,
        label,
        latitude: c[1],
        longitude: c[0],
        floor: null,
        type: isStart ? 'poi' : isEnd ? 'store' : 'path',
        store_id: null,
        created_at: new Date().toISOString(),
      };
    });

    // Build turn guidance from OSRM v5 leg steps
    const steps: string[] = [`Start from ${startLabel}`];
    const leg = route.legs?.[0];

    if (leg?.steps?.length) {
      leg.steps.forEach((step: any) => {
        const maneuver = step.maneuver;
        if (!maneuver) return;
        // Skip depart (already handled) and arrive (added separately)
        if (maneuver.type === 'arrive') return;

        const dist = step.distance > 0 ? ` (${Math.round(step.distance)}m)` : '';
        const instruction = maneuverToText(maneuver.type, maneuver.modifier, step.name);
        if (instruction && step.distance > 3) {
          steps.push(`${instruction}${dist}`);
        }
      });
    } else {
      // Fallback: compass heading when steps are unavailable
      const heading = getHeading(startLat, startLng, endLat, endLng);
      steps.push(`Head ${heading} along street network for ${distanceMeters}m`);
    }

    steps.push(`🏫 Arrive at ${targetLabel}`);

    return { nodes, totalDistanceMeters: distanceMeters, guideSteps: steps };
  } catch (err) {
    console.warn('Error parsing OSRM route response:', err);
    return null;
  }
}
