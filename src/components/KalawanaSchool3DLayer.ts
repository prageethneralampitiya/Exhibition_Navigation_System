import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import { supabase } from '../lib/supabase';

// ── Anchor & Scale Constants ───────────────────────────────────
export const KALAWANA_ANCHOR_LAT = 6.535472;
export const KALAWANA_ANCHOR_LNG = 80.401000;

export const SCALE = 0.16;
export const OX = 384;
export const OY = 270;

export interface BuildingConfig {
  id: string;
  name: string;
  corners: [number, number][];
  cat: 'main' | 'road' | 'out';
  height: number;
  roof: 'hip' | 'flat';
  scaleMultiplier?: number;
  latOffsetMeters?: number;
  lngOffsetMeters?: number;
  altitudeMeters?: number;
  wallColor?: string;
  roofColor?: string;
  isDeleted?: boolean;
}

export interface CalibrationConfig {
  scaleMultiplier: number;  // 1.0 = default (0.16)
  rotationAngle: number;    // degrees (-180 to +180)
  latOffsetMeters: number;  // meters North (+)/South (-)
  lngOffsetMeters: number;  // meters East (+)/West (-)
  altitudeMeters: number;   // meters Up (+)/Down (-)
  buildings?: BuildingConfig[];
  selectedBuildingId?: string | null;
  showSelectionHighlight?: boolean;
}

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  scaleMultiplier: 1.0,
  rotationAngle: 0,
  latOffsetMeters: 0,
  lngOffsetMeters: 0,
  altitudeMeters: 0,
  selectedBuildingId: null,
  showSelectionHighlight: false,
};

const STORAGE_KEY = 'kalawana_3d_calibration_config';

export interface BuildingData {
  corners: [number, number][];
  cat: 'main' | 'road' | 'out';
  height?: number;
  roof?: 'hip' | 'flat';
}

