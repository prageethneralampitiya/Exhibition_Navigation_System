import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Edit2, Trash2, Search, Check, Navigation2, Network, Link2, RefreshCw, ShieldCheck, ShieldAlert, MapPin, Upload, Download, QrCode, Crosshair, Radio } from 'lucide-react';
import { supabase, type NavigationNode, type NavigationEdge, type Store, type NodeType } from '../../lib/supabase';
import { AdminTable } from '../../components/admin/AdminTable';
import { AdminModal } from '../../components/admin/AdminModal';
import { getDistance, computeCrowdCalibratedCoordinates } from '../../utils/dijkstra';
import { FormMapPicker } from '../../components/admin/FormMapPicker';
import { DrawPathMapPicker, type DrawPoint } from '../../components/admin/DrawPathMapPicker';
import { KmlImportModal } from '../../components/admin/KmlImportModal';
import { exportGraphToKML, downloadKmlFile } from '../../utils/kmlParser';
import { QrCodeModal } from '../../components/admin/QrCodeModal';
import { type QrCalibrateTarget } from '../../utils/qrCodeGenerator';

export function AdminNodesPage() {
  const [nodes, setNodes] = useState<NavigationNode[]>([]);
  const [edges, setEdges] = useState<NavigationEdge[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'nodes' | 'edges'>('nodes');
  const [schoolBoundaryEnabled, setSchoolBoundaryEnabled] = useState(true);
  const [togglingBoundary, setTogglingBoundary] = useState(false);

  // Modals state
  const [isNodeModalOpen, setIsNodeModalOpen] = useState(false);
  const [isDeleteNodeModalOpen, setIsDeleteNodeModalOpen] = useState(false);
  const [currentNode, setCurrentNode] = useState<Partial<NavigationNode> | null>(null);

  const [isEdgeModalOpen, setIsEdgeModalOpen] = useState(false);
  const [isDeleteEdgeModalOpen, setIsDeleteEdgeModalOpen] = useState(false);
  const [currentEdge, setCurrentEdge] = useState<any | null>(null);
  // Tracks whether the current edge distance was auto-computed (vs manually typed)
  const [isDistanceAutoCalc, setIsDistanceAutoCalc] = useState(false);

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Inline node rename
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [renameLabel, setRenameLabel] = useState('');

  // Draw Path states
  const [isDrawPathModalOpen, setIsDrawPathModalOpen] = useState(false);
  const [drawPathPoints, setDrawPathPoints] = useState<DrawPoint[]>([]);
  const [drawPathBidirectional, setDrawPathBidirectional] = useState(true);
  const [drawPathFloor, setDrawPathFloor] = useState('1');
  const [drawPathTool, setDrawPathTool] = useState<'draw' | 'erase'>('draw');

  // KML Import state
  const [isKmlImportModalOpen, setIsKmlImportModalOpen] = useState(false);

  // QR Code State
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<QrCalibrateTarget | null>(null);

  const handleOpenQrCode = (node: NavigationNode) => {
    setQrTarget({
      id: node.id,
      name: node.label,
      type: node.type,
      latitude: Number(node.latitude),
      longitude: Number(node.longitude),
      floor: node.floor || '1',
    });
    setIsQrModalOpen(true);
  };

  // Live GPS field calibration for a single node
  const handleCalibrateNodeWithGps = (node: NavigationNode) => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    const confirmed = confirm(
      `📡 Real-Time GPS Node Calibrator:\n\nAre you physically standing at "${node.label}" right now?\n\nClick OK to read your device's GPS and snap this node to your exact physical coordinates.`
    );
    if (!confirmed) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const newLat = Math.round(pos.coords.latitude * 1_000_000) / 1_000_000;
        const newLng = Math.round(pos.coords.longitude * 1_000_000) / 1_000_000;
        const accuracy = Math.round(pos.coords.accuracy);

        try {
          const { error } = await supabase
            .from('navigation_nodes')
            .update({ latitude: newLat, longitude: newLng })
            .eq('id', node.id);

          if (error) throw error;
          alert(`✓ Node "${node.label}" successfully calibrated!\n\nNew Coordinates: ${newLat}, ${newLng}\nGPS Accuracy: ±${accuracy}m`);
          loadAllData();
        } catch (err: any) {
          alert('Failed to calibrate node: ' + (err?.message || 'Unknown error'));
        }
      },
      (err) => {
        alert('Could not acquire GPS: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Crowd traffic self-calibration
  const [autoCalibrating, setAutoCalibrating] = useState(false);

  const handleCrowdAutoCalibrate = async () => {
    try {
      setAutoCalibrating(true);
      // Query deviation telemetry recorded from users
      const { data: telemetryEvents } = await supabase
        .from('analytics_events')
        .select('*')
        .eq('event_type', 'path_deviation')
        .order('created_at', { ascending: false })
        .limit(200);

      const samples = telemetryEvents || [];

      if (samples.length === 0) {
        alert(
          `ℹ️ Auto-Calibrate Paths:\n\nNo crowd deviation traces recorded yet.\n\nAs visitors navigate using the mobile app, their natural path turns and corner shortcuts are automatically measured against static lines. Once enough traffic is logged, this tool automatically adjusts node coordinates to match human walking lines!`
        );
        return;
      }

      // Group samples by target node_id
      const nodeSamplesMap = new Map<string, Array<{ lat: number; lng: number }>>();
      samples.forEach((s: any) => {
        const nodeId = s.target_id;
        const meta = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
        if (nodeId && meta?.lat && meta?.lng) {
          const list = nodeSamplesMap.get(nodeId) || [];
          list.push({ lat: Number(meta.lat), lng: Number(meta.lng) });
          nodeSamplesMap.set(nodeId, list);
        }
      });

      let adjustedCount = 0;
      for (const [nodeId, sList] of nodeSamplesMap.entries()) {
        const targetNode = nodes.find((n) => n.id === nodeId);
        if (targetNode && sList.length >= 2) {
          const cal = computeCrowdCalibratedCoordinates(
            targetNode.latitude,
            targetNode.longitude,
            sList,
            0.5
          );
          if (cal.shiftMeters > 0.5) {
            await supabase
              .from('navigation_nodes')
              .update({ latitude: cal.lat, longitude: cal.lng })
              .eq('id', nodeId);
            adjustedCount++;
          }
        }
      }

      if (adjustedCount > 0) {
        alert(`✓ Successfully auto-calibrated ${adjustedCount} path nodes based on crowd movement patterns!`);
        loadAllData();
      } else {
        alert(`ℹ️ Path nodes are already well-aligned with crowd walking lines (deviation < 0.5m).`);
      }
    } catch (err: any) {
      alert('Auto-calibration error: ' + (err?.message || 'Unknown error'));
    } finally {
      setAutoCalibrating(false);
    }
  };

  const handleExportKML = () => {
    try {
      const kml = exportGraphToKML(nodes, edges, 'ExNav Campus Navigation Graph');
      downloadKmlFile(kml, `campus-paths-${new Date().toISOString().slice(0, 10)}.kml`);
    } catch (err: any) {
      console.error('Failed to export KML:', err);
      alert('Failed to export KML file: ' + (err?.message || 'Unknown error'));
    }
  };

  /**
   * Compute the straight-line distance between two nodes using the equirectangular
   * formula (same one used by navigation) and round to 2 decimal places.
   */
  const autoCalcDistance = useCallback(
    (fromId: string, toId: string): number | null => {
      const from = nodes.find((n) => n.id === fromId);
      const to = nodes.find((n) => n.id === toId);
      if (!from || !to) return null;
      const dist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
      return Math.round(dist * 100) / 100; // round to cm precision
    },
    [nodes]
  );

  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    try {
      setLoading(true);
      const [nodesRes, edgesRes, storesRes, settingsRes] = await Promise.all([
        supabase.from('navigation_nodes').select('*').order('label'),
        supabase.from('navigation_edges').select(`
          *,
          from_node:from_node_id (id, label),
          to_node:to_node_id (id, label)
        `),
        supabase.from('stores').select('*').order('name'),
        supabase.from('announcements').select('*').eq('type', 'settings').limit(1),
      ]);

      const sortedNodes = (nodesRes.data || []).sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
      );
      setNodes(sortedNodes);
      setEdges(edgesRes.data || []);
      setStores(storesRes.data || []);

      if (settingsRes.data && settingsRes.data.length > 0) {
        try {
          const parsed = JSON.parse(settingsRes.data[0].message);
          setSchoolBoundaryEnabled(parsed.school_boundary_enabled !== false);
        } catch (e) {
          console.error('Error parsing settings:', e);
        }
      }
    } catch (err) {
      console.error('Error loading navigation nodes page data:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleToggleSchoolBoundary = async () => {
    try {
      setTogglingBoundary(true);
      const nextState = !schoolBoundaryEnabled;
      
      // Fetch latest settings record
      const { data: settingsRes } = await supabase
        .from('announcements')
        .select('*')
        .eq('type', 'settings')
        .limit(1);

      let parsed: any = {};
      let settingsId: string | null = null;
      if (settingsRes && settingsRes.length > 0) {
        settingsId = settingsRes[0].id;
        try {
          parsed = JSON.parse(settingsRes[0].message);
        } catch (e) {
          console.error(e);
        }
      }

      parsed.school_boundary_enabled = nextState;
      parsed.show_school_boundary = nextState;

      const announcementPayload = {
        title: 'System Exhibition Settings',
        message: JSON.stringify(parsed),
        type: 'settings',
        is_active: true,
      };

      if (settingsId) {
        const { error } = await supabase
          .from('announcements')
          .update({ ...announcementPayload, updated_at: new Date().toISOString() })
          .eq('id', settingsId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('announcements')
          .insert(announcementPayload);
        if (error) throw error;
      }

      setSchoolBoundaryEnabled(nextState);
    } catch (err) {
      console.error('Error toggling school boundary:', err);
      alert('Failed to update school boundary status.');
    } finally {
      setTogglingBoundary(false);
    }
  };

  async function cleanOrphanedPathNodes() {
    try {
      // Find all nodes of type 'path'
      const { data: pathNodes, error: nodesErr } = await supabase
        .from('navigation_nodes')
        .select('id')
        .eq('type', 'path');

      if (nodesErr || !pathNodes || pathNodes.length === 0) return;

      // Find all active edges
      const { data: activeEdges, error: edgesErr } = await supabase
        .from('navigation_edges')
        .select('from_node_id, to_node_id');

      if (edgesErr || !activeEdges) return;

      // Collect all node IDs referenced by edges
      const referencedNodeIds = new Set<string>();
      activeEdges.forEach(edge => {
        referencedNodeIds.add(edge.from_node_id);
        referencedNodeIds.add(edge.to_node_id);
      });

      // Identify orphaned path nodes (those not referenced by any edge)
      const orphanedNodeIds = pathNodes
        .map(node => node.id)
        .filter(id => !referencedNodeIds.has(id));

      if (orphanedNodeIds.length > 0) {
        // Delete these orphaned path nodes
        await supabase
          .from('navigation_nodes')
          .delete()
          .in('id', orphanedNodeIds);
      }
    } catch (err) {
      console.error('Error cleaning up orphaned path nodes:', err);
    }
  }

  // --- NODE CRUD FUNCTIONS ---
  const handleOpenAddNode = () => {
    setCurrentNode({
      label: '',
      latitude: 6.535472,
      longitude: 80.401000,
      floor: '1',
      type: 'path',
      store_id: '',
      // Add custom field to track initial edge link
      connect_to_node_id: '',
    } as any);
    setFormError('');
    setIsNodeModalOpen(true);
  };

  const handleOpenEditNode = (node: NavigationNode) => {
    setCurrentNode(node);
    setFormError('');
    setIsNodeModalOpen(true);
  };

  const handleOpenDeleteNode = (node: NavigationNode) => {
    setCurrentNode(node);
    setIsDeleteNodeModalOpen(true);
  };

  const handleNodeFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentNode) return;
    if (!currentNode.label || currentNode.latitude === undefined || currentNode.longitude === undefined) {
      setFormError('Label and Coordinates are required');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      const payload = {
        label: currentNode.label,
        latitude: Number(currentNode.latitude),
        longitude: Number(currentNode.longitude),
        floor: currentNode.floor || null,
        type: (currentNode.type as NodeType) || 'path',
        store_id: currentNode.store_id || null,
      };

      if (currentNode.id) {
        const { error } = await supabase
          .from('navigation_nodes')
          .update(payload)
          .eq('id', currentNode.id);
        if (error) throw error;
      } else {
        // Insert new node and select its generated details to calculate distance
        const { data: insertedNode, error: insertError } = await supabase
          .from('navigation_nodes')
          .insert(payload)
          .select('id, latitude, longitude')
          .single();
        
        if (insertError) throw insertError;

        // If the user requested to connect this node directly to an existing one
        const linkNodeId = (currentNode as any).connect_to_node_id;
        if (insertedNode && linkNodeId) {
          const targetLinkNode = nodes.find((n) => n.id === linkNodeId);
          if (targetLinkNode) {
            const calculatedDist = getDistance(
              insertedNode.latitude,
              insertedNode.longitude,
              targetLinkNode.latitude,
              targetLinkNode.longitude
            );
            const roundedDist = Math.round(calculatedDist * 100) / 100;

            // Automatically create bidirectional edge link
            const { error: edgeError } = await supabase
              .from('navigation_edges')
              .insert({
                from_node_id: insertedNode.id,
                to_node_id: targetLinkNode.id,
                distance: roundedDist,
                is_bidirectional: true,
              });

            if (edgeError) {
              console.warn('Node was successfully created but automatic edge link failed:', edgeError.message);
            }
          }
        }
      }

      setIsNodeModalOpen(false);
      loadAllData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNodeDeleteConfirm = async () => {
    if (!currentNode?.id) return;

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('navigation_nodes')
        .delete()
        .eq('id', currentNode.id);
      if (error) throw error;

      // Clean up any path waypoints orphaned by this node deletion
      await cleanOrphanedPathNodes();

      setIsDeleteNodeModalOpen(false);
      loadAllData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  };

  // --- DRAW PATH FUNCTIONS ---
  const handleOpenDrawPath = () => {
    setDrawPathPoints([]);
    setDrawPathBidirectional(true);
    setDrawPathFloor('1');
    setDrawPathTool('draw');
    setFormError('');
    setIsDrawPathModalOpen(true);
  };

  const handleDrawPathSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (drawPathPoints.length < 2) {
      setFormError('Click at least 2 points on the map to define a path');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      // Resolve every DrawPoint → NavigationNode
      // Existing-node points reuse the saved node; new points are inserted.
      const resolvedChain: NavigationNode[] = [];
      let counter = nodes.length + 1; // continuous numbering from where we left off

      for (const pt of drawPathPoints) {
        if (pt.existingNodeId) {
          const existing = nodes.find((n) => n.id === pt.existingNodeId);
          if (!existing) throw new Error(`Referenced node not found: ${pt.existingNodeId}`);
          resolvedChain.push(existing);
        } else {
          const label = pt.label?.trim() || `Node ${counter}`;
          counter++;
          const { data: newNode, error: nodeErr } = await supabase
            .from('navigation_nodes')
            .insert({
              label,
              latitude: pt.lat,
              longitude: pt.lng,
              floor: drawPathFloor || null,
              type: 'path' as NodeType,
              store_id: null,
            })
            .select('*')
            .single();
          if (nodeErr) throw nodeErr;
          if (!newNode) throw new Error('Failed to create node');
          resolvedChain.push(newNode as NavigationNode);
        }
      }

      // Build edges; skip pairs that already have a saved connection
      const edgesToInsert: Array<{
        from_node_id: string;
        to_node_id: string;
        distance: number;
        is_bidirectional: boolean;
      }> = [];

      for (let i = 0; i < resolvedChain.length - 1; i++) {
        const from = resolvedChain[i];
        const to = resolvedChain[i + 1];
        const alreadyExists = edges.some(
          (e) =>
            (e.from_node_id === from.id && e.to_node_id === to.id) ||
            (e.is_bidirectional && e.from_node_id === to.id && e.to_node_id === from.id)
        );
        if (!alreadyExists) {
          const dist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
          edgesToInsert.push({
            from_node_id: from.id,
            to_node_id: to.id,
            distance: Math.round(dist * 100) / 100,
            is_bidirectional: drawPathBidirectional,
          });
        }
      }

      if (edgesToInsert.length > 0) {
        const { error: edgesErr } = await supabase
          .from('navigation_edges')
          .insert(edgesToInsert);
        if (edgesErr) throw edgesErr;
      }

      setIsDrawPathModalOpen(false);
      loadAllData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save path');
    } finally {
      setSubmitting(false);
    }
  };

  /** Erase a single edge (and clean up any orphaned path nodes). */
  const handleEraseEdge = async (edgeId: string) => {
    try {
      const { error } = await supabase
        .from('navigation_edges')
        .delete()
        .eq('id', edgeId);
      if (error) throw error;
      await cleanOrphanedPathNodes();
      loadAllData();
    } catch (err) {
      console.error('Failed to erase edge:', err);
    }
  };

  // --- EDGE CRUD FUNCTIONS ---
  const handleOpenAddEdge = () => {
    const fromId = nodes[0]?.id || '';
    const toId = nodes[1]?.id || '';
    const autoDist = nodes.length >= 2 ? autoCalcDistance(fromId, toId) : null;
    setCurrentEdge({
      from_node_id: fromId,
      to_node_id: toId,
      distance: autoDist ?? 5.0,
      is_bidirectional: true,
    });
    setIsDistanceAutoCalc(autoDist !== null);
    setFormError('');
    setIsEdgeModalOpen(true);
  };

  const handleOpenDeleteEdge = (edge: NavigationEdge) => {
    setCurrentEdge(edge);
    setIsDeleteEdgeModalOpen(true);
  };

  const handleEdgeFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEdge) return;
    if (!currentEdge.from_node_id || !currentEdge.to_node_id) {
      setFormError('Both From and To nodes are required');
      return;
    }
    if (currentEdge.from_node_id === currentEdge.to_node_id) {
      setFormError('Cannot connect a node to itself');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      const payload = {
        from_node_id: currentEdge.from_node_id,
        to_node_id: currentEdge.to_node_id,
        distance: Number(currentEdge.distance) || 1.0,
        is_bidirectional: !!currentEdge.is_bidirectional,
      };

      const { error } = await supabase
        .from('navigation_edges')
        .insert(payload);
      if (error) throw error;

      setIsEdgeModalOpen(false);
      loadAllData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Operation failed. Edge connection might already exist.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdgeDeleteConfirm = async () => {
    if (!currentEdge) return;

    try {
      setSubmitting(true);
      const idsToDelete = currentEdge.edge_ids || [currentEdge.id];
      
      const { error } = await supabase
        .from('navigation_edges')
        .delete()
        .in('id', idsToDelete);
      if (error) throw error;

      // Clean up any path waypoints orphaned by this edge deletion
      await cleanOrphanedPathNodes();

      setIsDeleteEdgeModalOpen(false);
      loadAllData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  };

  /** Inline rename: persist the new label to Supabase immediately. */
  const handleRenameNode = async (nodeId: string, newLabel: string) => {
    const trimmed = newLabel.trim();
    if (!trimmed) { setRenamingNodeId(null); return; }
    const original = nodes.find((n) => n.id === nodeId);
    if (original?.label === trimmed) { setRenamingNodeId(null); return; }
    try {
      const { error } = await supabase
        .from('navigation_nodes')
        .update({ label: trimmed })
        .eq('id', nodeId);
      if (error) throw error;
      loadAllData();
    } catch (err) {
      console.error('Rename failed:', err);
    } finally {
      setRenamingNodeId(null);
    }
  };

  const filteredNodes = nodes
    .filter((n) =>
      n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.type.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
    );

  const nodeColumns = [
    {
      key: 'label',
      label: 'Label / Name',
      render: (row: NavigationNode) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <Navigation2 size={14} className={`node-type-${row.type}`} style={{ flexShrink: 0 }} />
          {renamingNodeId === row.id ? (
            <input
              autoFocus
              className="form-input"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.875rem', height: '1.9rem', flex: 1, minWidth: 0 }}
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
              onBlur={() => handleRenameNode(row.id, renameLabel)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameNode(row.id, renameLabel);
                if (e.key === 'Escape') setRenamingNodeId(null);
              }}
            />
          ) : (
            <span
              style={{ fontWeight: 600, cursor: 'text', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={`${row.label} — click pencil to rename`}
            >
              {row.label}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      width: '110px',
      render: (row: NavigationNode) => (
        <span style={{
          fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize',
          padding: '0.15rem 0.5rem', borderRadius: 4,
          background: row.type === 'path'
            ? 'rgba(148,163,184,0.12)'
            : row.type === 'entrance'
            ? 'rgba(34,211,238,0.12)'
            : row.type === 'store'
            ? 'rgba(168,85,247,0.12)'
            : row.type === 'emergency'
            ? 'rgba(239,68,68,0.12)'
            : 'rgba(99,102,241,0.12)',
          color: row.type === 'path'
            ? '#94a3b8'
            : row.type === 'entrance'
            ? '#22d3ee'
            : row.type === 'store'
            ? '#a855f7'
            : row.type === 'emergency'
            ? '#ef4444'
            : '#818cf8',
        }}>{row.type}</span>
      ),
    },
    {
      key: 'coords',
      label: 'Coordinates',
      render: (row: NavigationNode) => (
        <span style={{ color: 'var(--color-muted)', fontSize: '0.78rem', fontFamily: 'monospace' }}>
          {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
        </span>
      ),
    },
    {
      key: 'floor',
      label: 'Floor',
      width: '60px',
      render: (row: NavigationNode) => <span style={{ fontSize: '0.85rem' }}>{row.floor || '1'}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '180px',
      render: (row: NavigationNode) => (
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {/* Quick GPS Real-time Calibration for this Node */}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => handleCalibrateNodeWithGps(row)}
            title="Snap this node to your current live physical GPS location"
            style={{ color: '#06b6d4' }}
          >
            <Crosshair size={13} />
          </button>
          {/* QR Code Calibration Placard */}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => handleOpenQrCode(row)}
            title="Download / Print indoor location calibration QR code placard"
            style={{ color: '#38bdf8' }}
          >
            <QrCode size={13} />
          </button>
          {/* Inline rename toggle */}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            title="Rename node"
            onClick={() => {
              if (renamingNodeId === row.id) {
                handleRenameNode(row.id, renameLabel);
              } else {
                setRenameLabel(row.label);
                setRenamingNodeId(row.id);
              }
            }}
            style={renamingNodeId === row.id ? { color: 'var(--color-accent)', border: '1px solid var(--color-accent)' } : {}}
          >
            <Edit2 size={13} />
          </button>
          {/* Full edit modal */}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => handleOpenEditNode(row)}
            title="Edit full node"
          >
            <Navigation2 size={13} />
          </button>
          <button
            className="btn btn-danger btn-sm btn-icon"
            onClick={() => handleOpenDeleteNode(row)}
            title="Delete node"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  const edgeColumns = [
    {
      key: 'connection',
      label: 'Connection',
      render: (row: any) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Network size={14} color="var(--color-primary-h)" />
          <span style={{ fontWeight: 600 }}>{row.from_node?.label || 'Unknown'}</span>
          <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem' }}>
            {row.is_bidirectional ? '◀ ─ ▶' : '─ ─ ▶'}
          </span>
          <span style={{ fontWeight: 600 }}>{row.to_node?.label || 'Unknown'}</span>
        </div>
      ),
    },
    {
      key: 'distance',
      label: 'Distance (Weight)',
      render: (row: any) => <span>{row.distance} m</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '80px',
      render: (row: any) => (
        <button
          className="btn btn-danger btn-sm btn-icon"
          onClick={() => handleOpenDeleteEdge(row)}
          title="Remove edge connection"
        >
          <Trash2 size={14} />
        </button>
      ),
    },
  ];

  const groupedEdges = getGroupedEdges(nodes, edges);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>Navigation Nodes</h1>
          <p>Map out indoor pathways, exits, and waypoints</p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* School Boundary Quick Toggle */}
          <button
            className="btn btn-ghost"
            onClick={handleToggleSchoolBoundary}
            disabled={togglingBoundary}
            title={
              schoolBoundaryEnabled
                ? 'School boundary is Shown on map. Click to hide.'
                : 'School boundary is Hidden from map. Click to show.'
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              padding: '0.45rem 0.8rem',
              borderRadius: '8px',
              border: `1px solid ${schoolBoundaryEnabled ? 'rgba(34, 197, 94, 0.4)' : 'rgba(234, 179, 8, 0.4)'}`,
              background: schoolBoundaryEnabled ? 'rgba(34, 197, 94, 0.08)' : 'rgba(234, 179, 8, 0.08)',
              color: schoolBoundaryEnabled ? '#4ade80' : '#facc15',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {schoolBoundaryEnabled ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
            <span>Boundary: {schoolBoundaryEnabled ? 'Shown on Map' : 'Hidden from Map'}</span>
          </button>

          <Link
            to="/facilities"
            className="btn btn-ghost"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              color: 'var(--color-primary-h)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              background: 'rgba(99, 102, 241, 0.08)',
            }}
          >
            <MapPin size={15} />
            <span>Facilities & POIs</span>
          </Link>

          <button
            className="btn btn-ghost"
            onClick={() => setIsKmlImportModalOpen(true)}
            title="Import paths & pins drawn in Google Earth (.kml)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              background: 'rgba(56, 189, 248, 0.08)',
              color: '#38bdf8',
            }}
          >
            <Upload size={16} />
            <span>Import KML</span>
          </button>

          <button
            className="btn btn-ghost"
            onClick={handleExportKML}
            disabled={nodes.length === 0}
            title="Export current navigation graph to Google Earth (.kml)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <Download size={16} />
            <span>Export KML</span>
          </button>

          <button
            className="btn btn-ghost"
            onClick={handleCrowdAutoCalibrate}
            disabled={nodes.length === 0 || autoCalibrating}
            title="Analyze visitor movement telemetry and adjust corner nodes"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              background: 'rgba(16, 185, 129, 0.08)',
              color: '#34d399',
            }}
          >
            <Radio size={15} className={autoCalibrating ? 'live-dot-pulse' : ''} />
            <span>{autoCalibrating ? 'Calibrating...' : 'Auto-Calibrate Paths'}</span>
          </button>

          <button className="btn btn-ghost" onClick={handleOpenDrawPath} style={{ border: '1px dashed var(--color-accent)', color: 'var(--color-accent)' }}>
            <Network size={16} />
            Draw / Field Calibrate
          </button>
          <button className="btn btn-ghost" onClick={handleOpenAddEdge} disabled={nodes.length < 2}>
            <Link2 size={16} />
            Connect Nodes
          </button>
          <button className="btn btn-primary" onClick={handleOpenAddNode}>
            <Plus size={16} />
            Add Node
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
        <button
          className={`btn btn-sm ${activeTab === 'nodes' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('nodes')}
        >
          Nodes List
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'edges' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('edges')}
        >
          Edges (Path Connections)
        </button>
      </div>

      {activeTab === 'nodes' ? (
        <section className="data-table-wrap">
          <div className="data-table-toolbar">
            <div className="search-wrap">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search nodes by label or type..."
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <AdminTable
            columns={nodeColumns}
            rows={filteredNodes}
            loading={loading}
            emptyMessage="No nodes mapped yet."
          />
        </section>
      ) : (
        <section className="data-table-wrap">
          <AdminTable
            columns={edgeColumns}
            rows={groupedEdges}
            loading={loading}
            emptyMessage="No path connections established between nodes."
          />
        </section>
      )}

      {/* NODE MODAL */}
      {isNodeModalOpen && currentNode && (
        <AdminModal
          title={currentNode.id ? 'Edit Node' : 'Add Node'}
          onClose={() => setIsNodeModalOpen(false)}
        >
          <form onSubmit={handleNodeFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {formError && (
              <div className="alert alert-error">
                <span>{formError}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="node-label">Label *</label>
              <input
                id="node-label"
                type="text"
                className="form-input"
                required
                value={currentNode.label || ''}
                onChange={(e) => setCurrentNode({ ...currentNode, label: e.target.value })}
                placeholder="e.g. Entrance Gate 1, Corner Hall A"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="node-type">Node Type</label>
                <select
                  id="node-type"
                  className="form-select"
                  value={currentNode.type || 'path'}
                  onChange={(e) => setCurrentNode({ ...currentNode, type: e.target.value as NodeType })}
                >
                  <option value="path">Pathway Intersection</option>
                  <option value="entrance">Entrance / Exit</option>
                  <option value="poi">Point of Interest (POI)</option>
                  <option value="store">Store Booth Location</option>
                  <option value="emergency">Emergency Exit Path</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="node-floor">Floor</label>
                <input
                  id="node-floor"
                  type="text"
                  className="form-input"
                  value={currentNode.floor || ''}
                  onChange={(e) => setCurrentNode({ ...currentNode, floor: e.target.value })}
                  placeholder="e.g. 1"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="node-lat">Latitude *</label>
                <input
                  id="node-lat"
                  type="number"
                  step="any"
                  className="form-input"
                  required
                  value={currentNode.latitude ?? ''}
                  onChange={(e) => setCurrentNode({ ...currentNode, latitude: Number(e.target.value) })}
                  placeholder="e.g. 6.92712"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="node-lng">Longitude *</label>
                <input
                  id="node-lng"
                  type="number"
                  step="any"
                  className="form-input"
                  required
                  value={currentNode.longitude ?? ''}
                  onChange={(e) => setCurrentNode({ ...currentNode, longitude: Number(e.target.value) })}
                  placeholder="e.g. 79.86121"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Position Picker</label>
              <div style={{ height: '180px', width: '100%' }}>
                <FormMapPicker
                  latitude={currentNode.latitude || 0}
                  longitude={currentNode.longitude || 0}
                  onChange={(lat, lng) => setCurrentNode({ ...currentNode, latitude: lat, longitude: lng })}
                />
              </div>
            </div>

            {!currentNode.id && (
              <div className="form-group">
                <label className="form-label" htmlFor="node-connect-to">Connect to Existing Node (Optional)</label>
                <select
                  id="node-connect-to"
                  className="form-select"
                  value={(currentNode as any).connect_to_node_id || ''}
                  onChange={(e) => setCurrentNode({ ...currentNode, connect_to_node_id: e.target.value } as any)}
                >
                  <option value="">Do not connect (isolated node)</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} (Floor {n.floor || '1'} · {n.type})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="node-store">Link to Store (Optional)</label>
              <select
                id="node-store"
                className="form-select"
                value={currentNode.store_id || ''}
                onChange={(e) => setCurrentNode({ ...currentNode, store_id: e.target.value })}
              >
                <option value="">None</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsNodeModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? <span className="spinner" /> : <Check size={16} />}
                Save
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* EDGE MODAL */}
      {isEdgeModalOpen && currentEdge && (
        <AdminModal
          title="Connect Nodes (Add Edge)"
          onClose={() => setIsEdgeModalOpen(false)}
        >
          <form onSubmit={handleEdgeFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {formError && (
              <div className="alert alert-error">
                <span>{formError}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="edge-from">From Node</label>
              <select
                id="edge-from"
                className="form-select"
                value={currentEdge.from_node_id || ''}
                onChange={(e) => {
                  const fromId = e.target.value;
                  const toId = currentEdge.to_node_id || '';
                  const autoDist = toId ? autoCalcDistance(fromId, toId) : null;
                  setCurrentEdge({
                    ...currentEdge,
                    from_node_id: fromId,
                    distance: autoDist ?? currentEdge.distance,
                  });
                  setIsDistanceAutoCalc(autoDist !== null);
                }}
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({n.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edge-to">To Node</label>
              <select
                id="edge-to"
                className="form-select"
                value={currentEdge.to_node_id || ''}
                onChange={(e) => {
                  const toId = e.target.value;
                  const fromId = currentEdge.from_node_id || '';
                  const autoDist = fromId ? autoCalcDistance(fromId, toId) : null;
                  setCurrentEdge({
                    ...currentEdge,
                    to_node_id: toId,
                    distance: autoDist ?? currentEdge.distance,
                  });
                  setIsDistanceAutoCalc(autoDist !== null);
                }}
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({n.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label className="form-label" htmlFor="edge-dist" style={{ margin: 0 }}>Distance (meters)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {isDistanceAutoCalc && (
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 700,
                      color: 'var(--color-success, #22c55e)',
                      background: 'rgba(34,197,94,0.1)',
                      border: '1px solid rgba(34,197,94,0.25)',
                      borderRadius: '4px', padding: '0.1rem 0.4rem',
                      letterSpacing: '0.03em',
                    }}>
                      📐 Auto-calculated
                    </span>
                  )}
                  {!isDistanceAutoCalc && currentEdge.from_node_id && currentEdge.to_node_id && (
                    <button
                      type="button"
                      title="Recalculate from node coordinates"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.25rem',
                        fontSize: '0.7rem', fontWeight: 600,
                        background: 'rgba(99,102,241,0.1)',
                        border: '1px solid rgba(99,102,241,0.25)',
                        borderRadius: '4px', padding: '0.15rem 0.5rem',
                        color: 'var(--color-primary-h)', cursor: 'pointer',
                      }}
                      onClick={() => {
                        const dist = autoCalcDistance(
                          currentEdge.from_node_id!,
                          currentEdge.to_node_id!
                        );
                        if (dist !== null) {
                          setCurrentEdge({ ...currentEdge, distance: dist });
                          setIsDistanceAutoCalc(true);
                        }
                      }}
                    >
                      <RefreshCw size={10} /> Recalc
                    </button>
                  )}
                </div>
              </div>
              <input
                id="edge-dist"
                type="number"
                step="0.01"
                min="0.01"
                className="form-input"
                value={currentEdge.distance ?? ''}
                onChange={(e) => {
                  setCurrentEdge({ ...currentEdge, distance: Number(e.target.value) });
                  setIsDistanceAutoCalc(false); // manual entry clears the badge
                }}
                placeholder="e.g. 5.50"
              />
              <p style={{ fontSize: '0.72rem', color: 'var(--color-muted)', marginTop: '0.3rem', lineHeight: 1.4 }}>
                Auto-filled from node coordinates. Override if the real walkable path curves around obstacles.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={!!currentEdge.is_bidirectional}
                    onChange={(e) => setCurrentEdge({ ...currentEdge, is_bidirectional: e.target.checked })}
                  />
                  <span className="toggle-track" />
                </label>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Bidirectional Connection</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsEdgeModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? <span className="spinner" /> : <Check size={16} />}
                Add Connection
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* Node Delete Confirmation Modal */}
      {isDeleteNodeModalOpen && currentNode && (
        <AdminModal
          title="Delete Node?"
          onClose={() => setIsDeleteNodeModalOpen(false)}
          maxWidth={400}
        >
          <div style={{ textAlign: 'center' }}>
            <div className="confirm-icon">
              <Trash2 size={24} color="var(--color-danger)" />
            </div>
            <h3 style={{ marginBottom: '0.5rem', fontWeight: 700 }}>Delete Node?</h3>
            <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Are you sure you want to delete node <strong>{currentNode.label}</strong>? This will remove all associated path connections (edges).
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setIsDeleteNodeModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleNodeDeleteConfirm}
                disabled={submitting}
              >
                {submitting ? <span className="spinner" /> : <Trash2 size={16} />}
                Delete
              </button>
            </div>
          </div>
        </AdminModal>
      )}

      {/* Edge Delete Confirmation Modal */}
      {isDeleteEdgeModalOpen && currentEdge && (
        <AdminModal
          title="Delete Edge Connection?"
          onClose={() => setIsDeleteEdgeModalOpen(false)}
          maxWidth={400}
        >
          <div style={{ textAlign: 'center' }}>
            <div className="confirm-icon">
              <Trash2 size={24} color="var(--color-danger)" />
            </div>
            <h3 style={{ marginBottom: '0.5rem', fontWeight: 700 }}>Delete Connection?</h3>
            <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Are you sure you want to sever this connection between these nodes?
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setIsDeleteEdgeModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleEdgeDeleteConfirm}
                disabled={submitting}
              >
                {submitting ? <span className="spinner" /> : <Trash2 size={16} />}
                Delete Edge
              </button>
            </div>
          </div>
        </AdminModal>
      )}

      {/* DRAW PATH MODAL */}
      {isDrawPathModalOpen && (
        <AdminModal
          title="Draw Navigation Path"
          onClose={() => setIsDrawPathModalOpen(false)}
          maxWidth={880}
        >
          <form
            onSubmit={handleDrawPathSubmit}
            className="admin-form"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', maxHeight: '80vh', overflowY: 'auto', paddingRight: '0.5rem' }}
          >
            {/* ── Left: controls ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', lineHeight: 1.45, margin: 0 }}>
                Click the map to add path nodes. Click an existing node dot to connect it. Click a numbered badge to rename that node.
              </p>

              {formError && (
                <div className="alert alert-error" style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>
                  {formError}
                </div>
              )}

              {/* Draw / Erase tool toggle */}
              <div className="form-group">
                <label className="form-label">Drawing Tool</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['draw', 'erase'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDrawPathTool(t)}
                      style={{
                        flex: 1, padding: '0.5rem', borderRadius: 8,
                        border: `1.5px solid ${
                          drawPathTool === t
                            ? (t === 'draw' ? '#6366f1' : '#ef4444')
                            : 'var(--color-border)'
                        }`,
                        background:
                          drawPathTool === t
                            ? (t === 'draw' ? 'rgba(99,102,241,0.15)' : 'rgba(239,68,68,0.12)')
                            : 'var(--color-surface)',
                        color:
                          drawPathTool === t
                            ? (t === 'draw' ? '#818cf8' : '#f87171')
                            : 'var(--color-muted)',
                        fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      {t === 'draw' ? '✏️ Draw' : '🗑️ Erase'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats chips */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0.22rem 0.6rem', borderRadius: 6, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.22)', color: '#818cf8' }}>
                  {drawPathPoints.length} point{drawPathPoints.length !== 1 ? 's' : ''}
                </span>
                {drawPathPoints.filter((p) => !p.existingNodeId).length > 0 && (
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0.22rem 0.6rem', borderRadius: 6, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)', color: '#6366f1' }}>
                    {drawPathPoints.filter((p) => !p.existingNodeId).length} new
                  </span>
                )}
                {drawPathPoints.filter((p) => !!p.existingNodeId).length > 0 && (
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0.22rem 0.6rem', borderRadius: 6, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.28)', color: '#f59e0b' }}>
                    {drawPathPoints.filter((p) => !!p.existingNodeId).length} existing
                  </span>
                )}
              </div>

              {/* Direction */}
              <div className="form-group">
                <label className="form-label" htmlFor="draw-direction">Path Direction</label>
                <select
                  id="draw-direction"
                  className="form-select"
                  value={drawPathBidirectional ? 'bi' : 'uni'}
                  onChange={(e) => setDrawPathBidirectional(e.target.value === 'bi')}
                >
                  <option value="bi">↔ Bidirectional (Two-way walkway)</option>
                  <option value="uni">→ One-directional (One-way path)</option>
                </select>
              </div>

              {/* Floor */}
              <div className="form-group">
                <label className="form-label" htmlFor="draw-floor">Floor</label>
                <input
                  id="draw-floor"
                  type="text"
                  className="form-input"
                  value={drawPathFloor}
                  onChange={(e) => setDrawPathFloor(e.target.value)}
                  placeholder="e.g. 1"
                />
              </div>

              {/* Undo / Clear */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setDrawPathPoints((p) => p.slice(0, -1))}
                  className="btn btn-ghost btn-sm"
                  disabled={drawPathPoints.length === 0}
                  style={{ flex: 1 }}
                >
                  ↩ Undo Point
                </button>
                <button
                  type="button"
                  onClick={() => setDrawPathPoints([])}
                  className="btn btn-danger btn-sm"
                  disabled={drawPathPoints.length === 0}
                  style={{ flex: 1 }}
                >
                  Clear All
                </button>
              </div>

              {/* Cancel / Save */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsDrawPathModalOpen(false)}
                  disabled={submitting}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || drawPathPoints.length < 2}
                  style={{ flex: 1 }}
                >
                  {submitting ? <span className="spinner" /> : <Check size={16} />}
                  Save Path
                </button>
              </div>
            </div>

            {/* ── Right: map ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '400px' }}>
              <label className="form-label">Click map to place nodes · Click dot to connect existing:</label>
              <div style={{ flex: 1, position: 'relative' }}>
                <DrawPathMapPicker
                  nodes={nodes}
                  edges={edges}
                  stores={stores}
                  points={drawPathPoints}
                  setPoints={setDrawPathPoints}
                  tool={drawPathTool}
                  onToolChange={setDrawPathTool}
                  onEraseEdge={handleEraseEdge}
                  startNodeCounter={nodes.length + 1}
                />
              </div>
            </div>
          </form>
        </AdminModal>
      )}

      {/* KML Import Modal */}
      <KmlImportModal
        isOpen={isKmlImportModalOpen}
        onClose={() => setIsKmlImportModalOpen(false)}
        existingNodes={nodes}
        onSuccess={loadAllData}
      />

      {/* QR Code Calibration Placard Modal */}
      <QrCodeModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        target={qrTarget}
      />
    </main>
  );
}

interface GroupedEdge {
  id: string;
  from_node: NavigationNode;
  to_node: NavigationNode;
  distance: number;
  is_bidirectional: boolean;
  edge_ids: string[];
}

function getGroupedEdges(nodes: NavigationNode[], edges: NavigationEdge[]): GroupedEdge[] {
  const adj: { [nodeId: string]: Array<{ toId: string; edge: NavigationEdge }> } = {};
  
  nodes.forEach((n) => {
    adj[n.id] = [];
  });

  edges.forEach((edge) => {
    if (adj[edge.from_node_id] && adj[edge.to_node_id]) {
      adj[edge.from_node_id].push({ toId: edge.to_node_id, edge });
      adj[edge.to_node_id].push({ toId: edge.from_node_id, edge });
    }
  });

  const visitedEdges = new Set<string>();
  const grouped: GroupedEdge[] = [];

  const landmarks = nodes.filter((n) => n.type !== 'path');

  landmarks.forEach((startNode) => {
    const neighbors = adj[startNode.id] || [];
    
    neighbors.forEach(({ toId, edge }) => {
      if (visitedEdges.has(edge.id)) return;

      const edgeIds = [edge.id];
      let totalDistance = edge.distance;
      let isBidirectional = edge.is_bidirectional;
      
      let prevId = startNode.id;
      let currId = toId;
      let currNode = nodes.find((n) => n.id === currId);

      while (currNode && currNode.type === 'path') {
        const currNeighbors = adj[currId] || [];
        const next = currNeighbors.find((n) => n.toId !== prevId);
        if (!next) {
          break;
        }
        
        visitedEdges.add(next.edge.id);
        edgeIds.push(next.edge.id);
        totalDistance += next.edge.distance;
        if (!next.edge.is_bidirectional) {
          isBidirectional = false;
        }

        prevId = currId;
        currId = next.toId;
        currNode = nodes.find((n) => n.id === currId);
      }

      visitedEdges.add(edge.id);

      if (currNode && currId !== startNode.id) {
        grouped.push({
          id: edge.id,
          from_node: startNode,
          to_node: currNode,
          distance: Math.round(totalDistance * 100) / 100,
          is_bidirectional: isBidirectional,
          edge_ids: edgeIds,
        });
      }
    });
  });

  // Handle remaining path nodes that never connect to landmarks (fallback)
  edges.forEach((edge) => {
    if (!visitedEdges.has(edge.id)) {
      const fromNode = nodes.find((n) => n.id === edge.from_node_id);
      const toNode = nodes.find((n) => n.id === edge.to_node_id);
      if (fromNode && toNode) {
        grouped.push({
          id: edge.id,
          from_node: fromNode,
          to_node: toNode,
          distance: edge.distance,
          is_bidirectional: edge.is_bidirectional,
          edge_ids: [edge.id],
        });
      }
    }
  });

  return grouped;
}
