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

/**
 * Fetch a walking route from OSRM public API between start and end coordinates.
 * Returns null if network fails or no route is found.
 */
export async function fetchOSRMRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  startLabel = 'Your Location',
  targetLabel = 'Destination'
): Promise<OSRMRouteResult | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(4000), // 4s timeout fallback
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.routes || data.routes.length === 0) return null;

    const route = data.routes[0];
    const geometry = route.geometry; // GeoJSON LineString coordinates: [[lng, lat], ...]
    const distanceMeters = Math.round(route.distance || 0);

    if (!geometry || !geometry.coordinates || geometry.coordinates.length === 0) {
      return null;
    }

    const coords: [number, number][] = geometry.coordinates;

    // Convert GeoJSON [lng, lat] array to NavigationNode[]
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

    // Build turn guidance steps
    const steps: string[] = [];
    if (route.legs && route.legs[0] && route.legs[0].steps) {
      steps.push(`Start from ${startLabel}`);
      const osrmSteps = route.legs[0].steps;

      osrmSteps.forEach((step: any) => {
        if (step.maneuver && step.instruction) {
          steps.push(step.instruction);
        } else if (step.name) {
          steps.push(`Follow ${step.name} for ${Math.round(step.distance)}m`);
        }
      });

      steps.push(`Arrive at ${targetLabel}`);
    } else {
      const heading = getHeading(startLat, startLng, endLat, endLng);
      steps.push(`Start from ${startLabel}`);
      steps.push(`Head ${heading} along street network for ${distanceMeters} meters to ${targetLabel}`);
      steps.push(`Arrive at ${targetLabel}`);
    }

    return {
      nodes,
      totalDistanceMeters: distanceMeters,
      guideSteps: steps,
    };
  } catch (err) {
    console.warn('OSRM outdoor street routing unavailable, falling back to graph/direct routing:', err);
    return null;
  }
}