// ── Digitized Footprints (39 Buildings extracted from map image) ──
export const BUILDINGS_DATA: BuildingData[] = [
  // roadside buildings
  { corners: [[207.8, 57.6], [199.2, 40.4], [213.2, 33.4], [221.8, 50.6]], cat: 'road', height: 3.35, roof: 'hip' },
  { corners: [[281.0, 97.0], [263.0, 97.0], [263.0, 83.0], [281.0, 83.0]], cat: 'road', height: 3.24, roof: 'hip' },
  { corners: [[278.0, 124.0], [272.8, 103.1], [310.9, 93.5], [316.1, 114.5]], cat: 'road', height: 4.25, roof: 'hip' },
  { corners: [[208.6, 146.2], [186.6, 102.2], [201.8, 94.6], [223.8, 138.6]], cat: 'road', height: 4.44, roof: 'hip' },
  { corners: [[263.4, 141.0], [257.9, 127.2], [272.9, 121.2], [278.4, 135.0]], cat: 'road', height: 3.21, roof: 'hip' },
  { corners: [[247.0, 144.0], [230.0, 144.0], [230.0, 128.0], [247.0, 128.0]], cat: 'road', height: 3.29, roof: 'hip' },
  { corners: [[540.7, 170.9], [525.8, 112.4], [545.3, 107.4], [560.3, 165.9]], cat: 'road', height: 4.6, roof: 'hip' },
  { corners: [[113.5, 165.5], [107.5, 123.5], [131.2, 120.1], [137.2, 162.1]], cat: 'road', height: 4.6, roof: 'hip' },
  { corners: [[84.8, 166.8], [71.2, 129.7], [90.2, 122.7], [103.8, 159.8]], cat: 'road', height: 4.4, roof: 'hip' },
  { corners: [[1.2, 180.4], [-3.0, 172.0], [12.2, 164.4], [16.4, 172.8]], cat: 'road', height: 3.0, roof: 'hip' },
  { corners: [[32.8, 192.6], [24.2, 175.4], [42.2, 166.4], [50.8, 183.6]], cat: 'road', height: 3.52, roof: 'hip' },
  { corners: [[9.1, 211.5], [-3.0, 188.5], [19.0, 176.9], [31.1, 200.0]], cat: 'road', height: 3.97, roof: 'hip' },
  // main school complex
  { corners: [[483.9, 247.0], [472.6, 216.9], [491.9, 209.7], [503.2, 239.8]], cat: 'main', height: 4.57, roof: 'hip' },
  { corners: [[461.4, 256.2], [447.7, 217.4], [462.1, 212.2], [475.9, 251.1]], cat: 'main', height: 4.49, roof: 'hip' },
  { corners: [[423.0, 251.1], [416.8, 234.6], [445.9, 223.7], [452.1, 240.2]], cat: 'main', height: 4.35, roof: 'hip' },
  // outbuildings
  { corners: [[525.8, 260.9], [522.2, 234.1], [540.3, 231.7], [543.9, 258.5]], cat: 'out', height: 3.6, roof: 'hip' },
  // main school complex
  { corners: [[376.6, 271.2], [369.6, 257.2], [398.4, 242.8], [405.4, 256.8]], cat: 'main', height: 4.27, roof: 'hip' },
  { corners: [[429.7, 274.1], [423.6, 255.8], [453.0, 246.0], [459.1, 264.3]], cat: 'main', height: 4.48, roof: 'hip' },
  // outbuildings
  { corners: [[195.5, 294.6], [193.5, 256.0], [222.5, 254.5], [224.5, 293.1]], cat: 'out', height: 4.5, roof: 'hip' },
  // main school complex
  { corners: [[471.0, 301.9], [458.6, 272.1], [468.6, 267.9], [481.1, 297.7]], cat: 'main', height: 3.94, roof: 'hip' },
  { corners: [[418.4, 328.7], [391.9, 266.9], [410.3, 259.0], [436.8, 320.8]], cat: 'main', height: 5.1, roof: 'hip' },
  { corners: [[362.1, 326.9], [355.0, 307.4], [396.1, 292.4], [403.2, 311.9]], cat: 'main', height: 5.09, roof: 'hip' },
  { corners: [[485.2, 335.4], [475.3, 314.2], [486.6, 308.9], [496.5, 330.1]], cat: 'main', height: 3.82, roof: 'hip' },
  { corners: [[278.3, 348.9], [271.6, 332.0], [331.6, 308.0], [338.3, 324.9]], cat: 'main', height: 5.1, roof: 'hip' },
  { corners: [[376.0, 350.1], [370.6, 329.4], [399.0, 321.9], [404.4, 342.6]], cat: 'main', height: 4.51, roof: 'hip' },
  { corners: [[463.5, 354.6], [453.6, 333.1], [470.8, 325.2], [480.8, 346.6]], cat: 'main', height: 4.13, roof: 'hip' },
  { corners: [[324.9, 362.0], [319.6, 345.0], [359.6, 332.6], [364.9, 349.5]], cat: 'main', height: 4.72, roof: 'hip' },
  { corners: [[428.3, 366.6], [423.3, 355.0], [451.5, 342.9], [456.5, 354.5]], cat: 'main', height: 4.02, roof: 'hip' },
  { corners: [[254.5, 363.5], [251.2, 353.6], [258.4, 351.2], [261.7, 361.1]], cat: 'main', height: 3.37, roof: 'hip' },
  { corners: [[297.5, 401.7], [288.7, 382.5], [338.9, 359.4], [347.7, 378.5]], cat: 'main', height: 5.1, roof: 'hip' },
  { corners: [[501.0, 418.0], [481.8, 360.4], [500.7, 354.1], [519.9, 411.7]], cat: 'main', height: 5.1, roof: 'hip' },
  { corners: [[283.1, 413.5], [263.0, 365.6], [276.8, 359.8], [297.0, 407.6]], cat: 'main', height: 4.85, roof: 'hip' },
  { corners: [[403.5, 409.4], [396.3, 393.4], [443.8, 372.0], [451.0, 388.0]], cat: 'main', height: 5.09, roof: 'hip' },
  { corners: [[474.9, 427.3], [453.3, 366.5], [469.7, 360.7], [491.2, 421.5]], cat: 'main', height: 5.1, roof: 'hip' },
  { corners: [[395.3, 433.7], [388.6, 418.2], [441.1, 395.7], [447.8, 411.2]], cat: 'main', height: 5.1, roof: 'hip' },
  { corners: [[303.6, 443.0], [294.1, 427.5], [350.1, 393.2], [359.6, 408.6]], cat: 'main', height: 5.1, roof: 'hip' },
  { corners: [[439.8, 437.7], [432.6, 422.1], [462.0, 408.6], [469.2, 424.3]], cat: 'main', height: 4.36, roof: 'hip' },
  // outbuildings
  { corners: [[349.2, 501.6], [336.2, 484.3], [362.8, 464.4], [375.8, 481.7]], cat: 'out', height: 4.1, roof: 'hip' },
  { corners: [[9.0, 544.0], [1.0, 544.0], [1.0, 524.0], [9.0, 524.0]], cat: 'out', height: 2.89, roof: 'hip' },
];

