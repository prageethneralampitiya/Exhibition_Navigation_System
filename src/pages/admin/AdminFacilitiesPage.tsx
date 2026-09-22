import { useEffect, useState, useMemo } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Check,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation2,
  Upload,
} from 'lucide-react';
import { supabase, type Store, type NavigationNode } from '../../lib/supabase';
import { AdminModal } from '../../components/admin/AdminModal';
import { FormMapPicker } from '../../components/admin/FormMapPicker';
import { KmlImportModal } from '../../components/admin/KmlImportModal';
import { getDistance } from '../../utils/dijkstra';

// ─── Facility Preset Definitions ─────────────────────────────────────────────
export interface FacilityPreset {
  id: string;
  label: string;
  defaultName: string;
  categoryName: string;
  categoryColor: string;
  emoji: string;
  description: string;
  defaultFloor: string;
}

export const FACILITY_PRESETS: FacilityPreset[] = [
  {
    id: 'canteen',
    label: 'Canteen / Food',
    defaultName: 'Main Canteen',
    categoryName: 'Food & Dining',
    categoryColor: '#f97316',
    emoji: '🍽️',
    description: 'Food, beverages, snacks, and dining area',
    defaultFloor: '1',
  },
  {
    id: 'washroom_men',
    label: 'Washroom (Men)',
    defaultName: "Men's Washroom",
    categoryName: 'Restrooms',
    categoryColor: '#3b82f6',
    emoji: '🚹',
    description: "Men's restrooms and washroom facilities",
    defaultFloor: '1',
  },
  {
    id: 'washroom_women',
    label: 'Washroom (Women)',
    defaultName: "Women's Washroom",
    categoryName: 'Restrooms',
    categoryColor: '#ec4899',
    emoji: '🚺',
    description: "Women's restrooms and washroom facilities",
    defaultFloor: '1',
  },
  {
    id: 'washroom_unisex',
    label: 'Washroom (Unisex)',
    defaultName: 'Restroom (All Gender)',
    categoryName: 'Restrooms',
    categoryColor: '#8b5cf6',
    emoji: '🚻',
    description: 'Unisex restroom facility',
    defaultFloor: '1',
  },
  {
    id: 'washroom_accessible',
    label: 'Accessible WC',
    defaultName: 'Accessible Washroom',
    categoryName: 'Restrooms',
    categoryColor: '#06b6d4',
    emoji: '♿',
    description: 'Wheelchair-accessible restroom',
    defaultFloor: '1',
  },
  {
    id: 'drinking_water',
    label: 'Water Point',
    defaultName: 'Drinking Water Station',
    categoryName: 'Services',
    categoryColor: '#0284c7',
    emoji: '🚰',
    description: 'Fresh filtered drinking water dispenser / fountain',
    defaultFloor: '1',
  },
  {
    id: 'first_aid',
    label: 'First Aid',
    defaultName: 'First Aid Station',
    categoryName: 'Medical & Emergency',
    categoryColor: '#ef4444',
    emoji: '🏥',
    description: 'First aid kits, emergency assistance, and medical care',
    defaultFloor: '1',
  },
  {
    id: 'info_desk',
    label: 'Info Desk',
    defaultName: 'Information Desk',
    categoryName: 'Visitor Services',
    categoryColor: '#10b981',
    emoji: 'ℹ️',
    description: 'Information desk, guide brochures, and assistance',
    defaultFloor: '1',
  },
  {
    id: 'main_entrance',
    label: 'Entrance Gate',
    defaultName: 'Main Entrance Gate',
    categoryName: 'Entrances & Exits',
    categoryColor: '#eab308',
    emoji: '🚪',
    description: 'Main campus or exhibition hall entrance / gate',
    defaultFloor: '1',
  },
  {
    id: 'custom',
    label: 'Custom POI',
    defaultName: 'Point of Interest',
    categoryName: 'Facilities',
    categoryColor: '#6366f1',
    emoji: '📍',
    description: 'Venue facility or special interest location',
    defaultFloor: '1',
  },
];

