import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { ArrowLeft, Layers, RotateCcw, ZoomIn, ZoomOut, GraduationCap, Navigation, MapPin, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase, type Store } from '../lib/supabase';
import {
  createKalawanaSchool3DLayer,
  getSavedCalibration,
  saveCalibration,
  saveCalibrationToSupabase,
  fetchCalibrationFromSupabase,
  getCampusStoreLocation,
  DEFAULT_CALIBRATION,
  type KalawanaCustomLayerInterface,
  type CalibrationConfig,
} from '../components/KalawanaSchool3DLayer';
import { Kalawana3DCalibrationModal } from '../components/Kalawana3DCalibrationModal';

// Register the MapLibre GL worker URL
maplibregl.setWorkerUrl(workerUrl as unknown as string);

// ── GCP2+5C6, Kalawana — Coordinates [lng, lat] ─────────────────
// Kalawana National School (Central College), Sabaragamuwa Province, Sri Lanka
const KALAWANA_SCHOOL_CENTER: [number, number] = [80.4010, 6.5355];
const SCHOOL_ZOOM = 18.2;
const SCHOOL_PITCH = 58;
const SCHOOL_BEARING = -15;

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export function Map3DPage() {
  const { profile } = useAuth();
  const isMainAdmin = profile?.role === 'admin';

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const customLayerRef = useRef<KalawanaCustomLayerInterface | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [is3D, setIs3D] = useState(true);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);

  // Calibration state
  const [savedCalibration, setSavedCalibration] = useState<CalibrationConfig>(getSavedCalibration());
  const [calibration, setCalibration] = useState<CalibrationConfig>(getSavedCalibration());
  const calibrationRef = useRef<CalibrationConfig>(getSavedCalibration());
  const initialSavedRef = useRef<CalibrationConfig>(getSavedCalibration());
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [schoolBoundaryEnabled, setSchoolBoundaryEnabled] = useState(true);

  // Sync calibration and school boundary settings from Supabase database
  useEffect(() => {
    fetchCalibrationFromSupabase().then((remoteConfig) => {
      if (remoteConfig) {
        setSavedCalibration(remoteConfig);
        setCalibration(remoteConfig);
        calibrationRef.current = remoteConfig;
        initialSavedRef.current = remoteConfig;
        customLayerRef.current?.setCalibration(remoteConfig, false);
      }
    });

    supabase
      .from('announcements')
      .select('message')
      .eq('type', 'settings')
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          try {
            const parsed = JSON.parse(data[0].message);
            if (parsed.school_boundary_enabled !== undefined) {
              setSchoolBoundaryEnabled(parsed.school_boundary_enabled !== false);
            }
          } catch (e) {
            console.error('Error parsing settings:', e);
          }
        }
      });
  }, []);

  // Sync boundary layer visibility
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;
    const visibility = schoolBoundaryEnabled ? 'visible' : 'none';
    if (m.getLayer('school-boundary-fill')) {
      m.setLayoutProperty('school-boundary-fill', 'visibility', visibility);
    }
    if (m.getLayer('school-boundary-line')) {
      m.setLayoutProperty('school-boundary-line', 'visibility', visibility);
    }
  }, [mapLoaded, schoolBoundaryEnabled]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleOpenCalibration = () => {
    if (!isMainAdmin) return;
    const currentSaved = getSavedCalibration();
    initialSavedRef.current = currentSaved;
    setSavedCalibration(currentSaved);
    const activeConfig = { ...currentSaved, showSelectionHighlight: true };
    setCalibration(activeConfig);
    calibrationRef.current = activeConfig;
    customLayerRef.current?.setCalibration(activeConfig, false);
    setShowCalibrationModal(true);
  };

  const handleCalibrationChange = (newConfig: CalibrationConfig) => {
    const updated = { ...newConfig, showSelectionHighlight: true };
    setCalibration(updated);
    calibrationRef.current = updated;
    // Live update in memory preview (cache) without saving to storage yet
    customLayerRef.current?.setCalibration(updated, false);
  };

  const handleSaveAsDefault = async () => {
    const cleanConfig = { ...calibration, showSelectionHighlight: false, selectedBuildingId: null };
    saveCalibration(cleanConfig);
    setSavedCalibration(cleanConfig);
    setCalibration(cleanConfig);
    calibrationRef.current = cleanConfig;
    customLayerRef.current?.setCalibration(cleanConfig, true);
    setShowCalibrationModal(false);
    showToast('💾 Saving 3D Calibration to database...');

    const dbSaved = await saveCalibrationToSupabase(cleanConfig);
    if (dbSaved) {
      showToast('✅ Saved globally to database! All browsers updated.');
    } else {
      showToast('⚠️ Saved locally to browser cache.');
    }
  };

  const handleResetDefaults = () => {
    const resetConfig = { ...DEFAULT_CALIBRATION, showSelectionHighlight: true };
    setCalibration(resetConfig);
    calibrationRef.current = resetConfig;
    customLayerRef.current?.setCalibration(resetConfig, false);
  };

  const handleCancelCalibration = () => {
    const revertTo = initialSavedRef.current || savedCalibration;
    const cleanRevert = { ...revertTo, showSelectionHighlight: false, selectedBuildingId: null };
    setCalibration(cleanRevert);
    calibrationRef.current = cleanRevert;
    customLayerRef.current?.setCalibration(cleanRevert, false);
    setShowCalibrationModal(false);
  };

  // ── Load stores from Supabase ────────────────────────────────
  useEffect(() => {
    supabase
      .from('stores')
      .select('*, categories:category_id(id, name, color)')
      .eq('is_active', true)
      .then(({ data }) => {
        if (!data) return;

        // Map stores to campus building centroids (fallback for off-campus coords)
        const processedStores: Store[] = data.map((store, index) => {
          const loc = getCampusStoreLocation(store, index);
          return { ...store, latitude: loc.lat, longitude: loc.lng };
        });

        setStores(processedStores);
      });
  }, []);

  // ── Initialise MapLibre map ──────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: KALAWANA_SCHOOL_CENTER,
      zoom: SCHOOL_ZOOM,
      pitch: SCHOOL_PITCH,
      bearing: SCHOOL_BEARING,
      dragPan: true,
      dragRotate: true,
      scrollZoom: true,
      touchZoomRotate: true,
      doubleClickZoom: true,
      keyboard: true,
    });

    map.current = m;

    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    const resizeObserver = new ResizeObserver(() => {
      m.resize();
    });
    resizeObserver.observe(mapContainer.current);

    m.on('error', (e) => {
      console.error('[MapLibre error]', e);
    });

    m.on('load', () => {
      setMapLoaded(true);

      // ── Dark theme overrides ───────────────────────────────
      if (m.getLayer('background')) {
        m.setPaintProperty('background', 'background-color', '#0d1117');
      }
      if (m.getLayer('water')) {
        m.setPaintProperty('water', 'fill-color', '#0a1628');
      }
      ['highway_minor', 'highway_major_inner', 'highway_major_casing', 'highway_motorway_inner', 'highway_motorway_casing'].forEach((id) => {
        if (m.getLayer(id)) m.setPaintProperty(id, 'line-color', '#1e2a3a');
      });

      if (m.getLayer('building')) {
        m.setPaintProperty('building', 'fill-color', '#1a2035');
        m.setPaintProperty('building', 'fill-outline-color', '#0f3460');
      }

      // ── Three.js Kalawana National School 3D Layer ──────────
      if (!m.getLayer('kalawana-school-3d')) {
        const layer = createKalawanaSchool3DLayer('kalawana-school-3d', calibrationRef.current);
        customLayerRef.current = layer;

        layer.setSelectedBuildingHandler((buildingId) => {
          if (buildingId) {
            setCalibration((prev) => {
              const updated = { ...prev, selectedBuildingId: buildingId };
              calibrationRef.current = updated;
              layer.setCalibration(updated, false);
              return updated;
            });
            setShowCalibrationModal(true);
          }
        });

        m.addLayer(layer);
      }



    });

    return () => {
      resizeObserver.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // ── Add store markers ─────────────────────────────────────────
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current = [];

    stores.forEach((store) => {
      if (store.latitude == null || store.longitude == null) return;

      const catColor = store.categories?.color || '#6366f1';
      const isSelected = selectedStore?.id === store.id;

      // ── Compact pin-dot marker (doesn't stretch during 3D rotation) ──
      const container = document.createElement('div');
      container.style.cssText = [
        'cursor: pointer;',
        'display: flex;',
        'flex-direction: column;',
        'align-items: center;',
        'width: fit-content;',
        'pointer-events: auto;',
      ].join('');

      // Floating label above the dot
      const label = document.createElement('div');
      label.style.cssText = [
        `background: ${isSelected ? 'linear-gradient(135deg,#6366f1,#a855f7)' : 'rgba(8,8,22,0.92)'};`,
        `border: 1.5px solid ${catColor};`,
        'border-radius: 8px;',
        'padding: 3px 8px;',
        'margin-bottom: 4px;',
        'white-space: nowrap;',
        'display: flex;',
        'align-items: center;',
        'gap: 5px;',
        `box-shadow: 0 2px 10px rgba(0,0,0,0.7), 0 0 6px ${catColor}66;`,
        'pointer-events: none;',
        'transition: transform 0.15s ease;',
      ].join('');

      const initial = document.createElement('span');
      initial.style.cssText = [
        `background: ${catColor};`,
        'border-radius: 4px;',
        'width: 16px; height: 16px;',
        'display: inline-flex; align-items: center; justify-content: center;',
        'font-size: 9px; font-weight: 900; color: #fff;',
        'flex-shrink: 0;',
      ].join('');
      initial.textContent = (store.name?.[0] ?? '?').toUpperCase();

      const name = document.createElement('span');
      name.style.cssText = 'font-size: 11px; font-weight: 700; color: #fff; font-family: system-ui, sans-serif;';
      name.textContent = store.name;

      label.appendChild(initial);
      label.appendChild(name);

      // Dot anchor (the point that sits ON the building)
      const dot = document.createElement('div');
      dot.style.cssText = [
        `width: ${isSelected ? 14 : 10}px;`,
        `height: ${isSelected ? 14 : 10}px;`,
        'border-radius: 50%;',
        `background: ${catColor};`,
        'border: 2px solid #fff;',
        `box-shadow: 0 0 0 ${isSelected ? 4 : 2}px ${catColor}55, 0 2px 6px rgba(0,0,0,0.8);`,
        'transition: all 0.15s ease;',
      ].join('');

      container.appendChild(label);
      container.appendChild(dot);

      container.addEventListener('mouseenter', () => {
        label.style.transform = 'scale(1.08) translateY(-2px)';
        dot.style.transform = 'scale(1.3)';
      });
      container.addEventListener('mouseleave', () => {
        label.style.transform = '';
        dot.style.transform = '';
      });
      container.addEventListener('click', () => {
        setSelectedStore(store);
        flyToStore(store);
      });

      // anchor:'bottom' means the bottom of the container element (the dot) is
      // pinned to the exact [lng, lat] — stays correct during pitch/rotation
      const marker = new maplibregl.Marker({ element: container, anchor: 'bottom' })
        .setLngLat([store.longitude, store.latitude])
        .addTo(map.current!);

      markersRef.current.push(marker);
    });
  }, [mapLoaded, stores, selectedStore]);

  // ── Controls ─────────────────────────────────────────────────
  const resetView = () => {
    map.current?.flyTo({
      center: KALAWANA_SCHOOL_CENTER,
      zoom: SCHOOL_ZOOM,
      pitch: SCHOOL_PITCH,
      bearing: SCHOOL_BEARING,
      duration: 1200,
    });
  };

  const toggle3D = () => {
    map.current?.easeTo({ pitch: is3D ? 0 : SCHOOL_PITCH, duration: 800 });
    setIs3D(!is3D);
  };

  const flyToStore = (store: Store) => {
    if (!store.latitude || !store.longitude) return;
    map.current?.flyTo({
      center: [store.longitude, store.latitude],
      zoom: 19,
      pitch: 65,
      bearing: SCHOOL_BEARING,
      duration: 1400,
    });
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden', background: '#0a0a1a' }}>

      {/* Map container */}
      <div
        ref={mapContainer}
        style={{
          width: '100%',
          height: '100%',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      />

      {/* ── Top bar ─────────────────────────────────── */}
      <div className="map3d-topbar" style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '0.5rem',
        padding: '0.6rem 0.75rem',
        paddingTop: 'calc(0.6rem + var(--safe-top))',
        pointerEvents: 'none',
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', pointerEvents: 'auto', minWidth: 0, flex: 1 }}>
          <Link
            to="/map"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0,
              padding: '0.45rem 0.75rem', borderRadius: 10,
              background: 'rgba(10,10,26,0.88)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.12)', color: '#fff',
              textDecoration: 'none', fontSize: '0.82rem', fontWeight: 600,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              whiteSpace: 'nowrap',
            }}
          >
            <ArrowLeft size={15} /> <span className="map3d-back-label">Back to Map</span>
          </Link>

          <div className="map3d-title-pill" style={{
            padding: '0.45rem 0.9rem', borderRadius: 10, minWidth: 0,
            background: 'rgba(10,10,26,0.88)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(99,102,241,0.35)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            overflow: 'hidden',
          }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <GraduationCap size={15} color="#a855f7" style={{ flexShrink: 0 }} />
              <span className="map3d-title-text">Kalawana School (3D)</span>
            </div>
            <div className="map3d-subtitle" style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: 1, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <MapPin size={9} color="#22d3ee" /> GCP2+5C6, Kalawana
            </div>
          </div>
        </div>

        {isMainAdmin && (
          <div style={{ display: 'flex', gap: '0.4rem', pointerEvents: 'auto', flexShrink: 0 }}>
            <button
              onClick={() => {
                if (showCalibrationModal) handleCancelCalibration();
                else handleOpenCalibration();
              }}
              title="Calibrate 3D Model Scale, Position & Rotation (Main Admin Only)"
              style={{
                padding: '0.45rem 0.75rem', borderRadius: 10,
                background: showCalibrationModal
                  ? 'linear-gradient(135deg, #6366f1, #a855f7)'
                  : 'rgba(10,10,26,0.88)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(99,102,241,0.4)', color: '#fff',
                fontSize: '0.75rem', fontWeight: 600,
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              <Settings size={13} color="#a855f7" />
              <span className="map3d-calibrate-label">Calibrate</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Toast notification popup ─────────────────── */}
      {toastMessage && (
        <div style={{
          position: 'absolute', top: 'calc(var(--safe-top) + 68px)', left: '50%', transform: 'translateX(-50%)',
          zIndex: 1100, background: 'rgba(16, 185, 129, 0.95)', color: '#fff',
          padding: '0.55rem 1.1rem', borderRadius: 10, backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)', fontWeight: 600, fontSize: '0.82rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 2rem)',
        }}>
          {toastMessage}
        </div>
      )}

      {/* ── Calibration Control Floating Panel (Main Admin Only) ─────── */}
      {isMainAdmin && (
        <Kalawana3DCalibrationModal
          isOpen={showCalibrationModal}
          onClose={handleCancelCalibration}
          config={calibration}
          onChange={handleCalibrationChange}
          onSaveAsDefault={handleSaveAsDefault}
          onResetDefaults={handleResetDefaults}
          onCancel={handleCancelCalibration}
        />
      )}

      {/* ── Left / bottom-right control buttons ──────── */}
      <div className="map3d-controls" style={{
        position: 'absolute', top: '50%', left: 12,
        transform: 'translateY(-50%)',
        display: 'flex', flexDirection: 'column', gap: '0.4rem',
        zIndex: 50,
      }}>
        {[
          { icon: <ZoomIn size={15} />, title: 'Zoom In', onClick: () => map.current?.zoomIn() },
          { icon: <ZoomOut size={15} />, title: 'Zoom Out', onClick: () => map.current?.zoomOut() },
          { icon: <RotateCcw size={15} />, title: 'Reset View', onClick: resetView },
          { icon: <Layers size={15} />, title: is3D ? 'Switch to 2D' : 'Switch to 3D', onClick: toggle3D, active: is3D },
        ].map((btn, i) => (
          <button
            key={i}
            title={btn.title}
            onClick={btn.onClick}
            style={{
              width: 36, height: 36, borderRadius: 9,
              background: btn.active
                ? 'linear-gradient(135deg, #6366f1, #a855f7)'
                : 'rgba(10,10,26,0.88)',
              backdropFilter: 'blur(12px)',
              border: btn.active
                ? '1px solid rgba(99,102,241,0.5)'
                : '1px solid rgba(255,255,255,0.1)',
              color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
              transition: 'all 0.2s',
            }}
          >
            {btn.icon}
          </button>
        ))}
      </div>

      {/* ── Bottom exhibitor pill bar ─────────────────── */}
      {stores.length > 0 && (
        <div className="map3d-bottom-bar" style={{
          position: 'absolute',
          bottom: 'calc(var(--safe-bottom) + 12px)',
          left: 52, right: 12,
          background: 'rgba(10,10,26,0.88)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
          padding: '0.6rem 0.75rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 50,
        }}>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', width: 'max-content' }}>
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.38)', fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>
                EXHIBITORS
              </span>
              {stores.map((store) => (
                <button
                  key={store.id}
                  onClick={() => { setSelectedStore(store); flyToStore(store); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.35rem 0.7rem', borderRadius: 20,
                    background: selectedStore?.id === store.id
                      ? 'linear-gradient(135deg, #6366f1, #a855f7)'
                      : 'rgba(255,255,255,0.07)',
                    border: selectedStore?.id === store.id
                      ? '1px solid rgba(99,102,241,0.5)'
                      : '1px solid rgba(255,255,255,0.1)',
                    color: '#fff', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600,
                    whiteSpace: 'nowrap', transition: 'all 0.2s', flexShrink: 0,
                  }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.6rem', fontWeight: 800, flexShrink: 0,
                  }}>
                    {store.name?.[0]?.toUpperCase()}
                  </span>
                  {store.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Selected store info card ──────────────────── */}
      {selectedStore && (
        <div className="map3d-store-card" style={{
          position: 'absolute',
          bottom: 'calc(var(--safe-bottom) + 92px)',
          right: 12,
          width: 'min(260px, calc(100vw - 24px))',
          background: 'rgba(10,10,26,0.94)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(99,102,241,0.35)', borderRadius: 14,
          padding: '0.9rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          animation: 'fadeInUp 0.25s ease',
          zIndex: 60,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <div style={{
              width: 38, height: 38, borderRadius: 9,
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1rem', fontWeight: 800, color: '#fff', flexShrink: 0,
            }}>
              {selectedStore.name?.[0]?.toUpperCase()}
            </div>
            <button
              onClick={() => setSelectedStore(null)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0.2rem' }}
            >×</button>
          </div>

          <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fff', marginBottom: 3 }}>
            {selectedStore.name}
          </div>

          {selectedStore.description && (
            <div style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.65rem', lineHeight: 1.5 }}>
              {selectedStore.description.slice(0, 90)}{selectedStore.description.length > 90 ? '…' : ''}
            </div>
          )}

          {selectedStore.floor && (
            <div style={{ fontSize: '0.73rem', color: 'rgba(255,255,255,0.38)', marginBottom: '0.65rem' }}>
              📍 Floor {selectedStore.floor}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              onClick={() => flyToStore(selectedStore)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                padding: '0.4rem', borderRadius: 8,
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                border: 'none', color: '#fff', fontWeight: 600, fontSize: '0.76rem', cursor: 'pointer',
              }}
            >
              <Navigation size={12} /> Fly To
            </button>
            <Link
              to={`/stores/${selectedStore.id}`}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0.4rem', borderRadius: 8,
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', fontWeight: 600, fontSize: '0.76rem', textDecoration: 'none',
              }}
            >
              Details
            </Link>
          </div>
        </div>
      )}

      {/* ── Loading overlay ───────────────────────────── */}
      {!mapLoaded && (
        <div style={{
          position: 'absolute', inset: 0,
          background: '#0a0a1a', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '1rem',
          zIndex: 200,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem',
          }}>🏫</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: '1rem' }}>
            Loading 3D School…
          </div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem' }}>
            GCP2+5C6, Kalawana · Sri Lanka
          </div>
          <div className="spinner" style={{ width: 28, height: 28, borderTopColor: '#6366f1', marginTop: 8 }} />
        </div>
      )}

      <style>{`
        @keyframes fadeInRight {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .maplibregl-ctrl-group {
          background: rgba(10,10,26,0.85) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          backdrop-filter: blur(12px) !important;
          border-radius: 10px !important;
        }
        .maplibregl-ctrl-group button {
          background: none !important;
          border-bottom-color: rgba(255,255,255,0.1) !important;
        }
        .maplibregl-ctrl-group button span { filter: invert(1) !important; }
        .maplibregl-ctrl-compass { filter: invert(1) !important; }
        .maplibregl-ctrl-attrib {
          background: rgba(10,10,26,0.7) !important;
          color: rgba(255,255,255,0.4) !important;
          font-size: 10px !important;
          border-radius: 6px !important;
        }
        .maplibregl-ctrl-attrib a { color: rgba(255,255,255,0.5) !important; }
        /* Hide bottom-right MapLibre controls on mobile to prevent overlap */
        @media (max-width: 480px) {
          .maplibregl-ctrl-bottom-right { display: none !important; }
          .map3d-back-label { display: none; }
          .map3d-calibrate-label { display: none; }
          .map3d-title-text::after { content: '3D'; }
          .map3d-title-text { font-size: 0.78rem; }
          .map3d-subtitle { display: none; }
          .map3d-controls {
            top: auto !important;
            bottom: calc(var(--safe-bottom, 0px) + 90px) !important;
            left: auto !important;
            right: 10px !important;
            transform: none !important;
          }
          .map3d-bottom-bar {
            left: 0 !important;
            right: 0 !important;
            border-radius: 0 !important;
            border-left: none !important;
            border-right: none !important;
            bottom: calc(var(--safe-bottom, 0px) + 0px) !important;
          }
          .map3d-store-card {
            bottom: calc(var(--safe-bottom, 0px) + 68px) !important;
            right: 8px !important;
            left: 8px !important;
            width: auto !important;
          }
        }
        @media (max-width: 380px) {
          .map3d-title-pill { display: none; }
        }
      `}</style>
    </div>
  );
}