export function getDefaultBuildings(): BuildingConfig[] {
  return BUILDINGS_DATA.map((b, i) => {
    const catLabel = b.cat === 'main' ? 'Main Complex' : b.cat === 'road' ? 'Roadside' : 'Outbuilding';
    return {
      id: `b-${i + 1}`,
      name: `Building #${i + 1} (${catLabel})`,
      corners: b.corners,
      cat: b.cat,
      height: b.height ?? 3.4,
      roof: b.roof ?? 'hip',
      scaleMultiplier: 1.0,
      latOffsetMeters: 0,
      lngOffsetMeters: 0,
      altitudeMeters: 0,
      isDeleted: false,
    };
  });
}

export function getSavedCalibration(): CalibrationConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CALIBRATION,
        ...parsed,
        buildings: parsed.buildings || getDefaultBuildings(),
      };
    }
  } catch (e) {
    console.warn('Failed to load saved 3D calibration:', e);
  }
  return {
    ...DEFAULT_CALIBRATION,
    buildings: getDefaultBuildings(),
  };
}

export function saveCalibration(config: CalibrationConfig) {
  const cleanConfig: CalibrationConfig = {
    ...config,
    showSelectionHighlight: false,
    selectedBuildingId: null,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanConfig));
  } catch (e) {
    console.warn('Failed to save 3D calibration locally:', e);
  }
  // Async background sync to Supabase database so all browsers get the updated 3D buildings
  saveCalibrationToSupabase(cleanConfig);
}

