import { useEffect, useState, useCallback } from 'react';
import { Plus, Edit2, Trash2, Search, Check, Navigation2, Network, Link2, RefreshCw } from 'lucide-react';
import { supabase, type NavigationNode, type NavigationEdge, type Store, type NodeType } from '../../lib/supabase';
import { AdminTable } from '../../components/admin/AdminTable';
import { AdminModal } from '../../components/admin/AdminModal';
import { getDistance } from '../../utils/dijkstra';
import { FormMapPicker } from '../../components/admin/FormMapPicker';
import { DrawPathMapPicker } from '../../components/admin/DrawPathMapPicker';

export function AdminNodesPage() {
  const [nodes, setNodes] = useState<NavigationNode[]>([]);
  const [edges, setEdges] = useState<NavigationEdge[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'nodes' | 'edges'>('nodes');

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

  // Draw Path states
  const [isDrawPathModalOpen, setIsDrawPathModalOpen] = useState(false);
  const [drawPathStartNodeId, setDrawPathStartNodeId] = useState('');
  const [drawPathEndNodeId, setDrawPathEndNodeId] = useState('');
  const [newStartNodeName, setNewStartNodeName] = useState('');
  const [newEndNodeName, setNewEndNodeName] = useState('');
  const [drawPathPoints, setDrawPathPoints] = useState<Array<{ lat: number; lng: number }>>([]);
  const [drawPathBidirectional, setDrawPathBidirectional] = useState(true);
  const [drawPathBaseName, setDrawPathBaseName] = useState('Path Point');
  const [drawPathFloor, setDrawPathFloor] = useState('1');

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
      const [nodesRes, edgesRes, storesRes] = await Promise.all([
        supabase.from('navigation_nodes').select('*').order('label'),
        supabase.from('navigation_edges').select(`
          *,
          from_node:from_node_id (id, label),
          to_node:to_node_id (id, label)
        `),
        supabase.from('stores').select('*').order('name'),
      ]);

      setNodes(nodesRes.data || []);
      setEdges(edgesRes.data || []);
      setStores(storesRes.data || []);
    } catch (err) {
      console.error('Error loading navigation nodes page data:', err);
    } finally {
      setLoading(false);
    }
  }

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
    // Make default as none selected
    setDrawPathStartNodeId('');
    setDrawPathEndNodeId('');
    setNewStartNodeName('');
    setNewEndNodeName('');
    setDrawPathPoints([]);
    setDrawPathBidirectional(true);
    setDrawPathBaseName('Path Point');
    setDrawPathFloor('1');
    setFormError('');
    setIsDrawPathModalOpen(true);
  };

  const handleDrawPathSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawPathStartNodeId || !drawPathEndNodeId) {
      setFormError('Start and End nodes are required');
      return;
    }
    if (drawPathStartNodeId === 'new' && !newStartNodeName.trim()) {
      setFormError('Please enter a name for the new Start Node');
      return;
    }
    if (drawPathEndNodeId === 'new' && !newEndNodeName.trim()) {
      setFormError('Please enter a name for the new End Node');
      return;
    }

    // Validation of clicked points count
    const minPointsRequired = (drawPathStartNodeId === 'new' ? 1 : 0) + (drawPathEndNodeId === 'new' ? 1 : 0);
    if (drawPathPoints.length < Math.max(1, minPointsRequired)) {
      if (drawPathStartNodeId === 'new' && drawPathEndNodeId === 'new') {
        setFormError('Please click at least 2 points on the map to define the Start and End node coordinates');
      } else if (drawPathStartNodeId === 'new' || drawPathEndNodeId === 'new') {
        setFormError('Please click at least 1 point on the map to define the new node coordinates');
      } else {
        setFormError('Please click at least 1 intermediate waypoint on the map');
      }
      return;
    }

    if (drawPathStartNodeId !== 'new' && drawPathEndNodeId !== 'new' && drawPathStartNodeId === drawPathEndNodeId) {
      setFormError('Start and End nodes cannot be the same');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      let startNode: NavigationNode | null = null;
      let endNode: NavigationNode | null = null;
      let startPoint: { lat: number; lng: number } | null = null;
      let endPoint: { lat: number; lng: number } | null = null;
      let waypointPoints: Array<{ lat: number; lng: number }> = [];

      // Determine Start coordinates or load existing node
      if (drawPathStartNodeId === 'new') {
        startPoint = drawPathPoints[0];
      } else {
        const found = nodes.find((n) => n.id === drawPathStartNodeId);
        if (!found) throw new Error('Start node not found');
        startNode = found;
      }

      // Determine End coordinates or load existing node
      if (drawPathEndNodeId === 'new') {
        const lastIdx = drawPathPoints.length - 1;
        endPoint = drawPathPoints[lastIdx];
      } else {
        const found = nodes.find((n) => n.id === drawPathEndNodeId);
        if (!found) throw new Error('End node not found');
        endNode = found;
      }

      // Slice out intermediate waypoints
      const sIdx = drawPathStartNodeId === 'new' ? 1 : 0;
      const eIdx = drawPathEndNodeId === 'new' ? drawPathPoints.length - 1 : drawPathPoints.length;
      if (sIdx < eIdx) {
        waypointPoints = drawPathPoints.slice(sIdx, eIdx);
      }

      // 1. Insert new Start Node if necessary
      if (drawPathStartNodeId === 'new' && startPoint) {
        const { data: newSNode, error: nodeErr } = await supabase
          .from('navigation_nodes')
          .insert({
            label: newStartNodeName.trim(),
            latitude: startPoint.lat,
            longitude: startPoint.lng,
            floor: drawPathFloor || null,
            type: 'poi' as NodeType,
            store_id: null,
          })
          .select('*')
          .single();

        if (nodeErr) throw nodeErr;
        if (!newSNode) throw new Error('Failed to create new Start Node');
        startNode = newSNode as NavigationNode;
      }

      // 2. Insert new End Node if necessary
      if (drawPathEndNodeId === 'new' && endPoint) {
        const { data: newENode, error: nodeErr } = await supabase
          .from('navigation_nodes')
          .insert({
            label: newEndNodeName.trim(),
            latitude: endPoint.lat,
            longitude: endPoint.lng,
            floor: drawPathFloor || null,
            type: 'poi' as NodeType,
            store_id: null,
          })
          .select('*')
          .single();

        if (nodeErr) throw nodeErr;
        if (!newENode) throw new Error('Failed to create new End Node');
        endNode = newENode as NavigationNode;
      }

      // 3. Insert intermediate path points
      const createdWaypoints: NavigationNode[] = [];
      for (let i = 0; i < waypointPoints.length; i++) {
        const pt = waypointPoints[i];
        const payload = {
          label: `${drawPathBaseName} ${i + 1}`,
          latitude: pt.lat,
          longitude: pt.lng,
          floor: drawPathFloor || null,
          type: 'path' as NodeType,
          store_id: null,
        };

        const { data: newNode, error: nodeErr } = await supabase
          .from('navigation_nodes')
          .insert(payload)
          .select('*')
          .single();

        if (nodeErr) throw nodeErr;
        if (newNode) createdWaypoints.push(newNode as NavigationNode);
      }

      // 4. Build sequential chain: Start Node ➔ Waypoints ➔ End Node
      const fullChain = [startNode!, ...createdWaypoints, endNode!];

      // 5. Insert connecting edges
      const edgesToInsert = [];
      for (let i = 0; i < fullChain.length - 1; i++) {
        const from = fullChain[i];
        const to = fullChain[i + 1];
        const calculatedDist = getDistance(from.latitude, from.longitude, to.latitude, to.longitude);
        const roundedDist = Math.round(calculatedDist * 100) / 100;

        edgesToInsert.push({
          from_node_id: from.id,
          to_node_id: to.id,
          distance: roundedDist,
          is_bidirectional: drawPathBidirectional,
        });
      }

      const { error: edgesErr } = await supabase
        .from('navigation_edges')
        .insert(edgesToInsert);

      if (edgesErr) throw edgesErr;

      setIsDrawPathModalOpen(false);
      loadAllData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save drawn path');
    } finally {
      setSubmitting(false);
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

  const filteredNodes = nodes.filter((n) =>
    n.type !== 'path' && (
      n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.type.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const nodeColumns = [
    {
      key: 'label',
      label: 'Label / Name',
      render: (row: NavigationNode) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Navigation2 size={14} className={`node-type-${row.type}`} />
          <span style={{ fontWeight: 600 }}>{row.label}</span>
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Node Type',
      render: (row: NavigationNode) => (
        <span style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>{row.type}</span>
      ),
    },
    {
      key: 'coords',
      label: 'Coordinates (Lat / Lng)',
      render: (row: NavigationNode) => (
        <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem' }}>
          {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}
        </span>
      ),
    },
    {
      key: 'floor',
      label: 'Floor',
      width: '80px',
      render: (row: NavigationNode) => <span>{row.floor || '1'}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '120px',
      render: (row: NavigationNode) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => handleOpenEditNode(row)}
            title="Edit node"
          >
            <Edit2 size={14} />
          </button>
          <button
            className="btn btn-danger btn-sm btn-icon"
            onClick={() => handleOpenDeleteNode(row)}
            title="Delete node"
          >
            <Trash2 size={14} />
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

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={handleOpenDrawPath} style={{ border: '1px dashed var(--color-accent)', color: 'var(--color-accent)' }}>
            <Network size={16} />
            Draw Path
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
          title="Draw Navigation Path Waypoints"
          onClose={() => setIsDrawPathModalOpen(false)}
          maxWidth={850}
        >
          <form onSubmit={handleDrawPathSubmit} className="admin-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', maxHeight: '75vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
            {/* Left Column: Form Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>
                Choose two main nodes, then click sequentially on the map to define the custom walkable path.
              </p>

              {formError && (
                <div className="alert alert-error" style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>
                  {formError}
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="draw-start-node">First Point (Start Node) *</label>
                <select
                  id="draw-start-node"
                  className="form-select"
                  value={drawPathStartNodeId}
                  onChange={(e) => {
                    setDrawPathStartNodeId(e.target.value);
                    if (e.target.value !== 'new') setNewStartNodeName('');
                  }}
                  required
                >
                  <option value="">-- Select Start Node --</option>
                  <option value="new" style={{ fontWeight: 'bold', color: 'var(--color-accent)' }}>+ Create New Node (Click on Map)</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} (Floor {n.floor || '1'} · {n.type})
                    </option>
                  ))}
                </select>
              </div>

              {drawPathStartNodeId === 'new' && (
                <div className="form-group animate-fade-in">
                  <label className="form-label" htmlFor="new-start-node-name">New Start Node Name *</label>
                  <input
                    id="new-start-node-name"
                    type="text"
                    className="form-input"
                    value={newStartNodeName}
                    onChange={(e) => setNewStartNodeName(e.target.value)}
                    placeholder="e.g. Entrance Gate X"
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="draw-end-node">End Point (Destination Node) *</label>
                <select
                  id="draw-end-node"
                  className="form-select"
                  value={drawPathEndNodeId}
                  onChange={(e) => {
                    setDrawPathEndNodeId(e.target.value);
                    if (e.target.value !== 'new') setNewEndNodeName('');
                  }}
                  required
                >
                  <option value="">-- Select End Node --</option>
                  <option value="new" style={{ fontWeight: 'bold', color: 'var(--color-accent)' }}>+ Create New Node (Click on Map)</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} (Floor {n.floor || '1'} · {n.type})
                    </option>
                  ))}
                </select>
              </div>

              {drawPathEndNodeId === 'new' && (
                <div className="form-group animate-fade-in">
                  <label className="form-label" htmlFor="new-end-node-name">New End Node Name *</label>
                  <input
                    id="new-end-node-name"
                    type="text"
                    className="form-input"
                    value={newEndNodeName}
                    onChange={(e) => setNewEndNodeName(e.target.value)}
                    placeholder="e.g. Hall B Entrance"
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="draw-base-name">Waypoints Base Label</label>
                <input
                  id="draw-base-name"
                  type="text"
                  className="form-input"
                  value={drawPathBaseName}
                  onChange={(e) => setDrawPathBaseName(e.target.value)}
                  placeholder="e.g. Hallway A Path"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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

                <div className="form-group">
                  <label className="form-label" htmlFor="draw-direction">Direction</label>
                  <select
                    id="draw-direction"
                    className="form-select"
                    value={drawPathBidirectional ? 'bi' : 'uni'}
                    onChange={(e) => setDrawPathBidirectional(e.target.value === 'bi')}
                  >
                    <option value="bi">Bidirectional (Two-way)</option>
                    <option value="uni">One-directional (One-way)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setDrawPathPoints(drawPathPoints.slice(0, -1))}
                  className="btn btn-ghost btn-sm"
                  disabled={drawPathPoints.length === 0}
                  style={{ flex: 1 }}
                >
                  Undo Point
                </button>
                <button
                  type="button"
                  onClick={() => setDrawPathPoints([])}
                  className="btn btn-danger btn-sm"
                  disabled={drawPathPoints.length === 0}
                  style={{ flex: 1 }}
                >
                  Clear Points
                </button>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
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
                  disabled={submitting || drawPathPoints.length === 0}
                  style={{ flex: 1 }}
                >
                  {submitting ? <span className="spinner" /> : <Check size={16} />}
                  Save Path
                </button>
              </div>
            </div>

            {/* Right Column: Click Map Picker */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '380px' }}>
              <label className="form-label">Click Points sequentially on Map to build path:</label>
              <div style={{ flex: 1, position: 'relative' }}>
                <DrawPathMapPicker
                  nodes={nodes}
                  edges={edges}
                  stores={stores}
                  startNodeId={drawPathStartNodeId}
                  endNodeId={drawPathEndNodeId}
                  points={drawPathPoints}
                  setPoints={setDrawPathPoints}
                />
              </div>
            </div>
          </form>
        </AdminModal>
      )}
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
