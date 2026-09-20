import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  Layers,
  MapPin,
  Route,
  RefreshCw,
  Satellite,
  Compass,
  Sliders,
} from 'lucide-react';
import { AdminModal } from './AdminModal';
import { supabase, type NavigationNode } from '../../lib/supabase';
import {
  parseKML,
  convertKmlToGraph,
  type ParsedKmlData,
  type GeneratedGraph,
} from '../../utils/kmlParser';

interface KmlImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingNodes: NavigationNode[];
  onSuccess: () => void;
}

const TILE_SOURCES = {
  satellite: {
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
    maxNativeZoom: 20,
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 20,
    maxNativeZoom: 19,
  },
};

export function KmlImportModal({
  isOpen,
  onClose,
  existingNodes,
  onSuccess,
}: KmlImportModalProps) {
  const [fileName, setFileName] = useState<string>('');
  const [parsedData, setParsedData] = useState<ParsedKmlData | null>(null);

  // Settings
  const [floor, setFloor] = useState<string>('1');
  const [snapTolerance, setSnapTolerance] = useState<number>(1.5);
  const [isBidirectional, setIsBidirectional] = useState<boolean>(true);
  const [snapToExisting, setSnapToExisting] = useState<boolean>(true);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [tileMode, setTileMode] = useState<'satellite' | 'street'>('satellite');

  const [isSaving, setIsSaving] = useState(false);
  const [statusError, setStatusError] = useState<string>('');
  const [statusSuccess, setStatusSuccess] = useState<string>('');

  // Map preview refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const previewLayersGroupRef = useRef<L.FeatureGroup | null>(null);

  // Reset state when opening/closing
  useEffect(() => {
    if (!isOpen) {
      setFileName('');
      setParsedData(null);
      setStatusError('');
      setStatusSuccess('');
      setIsSaving(false);
    }
  }, [isOpen]);

  // Compute graph on the fly whenever parsedData or conversion settings change
  const generatedGraph: GeneratedGraph | null = useMemo(() => {
    if (!parsedData) return null;
    try {
      return convertKmlToGraph(parsedData, {
        snapToleranceMeters: snapTolerance,
        floor,
        isBidirectional,
        nodePrefix: 'KML',
        snapToExisting,
        existingNodes,
      });
    } catch (e: any) {
      console.error('Error generating graph from KML:', e);
      return null;
    }
  }, [parsedData, snapTolerance, floor, isBidirectional, snapToExisting, existingNodes]);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusError('');
    setStatusSuccess('');
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = parseKML(text);
        if (parsed.paths.length === 0 && parsed.points.length === 0) {
          setStatusError('No valid LineString paths or Point placemarks found in this KML file.');
          setParsedData(null);
          return;
        }
        setParsedData(parsed);
      } catch (err: any) {
        setStatusError(err.message || 'Failed to parse KML file.');
        setParsedData(null);
      }
    };
    reader.onerror = () => {
      setStatusError('Error reading file from disk.');
    };
    reader.readAsText(file);
  };

  // Initialize and update preview Leaflet map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    if (!mapRef.current) {
      // Default to campus center or existing node
      const centerLat = existingNodes[0]?.latitude || 6.535472;
      const centerLng = existingNodes[0]?.longitude || 80.401000;

      const map = L.map(mapContainerRef.current, {
        center: [centerLat, centerLng],
        zoom: 18,
        zoomControl: true,
        attributionControl: false,
      });

      const tileConfig = TILE_SOURCES[tileMode];
      const tileLayer = L.tileLayer(tileConfig.url, {
        subdomains: tileConfig.subdomains,
        maxZoom: tileConfig.maxZoom,
        maxNativeZoom: tileConfig.maxNativeZoom,
      }).addTo(map);

      tileLayerRef.current = tileLayer;
      previewLayersGroupRef.current = L.featureGroup().addTo(map);
      mapRef.current = map;
    }

    // Update tile layer if mode changed
    if (tileLayerRef.current && mapRef.current) {
      tileLayerRef.current.setUrl(TILE_SOURCES[tileMode].url);
    }

    // Invalidate map size to ensure rendering
    setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 100);

    return () => {
      if (!isOpen && mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
        previewLayersGroupRef.current = null;
      }
    };
  }, [isOpen, tileMode, existingNodes]);

  // Update map features when generatedGraph changes
  useEffect(() => {
    if (!mapRef.current || !previewLayersGroupRef.current) return;

    const layerGroup = previewLayersGroupRef.current;
    layerGroup.clearLayers();

    if (!generatedGraph) return;

    // Create a lookup map of all nodes (both new and existing)
    const allNodeMap = new Map<string, { lat: number; lng: number; label: string; type: string }>();
    existingNodes.forEach((n) => allNodeMap.set(n.id, { lat: n.latitude, lng: n.longitude, label: n.label, type: n.type }));
    generatedGraph.nodes.forEach((n) => allNodeMap.set(n.id, { lat: n.latitude, lng: n.longitude, label: n.label, type: n.type }));

    // 1. Draw Edges as Polylines
    generatedGraph.edges.forEach((edge) => {
      const from = allNodeMap.get(edge.from_node_id);
      const to = allNodeMap.get(edge.to_node_id);
      if (from && to) {
        const poly = L.polyline(
          [
            [from.lat, from.lng],
            [to.lat, to.lng],
          ],
          {
            color: '#38bdf8',
            weight: 4,
            opacity: 0.85,
            dashArray: edge.is_bidirectional ? undefined : '5, 5',
          }
        );
        poly.bindTooltip(`${edge.distance}m (${from.label} ↔ ${to.label})`, { sticky: true });
        poly.addTo(layerGroup);
      }
    });

    // 2. Draw Nodes as CircleMarkers
    generatedGraph.nodes.forEach((node) => {
      const isEntrance = node.type === 'entrance';
      const isEmergency = node.type === 'emergency';
      const isPoi = node.type === 'poi' || node.type === 'store';

      const circle = L.circleMarker([node.latitude, node.longitude], {
        radius: isEntrance || isEmergency || isPoi ? 6 : 4,
        fillColor: isEntrance ? '#22d3ee' : isEmergency ? '#ef4444' : isPoi ? '#a855f7' : '#f59e0b',
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.9,
      });

      circle.bindTooltip(`<b>${node.label}</b><br/>${node.latitude.toFixed(6)}, ${node.longitude.toFixed(6)}`, {
        direction: 'top',
      });
      circle.addTo(layerGroup);
    });

    // Auto-fit bounds if we have geometries
    try {
      const bounds = layerGroup.getBounds();
      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 19 });
      }
    } catch (e) {
      console.error('Error fitting bounds:', e);
    }
  }, [generatedGraph, existingNodes]);

  // Execute database batch import
  const handleConfirmImport = async () => {
    if (!generatedGraph || (generatedGraph.nodes.length === 0 && generatedGraph.edges.length === 0)) {
      setStatusError('No graph data to import.');
      return;
    }

    try {
      setIsSaving(true);
      setStatusError('');

      // 1. If Replace mode is chosen, clear existing edges and path nodes
      if (importMode === 'replace') {
        const confirmReplace = window.confirm(
          'Are you sure you want to REPLACE the existing navigation graph? This will delete existing edges and non-store path nodes.'
        );
        if (!confirmReplace) {
          setIsSaving(false);
          return;
        }

        // Delete edges first (foreign key constraints)
        const { error: delEdgesErr } = await supabase
          .from('navigation_edges')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
        if (delEdgesErr) throw delEdgesErr;

        // Delete path-type nodes (keep store-linked nodes)
        const { error: delNodesErr } = await supabase
          .from('navigation_nodes')
          .delete()
          .eq('type', 'path');
        if (delNodesErr) throw delNodesErr;
      }

      // 2. Batch insert nodes (chunk size 50)
      const nodesToInsert = generatedGraph.nodes;
      const CHUNK_SIZE = 50;

      for (let i = 0; i < nodesToInsert.length; i += CHUNK_SIZE) {
        const chunk = nodesToInsert.slice(i, i + CHUNK_SIZE);
        const { error: nodesErr } = await supabase.from('navigation_nodes').insert(chunk);
        if (nodesErr) throw nodesErr;
      }

      // 3. Batch insert edges (chunk size 50)
      const edgesToInsert = generatedGraph.edges;
      for (let i = 0; i < edgesToInsert.length; i += CHUNK_SIZE) {
        const chunk = edgesToInsert.slice(i, i + CHUNK_SIZE);
        const { error: edgesErr } = await supabase.from('navigation_edges').insert(chunk);
        if (edgesErr) throw edgesErr;
      }

      setStatusSuccess(
        `Successfully imported ${nodesToInsert.length} nodes and ${edgesToInsert.length} edges!`
      );

      // Trigger reload and close after brief moment
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 900);
    } catch (err: any) {
      console.error('Failed to import KML graph to database:', err);
      setStatusError(err.message || 'Failed to save graph to database.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AdminModal
      title="Import Google Earth KML / Paths"
      onClose={onClose}
      maxWidth={860}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
            {parsedData && generatedGraph && (
              <span>
                Ready to import: <b>{generatedGraph.stats.nodesCreated}</b> nodes &bull;{' '}
                <b>{generatedGraph.stats.edgesCreated}</b> edges
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirmImport}
              disabled={isSaving || !generatedGraph || (generatedGraph.nodes.length === 0 && generatedGraph.edges.length === 0)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {isSaving ? <RefreshCw size={15} className="spinner" /> : <CheckCircle2 size={16} />}
              <span>{isSaving ? 'Importing...' : 'Confirm & Import to Graph'}</span>
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Status messages */}
        {statusError && (
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{statusError}</span>
          </div>
        )}

        {statusSuccess && (
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: '8px',
              background: 'rgba(34, 197, 94, 0.12)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#22c55e',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span>{statusSuccess}</span>
          </div>
        )}

        {/* Upload Box */}
        <div
          style={{
            border: '2px dashed var(--color-border)',
            borderRadius: '10px',
            padding: '1.25rem',
            textAlign: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          <input
            type="file"
            accept=".kml,.xml"
            onChange={handleFileUpload}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0,
              cursor: 'pointer',
              width: '100%',
              height: '100%',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
            <Upload size={28} style={{ color: 'var(--color-primary-h)' }} />
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              {fileName ? fileName : 'Choose or drop a Google Earth .kml file'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>
              Supports LineStrings (walking paths) and Point placemarks exported from Google Earth or Google My Maps
            </div>
          </div>
        </div>

        {/* Configuration Bar & Stats */}
        {parsedData && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '0.6rem',
              padding: '0.75rem',
              borderRadius: '8px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div>
              <label style={{ fontSize: '0.72rem', color: 'var(--color-muted)', display: 'block', marginBottom: '0.2rem' }}>
                TARGET FLOOR
              </label>
              <select
                className="form-input"
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.82rem', height: '2rem' }}
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
              >
                <option value="1">Floor 1 (Ground)</option>
                <option value="2">Floor 2</option>
                <option value="3">Floor 3</option>
                <option value="G">Ground</option>
                <option value="B">Basement</option>
              </select>
            </div>

            <div>
              <label
                style={{ fontSize: '0.72rem', color: 'var(--color-muted)', display: 'block', marginBottom: '0.2rem' }}
                title="Vertices closer than this will merge into a single node"
              >
                SNAP JUNCTIONS ({snapTolerance}m)
              </label>
              <input
                type="range"
                min="0.5"
                max="5.0"
                step="0.5"
                value={snapTolerance}
                onChange={(e) => setSnapTolerance(parseFloat(e.target.value))}
                style={{ width: '100%', height: '2rem' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.72rem', color: 'var(--color-muted)', display: 'block', marginBottom: '0.2rem' }}>
                IMPORT MODE
              </label>
              <select
                className="form-input"
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.82rem', height: '2rem' }}
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as any)}
              >
                <option value="append">Append to existing graph</option>
                <option value="replace">Clear & Replace graph</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isBidirectional}
                  onChange={(e) => setIsBidirectional(e.target.checked)}
                />
                <span>Two-way (Bidirectional)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={snapToExisting}
                  onChange={(e) => setSnapToExisting(e.target.checked)}
                />
                <span>Snap to existing DB nodes</span>
              </label>
            </div>
          </div>
        )}

        {/* Stats Chips */}
        {generatedGraph && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                background: 'rgba(99, 102, 241, 0.12)',
                color: '#818cf8',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <Route size={13} /> {generatedGraph.stats.pathsCount} Paths
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                background: 'rgba(34, 197, 94, 0.12)',
                color: '#4ade80',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <MapPin size={13} /> {generatedGraph.stats.nodesCreated} New Nodes
            </span>
            {generatedGraph.stats.nodesReused > 0 && (
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  background: 'rgba(234, 179, 8, 0.12)',
                  color: '#facc15',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <Sliders size={13} /> {generatedGraph.stats.nodesReused} Snapped / Merged
              </span>
            )}
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                background: 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <Layers size={13} /> {generatedGraph.stats.edgesCreated} Edges
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                background: 'rgba(168, 85, 247, 0.12)',
                color: '#c084fc',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <Compass size={13} /> {generatedGraph.stats.totalDistanceMeters}m Total
            </span>
          </div>
        )}

        {/* Leaflet Preview Map */}
        <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
          <div
            ref={mapContainerRef}
            style={{
              height: '320px',
              width: '100%',
              background: '#0f172a',
            }}
          />

          {/* Map Layer Switcher Floating Button */}
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 1000,
              display: 'flex',
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setTileMode('satellite')}
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.72rem',
                border: 'none',
                cursor: 'pointer',
                background: tileMode === 'satellite' ? 'var(--color-primary)' : 'transparent',
                color: tileMode === 'satellite' ? '#ffffff' : 'var(--color-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <Satellite size={13} /> Satellite
            </button>
            <button
              type="button"
              onClick={() => setTileMode('street')}
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.72rem',
                border: 'none',
                cursor: 'pointer',
                background: tileMode === 'street' ? 'var(--color-primary)' : 'transparent',
                color: tileMode === 'street' ? '#ffffff' : 'var(--color-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <Layers size={13} /> Street
            </button>
          </div>

          {!parsedData && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(15, 23, 42, 0.75)',
                color: 'var(--color-muted)',
                fontSize: '0.85rem',
                pointerEvents: 'none',
              }}
            >
              Upload a .kml file above to preview paths on the map
            </div>
          )}
        </div>
      </div>
    </AdminModal>
  );
}