export async function saveCalibrationToSupabase(config: CalibrationConfig): Promise<boolean> {
  const cleanConfig: CalibrationConfig = {
    ...config,
    showSelectionHighlight: false,
    selectedBuildingId: null,
  };
  let success = false;
  // 1. Try primary app_settings table
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        {
          key: STORAGE_KEY,
          value: cleanConfig as any,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
    if (!error) {
      success = true;
    } else {
      console.warn('Primary app_settings table notice:', error.message);
    }
  } catch (e) {
    console.warn('Error saving to app_settings:', e);
  }

  // 2. Dual fallback: sync to announcements table config record so it ALWAYS persists in Supabase
  try {
    const payload = JSON.stringify(cleanConfig);
    const { data: existing } = await supabase
      .from('announcements')
      .select('id')
      .eq('title', '3D_CALIBRATION_CONFIG')
      .maybeSingle();

    if (existing?.id) {
      const { error: updateErr } = await supabase
        .from('announcements')
        .update({
          message: payload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (!updateErr) success = true;
    } else {
      const { error: insertErr } = await supabase
        .from('announcements')
        .insert({
          title: '3D_CALIBRATION_CONFIG',
          message: payload,
          type: 'info',
          is_active: false,
        });
      if (!insertErr) success = true;
    }
  } catch (e) {
    console.warn('Error saving 3D calibration to announcements fallback:', e);
  }

  return success;
}

export async function fetchCalibrationFromSupabase(): Promise<CalibrationConfig | null> {
  // 1. Try primary app_settings table
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', STORAGE_KEY)
      .maybeSingle();

    if (!error && data?.value) {
      const config: CalibrationConfig = {
        ...DEFAULT_CALIBRATION,
        ...(data.value as CalibrationConfig),
        buildings: (data.value as CalibrationConfig).buildings || getDefaultBuildings(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch {}
      return config;
    }
  } catch (e) {
    console.warn('Notice reading app_settings:', e);
  }

  // 2. Fallback to announcements config record
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('message')
      .eq('title', '3D_CALIBRATION_CONFIG')
      .maybeSingle();

    if (!error && data?.message) {
      const parsed = JSON.parse(data.message);
      const config: CalibrationConfig = {
        ...DEFAULT_CALIBRATION,
        ...parsed,
        buildings: parsed.buildings || getDefaultBuildings(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch {}
      return config;
    }
  } catch (e) {
    console.warn('Notice reading 3D calibration from announcements fallback:', e);
  }

  return null;
}

export const TREE_SPOTS: [number, number][] = [
  [40, 235], [60, 290], [80, 340], [30, 390], [10, 290], [680, 250], [700, 290],
  [690, 390], [670, 440], [600, 460], [170, 500], [130, 460], [90, 480],
  [700, 150], [715, 195], [730, 240], [230, 460], [560, 300], [580, 350],
];

// ── Palette by Building Category ───────────────────────────────
export const PALETTE = {
  main: { wall: 0xc9b28a, roof: 0xb0503a, edge: 0x8a6a4b },
  road: { wall: 0xaeb9d6, roof: 0x5f6f95, edge: 0x76839f },
  out: { wall: 0x93a0bd, roof: 0x475269, edge: 0x60708e },
};

// ── Helper: Pixel space → Local ENU Meters ─────────────────────
export function toWorld(px: number, py: number) {
  return { x: (px - OX) * SCALE, z: (py - OY) * SCALE };
}

// ── Helper: THREE.Shape from Footprint ─────────────────────────
function shapeFromWorldPts(pts: { x: number; z: number }[]) {
  const shape = new THREE.Shape();
  pts.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  });
  shape.closePath();
  return shape;
}

// ── Helper: Extrude Footprint Polygon ──────────────────────────
function extrudeFootprint(pts: { x: number; z: number }[], height: number) {
  const shape = shapeFromWorldPts(pts);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export interface KalawanaCustomLayerInterface extends maplibregl.CustomLayerInterface {
  setCalibration(config: Partial<CalibrationConfig>, persist?: boolean): void;
  getCalibration(): CalibrationConfig;
  setSelectedBuildingHandler(handler: ((buildingId: string | null) => void) | null): void;
}

// ── Campus Store Positioning ──────────────────────────────────
// The anchor is the exact geographic centre of the 3D campus model.
// Off-campus stores (wrong DB coordinates) are placed in a small ring
// around the anchor so they always appear ON the campus in every map view.
const CAMPUS_RING_RADIUS_LAT = 0.00006;  // ~6.7 m north/south
const CAMPUS_RING_RADIUS_LNG = 0.00007;  // ~7.8 m east/west

export function isNearKalawanaCampus(lat?: number | null, lng?: number | null): boolean {
  return lat != null && lng != null && lat >= 6.530 && lat <= 6.540 && lng >= 80.395 && lng <= 80.407;
}

/**
 * Returns the best campus lat/lng for a store marker.
 * • If the store already has valid coordinates (whether on campus or custom outside campus like mora1, mora2, mora3) → use them directly.
 * • Otherwise (if coords are missing) → place in a small ring around the campus anchor so the
 *   marker always appears ON the 3D school model.
 */
export function getCampusStoreLocation(
  store: { name?: string; latitude?: number | null; longitude?: number | null },
  index: number,
  _calibration?: unknown
): { lat: number; lng: number } {
  if (
    typeof store.latitude === 'number' &&
    typeof store.longitude === 'number' &&
    !isNaN(store.latitude) &&
    !isNaN(store.longitude) &&
    (store.latitude !== 0 || store.longitude !== 0)
  ) {
    return { lat: store.latitude, lng: store.longitude };
  }
  // Spread stores without coordinates evenly around the campus centre
  const angle = (index / 5) * 2 * Math.PI; // 5 slots cover 360°
  return {
    lat: Number((KALAWANA_ANCHOR_LAT + CAMPUS_RING_RADIUS_LAT * Math.sin(angle)).toFixed(6)),
    lng: Number((KALAWANA_ANCHOR_LNG + CAMPUS_RING_RADIUS_LNG * Math.cos(angle)).toFixed(6)),
  };
}

// ── MapLibre CustomLayerInterface Factory ──────────────────────
export function createKalawanaSchool3DLayer(
  id = 'kalawana-school-3d',
  initialCalibration?: CalibrationConfig
): KalawanaCustomLayerInterface {
  let camera: THREE.PerspectiveCamera;
  let scene: THREE.Scene;
  let renderer: THREE.WebGLRenderer;
  let mapInstance: maplibregl.Map;
  let buildingsContainerGroup: THREE.Group;

  let currentCalibration: CalibrationConfig = {
    ...getSavedCalibration(),
    ...(initialCalibration || {}),
  };
  if (!currentCalibration.buildings || currentCalibration.buildings.length === 0) {
    currentCalibration.buildings = getDefaultBuildings();
  }

  let onBuildingSelectCallback: ((buildingId: string | null) => void) | null = null;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function buildBuildingMeshes() {
    if (!buildingsContainerGroup) return;

    // Clear previous building meshes
    while (buildingsContainerGroup.children.length > 0) {
      const child = buildingsContainerGroup.children[0];
      buildingsContainerGroup.remove(child);
    }

    const buildingsList = currentCalibration.buildings || [];
    const selectedId = currentCalibration.selectedBuildingId;

    buildingsList.forEach((b) => {
      if (b.isDeleted) return;

      const buildingGroup = new THREE.Group();
      buildingGroup.userData = { buildingId: b.id };

      const worldPts = b.corners.map(([px, py]) => toWorld(px, py));
      const cx = worldPts.reduce((s, p) => s + p.x, 0) / worldPts.length;
      const cz = worldPts.reduce((s, p) => s + p.z, 0) / worldPts.length;

      // Local footprint points relative to centroid (0,0)
      const localPts = worldPts.map((p) => ({ x: p.x - cx, z: p.z - cz }));

      const baseHeight = b.height ?? 3.4;
      const wallH = Math.max(0.5, baseHeight);

      const categoryPalette = PALETTE[b.cat] || PALETTE.out;
      const wallColorHex = b.wallColor ? parseInt(b.wallColor.replace('#', ''), 16) : categoryPalette.wall;
      const roofColorHex = b.roofColor ? parseInt(b.roofColor.replace('#', ''), 16) : categoryPalette.roof;

      const isSelected = Boolean(currentCalibration.showSelectionHighlight && b.id === selectedId);

      // Walls — extruded relative to local centroid (0,0)
      const wallGeo = extrudeFootprint(localPts, wallH);
      const wallMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00f0ff : wallColorHex,
        roughness: 0.7,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const wallMesh = new THREE.Mesh(wallGeo, wallMat);
      wallMesh.userData = { buildingId: b.id };
      buildingGroup.add(wallMesh);

      // Base Plinth
      const plinthGeo = extrudeFootprint(localPts, 0.25);
      const plinthMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x6366f1 : categoryPalette.edge,
        roughness: 0.9,
        side: THREE.DoubleSide,
      });
      const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
      plinthMesh.position.y = -0.01;
      buildingGroup.add(plinthMesh);

      // Centroid edge orientation for roof
      const v1 = { x: localPts[1].x - localPts[0].x, z: localPts[1].z - localPts[0].z };
      const v2 = { x: localPts[2].x - localPts[1].x, z: localPts[2].z - localPts[1].z };
      const wLen = Math.hypot(v1.x, v1.z);
      const dLen = Math.hypot(v2.x, v2.z);
      const theta = Math.atan2(-v1.z, v1.x);

      // Roof
      const roofType = b.roof ?? 'hip';
      if (roofType === 'hip') {
        const roofH = Math.min(wLen, dLen) * 0.35;
        const roofGeo = new THREE.ConeGeometry(1, roofH, 4, 1);
        roofGeo.rotateY(Math.PI / 4);
        const roofMat = new THREE.MeshStandardMaterial({
          color: isSelected ? 0xec4899 : roofColorHex,
          roughness: 0.6,
          side: THREE.DoubleSide,
        });
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.userData = { buildingId: b.id };
        const overhang = 1.1;
        roofMesh.scale.set((wLen * overhang) / Math.SQRT2, 1, (dLen * overhang) / Math.SQRT2);
        roofMesh.rotation.y = theta;
        roofMesh.position.set(0, wallH + roofH / 2 - 0.02, 0);
        buildingGroup.add(roofMesh);
      } else {
        const roofGeo = new THREE.BoxGeometry(wLen + 0.2, 0.25, dLen + 0.2);
        const roofMat = new THREE.MeshStandardMaterial({
          color: isSelected ? 0xec4899 : roofColorHex,
          roughness: 0.6,
          side: THREE.DoubleSide,
        });
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.userData = { buildingId: b.id };
        roofMesh.rotation.y = theta;
        roofMesh.position.set(0, wallH + 0.15, 0);
        buildingGroup.add(roofMesh);
      }

      // Selection Highlight Beacon & Glowing Wireframe Box
      if (isSelected) {
        // Glowing Wireframe Box
        const bbox = new THREE.Box3().setFromObject(buildingGroup);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const center = new THREE.Vector3();
        bbox.getCenter(center);

        const wireGeo = new THREE.BoxGeometry(size.x + 0.8, size.y + 0.8, size.z + 0.8);
        const wireMat = new THREE.MeshBasicMaterial({
          color: 0x00ffff,
          wireframe: true,
        });
        const wireMesh = new THREE.Mesh(wireGeo, wireMat);
        wireMesh.position.copy(center);
        buildingGroup.add(wireMesh);

        // Vertical Beacon Beam Light
        const beamGeo = new THREE.CylinderGeometry(0.4, 2.0, 35, 12, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({
          color: 0x00ffff,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
        });
        const beamMesh = new THREE.Mesh(beamGeo, beamMat);
        beamMesh.position.set(0, wallH + 17.5, 0);
        buildingGroup.add(beamMesh);
      }

      // Apply individual scaling & position shift around centroid
      const scaleVal = b.scaleMultiplier ?? 1.0;
      buildingGroup.scale.set(scaleVal, scaleVal, scaleVal);

      const latShift = b.latOffsetMeters || 0;
      const lngShift = b.lngOffsetMeters || 0;
      const altShift = b.altitudeMeters || 0;

      buildingGroup.position.set(cx + lngShift, altShift, cz - latShift);

      buildingsContainerGroup.add(buildingGroup);
    });
  }

  const layer: KalawanaCustomLayerInterface = {
    id,
    type: 'custom',
    renderingMode: '3d',

    setCalibration(config: Partial<CalibrationConfig>, persist: boolean = false) {
      currentCalibration = { ...currentCalibration, ...config };
      if (!currentCalibration.buildings || currentCalibration.buildings.length === 0) {
        currentCalibration.buildings = getDefaultBuildings();
      }
      buildBuildingMeshes();
      if (persist) {
        saveCalibration(currentCalibration);
      }
      mapInstance?.triggerRepaint();
    },

    getCalibration() {
      return { ...currentCalibration };
    },

    setSelectedBuildingHandler(handler: ((buildingId: string | null) => void) | null) {
      onBuildingSelectCallback = handler;
    },

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
      mapInstance = map;
      camera = new THREE.PerspectiveCamera(); // matrix overridden by MapLibre each frame
      scene = new THREE.Scene();

      // Lighting Setup matching prototype
      const hemi = new THREE.HemisphereLight(0x9db8e8, 0x1a2a1a, 1.2);
      scene.add(hemi);

      const sun = new THREE.DirectionalLight(0xfff3df, 1.5);
      sun.position.set(-60, 90, 40);
      scene.add(sun);

      const fill = new THREE.DirectionalLight(0x88a4ff, 0.4);
      fill.position.set(60, 40, -60);
      scene.add(fill);

      buildingsContainerGroup = new THREE.Group();
      scene.add(buildingsContainerGroup);

      buildBuildingMeshes();

      // Auto-sync calibration from Supabase for fresh browser sessions
      fetchCalibrationFromSupabase().then((remoteConfig) => {
        if (remoteConfig) {
          layer.setCalibration(remoteConfig, false);
        }
      });

      // Add Trees
      TREE_SPOTS.forEach(([px, py]) => {
        const s = 0.8 + Math.random() * 0.6;
        const { x, z } = toWorld(px, py);
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.2 * s, 6),
          new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 })
        );
        trunk.position.y = 0.6 * s;
        const foliage = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.1 * s, 0),
          new THREE.MeshStandardMaterial({ color: 0x2f5334, roughness: 1 })
        );
        foliage.position.y = 1.7 * s;
        g.add(trunk, foliage);
        g.position.set(x, 0, z);
        scene.add(g);
      });

      // Initialize WebGLRenderer sharing MapLibre context
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;

      // Click listener for raycast selecting buildings on map
      const canvas = map.getCanvas();
      canvas.addEventListener('click', (event: MouseEvent) => {
        if (!onBuildingSelectCallback || !buildingsContainerGroup) return;

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(buildingsContainerGroup.children, true);

        if (intersects.length > 0) {
          let obj: THREE.Object3D | null = intersects[0].object;
          while (obj && !obj.userData?.buildingId) {
            obj = obj.parent;
          }
          if (obj?.userData?.buildingId) {
            onBuildingSelectCallback(obj.userData.buildingId);
          }
        }
      });
    },

    render(_gl: WebGLRenderingContext | CanvasRenderingContext2D, options: maplibregl.CustomRenderMethodInput | any) {
      const matrixObj =
        options?.defaultProjectionData?.mainMatrix ||
        options?.modelViewProjectionMatrix ||
        options?.matrix ||
        (options && ArrayBuffer.isView(options) ? options : null);

      if (!matrixObj) return;

      const matrixArr = Array.from(matrixObj as number[]);
      if (matrixArr.length < 16) return;

      // Convert lat/lng offsets in meters to degree deltas
      const dLat = (currentCalibration.latOffsetMeters || 0) / 111320;
      const dLng = (currentCalibration.lngOffsetMeters || 0) / (111320 * Math.cos((KALAWANA_ANCHOR_LAT * Math.PI) / 180));

      const anchorLat = KALAWANA_ANCHOR_LAT + dLat;
      const anchorLng = KALAWANA_ANCHOR_LNG + dLng;

      const anchorMerc = maplibregl.MercatorCoordinate.fromLngLat(
        [anchorLng, anchorLat],
        currentCalibration.altitudeMeters || 0
      );

      const baseScale = anchorMerc.meterInMercatorCoordinateUnits();
      const effectiveScale = baseScale * (currentCalibration.scaleMultiplier || 1.0);

      // Official Mapbox / MapLibre GL Three.js custom layer matrix transformation with scale & rotation calibration
      const rotationX = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 0, 0),
        Math.PI / 2
      );

      const rotationZ = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(0, 0, 1),
        ((currentCalibration.rotationAngle || 0) * Math.PI) / 180
      );

      const l = new THREE.Matrix4()
        .makeTranslation(anchorMerc.x, anchorMerc.y, anchorMerc.z)
        .scale(new THREE.Vector3(effectiveScale, -effectiveScale, effectiveScale))
        .multiply(rotationX)
        .multiply(rotationZ);

      const m = new THREE.Matrix4().fromArray(matrixArr);
      camera.projectionMatrix = m.multiply(l);

      renderer.resetState();
      renderer.render(scene, camera);
    },
  };

  return layer;
}