export function getFacilityTypeKey(name: string = '', categoryName: string = ''): string {
  const combined = `${name} ${categoryName}`.toLowerCase();
  if (combined.includes('canteen') || combined.includes('cafeteria') || combined.includes('food') || combined.includes('dining') || combined.includes('snack')) {
    return 'canteen';
  }
  if (combined.includes('men') && (combined.includes('washroom') || combined.includes('toilet') || combined.includes('restroom') || combined.includes('wc'))) {
    return 'washroom_men';
  }
  if (combined.includes('women') && (combined.includes('washroom') || combined.includes('toilet') || combined.includes('restroom') || combined.includes('wc'))) {
    return 'washroom_women';
  }
  if (combined.includes('accessible') || combined.includes('disabled') || combined.includes('wheelchair')) {
    return 'washroom_accessible';
  }
  if (combined.includes('washroom') || combined.includes('restroom') || combined.includes('toilet') || combined.includes('wc')) {
    return 'washroom_unisex';
  }
  if (combined.includes('water') || combined.includes('drinking')) {
    return 'drinking_water';
  }
  if (combined.includes('first aid') || combined.includes('medical') || combined.includes('doctor') || combined.includes('clinic')) {
    return 'first_aid';
  }
  if (combined.includes('info') || combined.includes('help') || combined.includes('inquiry')) {
    return 'info_desk';
  }
  if (combined.includes('entrance') || combined.includes('gate') || combined.includes('exit')) {
    return 'main_entrance';
  }
  return 'custom';
}

export function getFacilityPreset(name: string = '', categoryName: string = ''): FacilityPreset {
  const key = getFacilityTypeKey(name, categoryName);
  return FACILITY_PRESETS.find((p) => p.id === key) || FACILITY_PRESETS[FACILITY_PRESETS.length - 1];
}

// Helper to determine if a store record represents a facility/amenity
export function isFacilityStore(store: Store): boolean {
  const name = (store.name || '').toLowerCase();
  const cat = (store.categories?.name || '').toLowerCase();
  const facilityKeywords = [
    'canteen',
    'cafeteria',
    'food',
    'washroom',
    'toilet',
    'restroom',
    'wc',
    'men',
    'women',
    'water',
    'first aid',
    'medical',
    'info desk',
    'information',
    'help desk',
    'entrance',
    'gate',
  ];
  return facilityKeywords.some((k) => name.includes(k) || cat.includes(k));
}

export function AdminFacilitiesPage() {
  const [facilities, setFacilities] = useState<Store[]>([]);
  const [nodes, setNodes] = useState<NavigationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPresetFilter, setSelectedPresetFilter] = useState<string>('all');

  // Multi-selection state
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isKmlModalOpen, setIsKmlModalOpen] = useState(false);

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentFacility, setCurrentFacility] = useState<Partial<Store> | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('canteen');
  const [autoConnectPath, setAutoConnectPath] = useState(true);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Map preview expanded toggle
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const handleToggleSelectFacility = (id: string) => {
    setSelectedFacilityIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllFacilities = () => {
    if (filteredFacilities.length === 0) return;
    const allSelected = filteredFacilities.every(f => selectedFacilityIds.has(f.id));
    if (allSelected) {
      setSelectedFacilityIds(new Set());
    } else {
      setSelectedFacilityIds(new Set(filteredFacilities.map(f => f.id)));
    }
  };

  const handleBulkDeleteFacilities = async () => {
    if (selectedFacilityIds.size === 0) return;
    const count = selectedFacilityIds.size;
    const confirm = window.confirm(
      `Are you sure you want to delete ${count} selected facility(ies)? This will also remove their associated map navigation pins.`
    );
    if (!confirm) return;

    try {
      setIsBulkDeleting(true);
      const facilityIds = Array.from(selectedFacilityIds);

      // Clean up linked navigation nodes and edges
      const { data: linkedNodes } = await supabase
        .from('navigation_nodes')
        .select('id')
        .in('store_id', facilityIds);

      if (linkedNodes && linkedNodes.length > 0) {
        const nodeIds = linkedNodes.map(n => n.id);
        await supabase.from('navigation_edges').delete().in('from_node_id', nodeIds);
        await supabase.from('navigation_edges').delete().in('to_node_id', nodeIds);
        await supabase.from('navigation_nodes').delete().in('id', nodeIds);
      }

      const { error } = await supabase.from('stores').delete().in('id', facilityIds);
      if (error) throw error;

      setSelectedFacilityIds(new Set());
      await loadAllData();
    } catch (err: any) {
      alert('Failed to delete facilities: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsBulkDeleting(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    try {
      setLoading(true);
      const [storesRes, nodesRes] = await Promise.all([
        supabase
          .from('stores')
          .select(`
            *,
            categories:category_id (id, name, color)
          `)
          .order('created_at', { ascending: false }),
        supabase.from('navigation_nodes').select('*').order('label'),
      ]);

      if (storesRes.error) throw storesRes.error;
      if (nodesRes.error) throw nodesRes.error;

      const allStores = (storesRes.data || []) as Store[];
      // Keep stores identified as facilities
      const filteredFacilities = allStores.filter(isFacilityStore);
      setFacilities(filteredFacilities);
      setNodes((nodesRes.data || []) as NavigationNode[]);
    } catch (err) {
      console.error('Error loading facilities data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Find nearest navigation node to given coordinates
  function findNearestNode(lat: number, lng: number) {
    if (!nodes.length) return null;
    let closest: NavigationNode | null = null;
    let minDistance = Infinity;

    for (const node of nodes) {
      const dist = getDistance(lat, lng, node.latitude, node.longitude);
      if (dist < minDistance) {
        minDistance = dist;
        closest = node;
      }
    }
    return { node: closest, distance: Math.round(minDistance * 10) / 10 };
  }

  // Handle opening modal to create a new facility
  const handleOpenAdd = (presetId?: string) => {
    const targetPreset = FACILITY_PRESETS.find((p) => p.id === presetId) || FACILITY_PRESETS[0];
    setSelectedPresetId(targetPreset.id);

    // Default coordinates: Kalawana School campus center if available
    const defaultLat = 6.535472;
    const defaultLng = 80.401000;

    setCurrentFacility({
      name: targetPreset.defaultName,
      description: targetPreset.description,
      floor: targetPreset.defaultFloor,
      latitude: defaultLat,
      longitude: defaultLng,
      is_active: true,
    });
    setAutoConnectPath(true);
    setFormError('');
    setIsFormModalOpen(true);
  };

  // Handle opening modal to edit existing facility
  const handleOpenEdit = (facility: Store) => {
    const presetKey = getFacilityTypeKey(facility.name, facility.categories?.name || '');
    setSelectedPresetId(presetKey);
    setCurrentFacility({ ...facility });
    setAutoConnectPath(false);
    setFormError('');
    setIsFormModalOpen(true);
  };

  // Handle opening delete confirmation
  const handleOpenDelete = (facility: Store) => {
    setCurrentFacility(facility);
    setIsDeleteModalOpen(true);
  };

  // Switch preset inside modal
  const handleSelectPreset = (preset: FacilityPreset) => {
    setSelectedPresetId(preset.id);
    if (currentFacility) {
      // If user hasn't heavily customized the name, update with preset's default name
      const isDefaultish = FACILITY_PRESETS.some((p) => p.defaultName === currentFacility.name);
      setCurrentFacility({
        ...currentFacility,
        name: isDefaultish || !currentFacility.name ? preset.defaultName : currentFacility.name,
        description: currentFacility.description || preset.description,
        floor: currentFacility.floor || preset.defaultFloor,
      });
    }
  };

  // Save (insert or update) facility
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFacility) return;

    if (!currentFacility.name?.trim()) {
      setFormError('Facility name is required');
      return;
    }
    if (!currentFacility.latitude || !currentFacility.longitude) {
      setFormError('Please select coordinates on the map');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      const activePreset = FACILITY_PRESETS.find((p) => p.id === selectedPresetId) || FACILITY_PRESETS[0];

      // 1. Ensure or find appropriate category
      let categoryId = currentFacility.category_id;
      if (!categoryId) {
        const { data: existingCat } = await supabase
          .from('categories')
          .select('id')
          .ilike('name', activePreset.categoryName)
          .limit(1);

        if (existingCat && existingCat.length > 0) {
          categoryId = existingCat[0].id;
        } else {
          // Auto-create category if missing
          const { data: newCat } = await supabase
            .from('categories')
            .insert({
              name: activePreset.categoryName,
              color: activePreset.categoryColor,
              icon: 'MapPin',
            })
            .select('id')
            .single();
          if (newCat) categoryId = newCat.id;
        }
      }

      const storePayload = {
        name: currentFacility.name.trim(),
        description: currentFacility.description || activePreset.description,
        floor: currentFacility.floor || '1',
        latitude: currentFacility.latitude,
        longitude: currentFacility.longitude,
        category_id: categoryId || null,
        is_active: true,
      };

      let savedStoreId = currentFacility.id;

      if (currentFacility.id) {
        // UPDATE
        const { error: storeErr } = await supabase
          .from('stores')
          .update(storePayload)
          .eq('id', currentFacility.id);
        if (storeErr) throw storeErr;

        // Update corresponding navigation node if linked
        await supabase
          .from('navigation_nodes')
          .update({
            label: currentFacility.name.trim(),
            latitude: currentFacility.latitude,
            longitude: currentFacility.longitude,
            floor: currentFacility.floor || '1',
          })
          .eq('store_id', currentFacility.id);
      } else {
        // INSERT
        const { data: insertedStore, error: insertErr } = await supabase
          .from('stores')
          .insert(storePayload)
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        if (!insertedStore) throw new Error('Failed to create facility record');
        savedStoreId = insertedStore.id;

        // Auto-create linked POI navigation node
        const { data: newNode, error: nodeErr } = await supabase
          .from('navigation_nodes')
          .insert({
            label: currentFacility.name.trim(),
            latitude: currentFacility.latitude,
            longitude: currentFacility.longitude,
            floor: currentFacility.floor || '1',
            type: 'poi',
            store_id: savedStoreId,
          })
          .select('id')
          .single();

        if (nodeErr) {
          console.warn('Could not auto-create POI node:', nodeErr);
        }

        // Auto-connect to nearest pathway node if option is checked
        if (autoConnectPath && newNode) {
          const nearest = findNearestNode(currentFacility.latitude, currentFacility.longitude);
          if (nearest && nearest.node) {
            await supabase.from('navigation_edges').insert({
              from_node_id: newNode.id,
              to_node_id: nearest.node.id,
              distance: Math.max(1, nearest.distance),
              is_bidirectional: true,
            });
          }
        }
      }

      setIsFormModalOpen(false);
      await loadAllData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete facility & linked nodes
  const handleDeleteConfirm = async () => {
    if (!currentFacility?.id) return;
    try {
      setSubmitting(true);
      // Clean up linked navigation nodes first
      await supabase.from('navigation_nodes').delete().eq('store_id', currentFacility.id);

      const { error } = await supabase.from('stores').delete().eq('id', currentFacility.id);
      if (error) throw error;

      setIsDeleteModalOpen(false);
      await loadAllData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered facilities
  const filteredFacilities = useMemo(() => {
    return facilities.filter((f) => {
      const matchesSearch =
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (f.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (f.floor || '').toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (selectedPresetFilter === 'all') return true;

      const typeKey = getFacilityTypeKey(f.name, f.categories?.name || '');
      if (selectedPresetFilter === 'washroom_any') {
        return (
          typeKey === 'washroom_men' ||
          typeKey === 'washroom_women' ||
          typeKey === 'washroom_unisex' ||
          typeKey === 'washroom_accessible'
        );
      }
      return typeKey === selectedPresetFilter;
    });
  }, [facilities, searchQuery, selectedPresetFilter]);

  // Nearest node for currently edited coordinates
  const nearestNodePreview = useMemo(() => {
    if (!currentFacility?.latitude || !currentFacility?.longitude) return null;
    return findNearestNode(currentFacility.latitude, currentFacility.longitude);
  }, [currentFacility?.latitude, currentFacility?.longitude, nodes]);

  return (
    <main className="admin-page">
      {/* Page Header */}
      <header className="admin-page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.2), rgba(59, 130, 246, 0.2))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
              }}
            >
              📍
            </div>
            <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Facilities & POIs</h1>
          </div>
          <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
            Place and manage essential positions on the map: canteens, washrooms (men/women), water points, and service stations.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            onClick={() => setPreviewExpanded(!previewExpanded)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}
          >
            {previewExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            <span>{previewExpanded ? 'Hide Map Preview' : 'Show Map Overview'}</span>
          </button>

          <button
            className="btn btn-ghost"
            onClick={() => setIsKmlModalOpen(true)}
            title="Import facilities & paths from Google Earth (.kml)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              background: 'rgba(56, 189, 248, 0.08)',
              color: '#38bdf8',
            }}
          >
            <Upload size={15} />
            <span>Import KML</span>
          </button>

          <button
            className="btn btn-primary"
            onClick={() => handleOpenAdd('canteen')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Plus size={16} />
            <span>Add Facility</span>
          </button>
        </div>
      </header>

      {/* Quick Add Presets Row */}
      <section
        className="glass"
        style={{
          padding: '0.75rem 1rem',
          borderRadius: '12px',
          marginBottom: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)' }}>
            ⚡ 1-Click Quick Add Presets:
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>
            Click any button to open the map pin placer
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          {FACILITY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleOpenAdd(preset.id)}
              className="btn btn-ghost btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.8rem',
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = preset.categoryColor;
                e.currentTarget.style.background = `${preset.categoryColor}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              }}
            >
              <span>{preset.emoji}</span>
              <span style={{ fontWeight: 600 }}>{preset.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Map Overview Drawer (Collapsible) */}
      {previewExpanded && (
        <section
          className="glass"
          style={{
            padding: '1rem',
            borderRadius: '12px',
            marginBottom: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <MapPin size={16} color="var(--color-primary-h)" /> Placed Facilities ({facilities.length})
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
              All placed amenities appear live on the visitor map
            </span>
          </div>

          <div style={{ height: '240px', width: '100%', borderRadius: '8px', overflow: 'hidden' }}>
            <FormMapPicker
              latitude={facilities[0]?.latitude || 6.535472}
              longitude={facilities[0]?.longitude || 80.401000}
              onChange={() => {}}
            />
          </div>
        </section>
      )}

      {/* Search & Filter Bar */}
      <section
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All Places', count: facilities.length },
            { id: 'canteen', label: '🍽️ Canteens', count: facilities.filter((f) => getFacilityTypeKey(f.name, f.categories?.name || '') === 'canteen').length },
            { id: 'washroom_men', label: "🚹 Men's WC", count: facilities.filter((f) => getFacilityTypeKey(f.name, f.categories?.name || '') === 'washroom_men').length },
            { id: 'washroom_women', label: "🚺 Women's WC", count: facilities.filter((f) => getFacilityTypeKey(f.name, f.categories?.name || '') === 'washroom_women').length },
            { id: 'first_aid', label: '🏥 First Aid', count: facilities.filter((f) => getFacilityTypeKey(f.name, f.categories?.name || '') === 'first_aid').length },
            { id: 'drinking_water', label: '🚰 Water', count: facilities.filter((f) => getFacilityTypeKey(f.name, f.categories?.name || '') === 'drinking_water').length },
            { id: 'info_desk', label: 'ℹ️ Info', count: facilities.filter((f) => getFacilityTypeKey(f.name, f.categories?.name || '') === 'info_desk').length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedPresetFilter(tab.id)}
              className="btn btn-sm"
              style={{
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 600,
                padding: '0.35rem 0.65rem',
                background: selectedPresetFilter === tab.id ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.04)',
                color: selectedPresetFilter === tab.id ? '#fff' : 'var(--color-muted)',
                border: `1px solid ${selectedPresetFilter === tab.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: '220px' }}>
          <Search
            size={14}
            style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }}
          />
          <input
            type="text"
            className="form-input"
            placeholder="Search facilities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.2rem', fontSize: '0.82rem', height: '2rem' }}
          />
        </div>
      </section>

      {/* Multi-Selection Batch Actions Toolbar */}
      {selectedFacilityIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.6rem 1rem',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '10px',
            marginBottom: '0.75rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ef4444' }}>
              {selectedFacilityIds.size} facility(ies) selected
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedFacilityIds(new Set())}
              disabled={isBulkDeleting}
            >
              Deselect All
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={handleBulkDeleteFacilities}
              disabled={isBulkDeleting}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Trash2 size={14} />
              <span>Delete Selected ({selectedFacilityIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Facilities Table */}
      <section className="glass" style={{ borderRadius: '12px', overflow: 'hidden' }}>
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: '38px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={filteredFacilities.length > 0 && filteredFacilities.every((f) => selectedFacilityIds.has(f.id))}
                  onChange={handleToggleSelectAllFacilities}
                  title="Select All Facilities"
                  style={{ cursor: 'pointer', transform: 'scale(1.15)', margin: 0 }}
                />
              </th>
              <th style={{ width: '40px' }}>Icon</th>
              <th>Facility Name</th>
              <th>Category</th>
              <th style={{ width: '70px' }}>Floor</th>
              <th>Coordinates</th>
              <th>Status / Walkway</th>
              <th style={{ width: '100px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                  <div className="spinner" style={{ margin: '0 auto', width: 24, height: 24 }} />
                </td>
              </tr>
            ) : filteredFacilities.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-muted)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📍</div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text)' }}>
                    No facilities found
                  </div>
                  <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    Click <strong>"+ Add Facility"</strong> or choose a preset above to place your first canteen or washroom on the map!
                  </div>
                </td>
              </tr>
            ) : (
              filteredFacilities.map((facility) => {
                const preset = getFacilityPreset(facility.name, facility.categories?.name || '');
                const nearest = facility.latitude && facility.longitude ? findNearestNode(facility.latitude, facility.longitude) : null;

                return (
                  <tr key={facility.id}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedFacilityIds.has(facility.id)}
                        onChange={() => handleToggleSelectFacility(facility.id)}
                        style={{ cursor: 'pointer', transform: 'scale(1.1)', margin: 0 }}
                      />
                    </td>
                    <td>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: `${preset.categoryColor}20`,
                          border: `1px solid ${preset.categoryColor}40`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1rem',
                        }}
                      >
                        {preset.emoji}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)' }}>
                        {facility.name}
                      </div>
                      {facility.description && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.1rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {facility.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          background: `${preset.categoryColor}15`,
                          color: preset.categoryColor,
                          border: `1px solid ${preset.categoryColor}30`,
                        }}
                      >
                        {facility.categories?.name || preset.categoryName}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{facility.floor || '1'}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--color-muted)' }}>
                        {facility.latitude?.toFixed(5)}, {facility.longitude?.toFixed(5)}
                      </span>
                    </td>
                    <td>
                      {nearest ? (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            color: nearest.distance <= 15 ? '#4ade80' : '#facc15',
                          }}
                        >
                          <Navigation2 size={12} />
                          <span>{nearest.distance}m to {nearest.node?.label || 'path'}</span>
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>Isolated pin</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.3rem' }}>
                        <button
                          className="btn btn-ghost btn-sm btn-icon"
                          onClick={() => handleOpenEdit(facility)}
                          title="Edit facility location or details"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="btn btn-danger btn-sm btn-icon"
                          onClick={() => handleOpenDelete(facility)}
                          title="Delete facility"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* FORM MODAL (ADD / EDIT) */}
      {isFormModalOpen && currentFacility && (
        <AdminModal
          title={currentFacility.id ? 'Edit Facility / Position' : 'Place Facility on Map'}
          onClose={() => setIsFormModalOpen(false)}
        >
          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {formError && (
              <div className="alert alert-error">
                <span>{formError}</span>
              </div>
            )}

            {/* Quick Type Presets (inside modal) */}
            <div>
              <label className="form-label" style={{ marginBottom: '0.35rem', display: 'block' }}>
                Select Position Type:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.4rem' }}>
                {FACILITY_PRESETS.map((preset) => {
                  const isSelected = selectedPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.4rem 0.5rem',
                        borderRadius: '6px',
                        border: isSelected ? `2px solid ${preset.categoryColor}` : '1px solid var(--color-border)',
                        background: isSelected ? `${preset.categoryColor}20` : 'rgba(255, 255, 255, 0.02)',
                        color: isSelected ? '#fff' : 'var(--color-muted)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: '1.1rem' }}>{preset.emoji}</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: isSelected ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {preset.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Name & Floor */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="facility-name">Facility Label / Name *</label>
                <input
                  id="facility-name"
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Main Canteen, Men's Washroom"
                  value={currentFacility.name || ''}
                  onChange={(e) => setCurrentFacility({ ...currentFacility, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="facility-floor">Floor / Level</label>
                <input
                  id="facility-floor"
                  type="text"
                  className="form-input"
                  placeholder="e.g. 1, 2, Ground"
                  value={currentFacility.floor || '1'}
                  onChange={(e) => setCurrentFacility({ ...currentFacility, floor: e.target.value })}
                />
              </div>
            </div>

            {/* Description / Location hints */}
            <div className="form-group">
              <label className="form-label" htmlFor="facility-desc">Location Notes / Description</label>
              <input
                id="facility-desc"
                type="text"
                className="form-input"
                placeholder="e.g. Located behind Main Auditorium, near staircase"
                value={currentFacility.description || ''}
                onChange={(e) => setCurrentFacility({ ...currentFacility, description: e.target.value })}
              />
            </div>

            {/* Map Position Picker */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label className="form-label" style={{ margin: 0 }}>
                  Map Pin Position * (Click or drag pin)
                </label>
                <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--color-accent)' }}>
                  {currentFacility.latitude?.toFixed(6)}, {currentFacility.longitude?.toFixed(6)}
                </span>
              </div>

              <div style={{ height: '220px', width: '100%', borderRadius: '8px', overflow: 'hidden' }}>
                <FormMapPicker
                  latitude={currentFacility.latitude || 6.535472}
                  longitude={currentFacility.longitude || 80.401000}
                  onChange={(lat, lng) => setCurrentFacility({ ...currentFacility, latitude: lat, longitude: lng })}
                />
              </div>
            </div>

            {/* Auto-connect path option */}
            {!currentFacility.id && (
              <div
                style={{
                  padding: '0.6rem 0.8rem',
                  borderRadius: '8px',
                  background: 'rgba(34, 211, 238, 0.06)',
                  border: '1px solid rgba(34, 211, 238, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                }}
              >
                <input
                  type="checkbox"
                  id="auto-connect-path"
                  checked={autoConnectPath}
                  onChange={(e) => setAutoConnectPath(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
                />
                <label htmlFor="auto-connect-path" style={{ fontSize: '0.78rem', color: 'var(--color-text)', cursor: 'pointer' }}>
                  <strong>Auto-connect to closest pathway node</strong> for visitor turn-by-turn routing
                  {nearestNodePreview?.node && (
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--color-muted)', marginTop: '0.1rem' }}>
                      Nearest node: <strong>{nearestNodePreview.node.label}</strong> ({nearestNodePreview.distance}m away)
                    </span>
                  )}
                </label>
              </div>
            )}

            {/* Modal Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsFormModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <span className="spinner" /> : <Check size={16} />}
                <span>{currentFacility.id ? 'Save Changes' : 'Place Facility'}</span>
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {isDeleteModalOpen && currentFacility && (
        <AdminModal title="Delete Facility" onClose={() => setIsDeleteModalOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              Are you sure you want to remove <strong>{currentFacility.name}</strong> from the venue map?
            </p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-muted)' }}>
              Its map pin and navigation waypoint will be cleanly deleted.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteConfirm}
                disabled={submitting}
              >
                {submitting ? <span className="spinner" /> : <Trash2 size={16} />}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </AdminModal>
      )}

      {/* KML Import Modal */}
      <KmlImportModal
        isOpen={isKmlModalOpen}
        onClose={() => setIsKmlModalOpen(false)}
        existingNodes={nodes}
        existingStores={facilities}
        onSuccess={loadAllData}
      />
    </main>
  );
}
