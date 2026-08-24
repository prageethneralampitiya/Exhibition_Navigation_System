import { useEffect, useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Check,
  Tag,
  Clock,
  Image as ImageIcon,
  Gift,
} from 'lucide-react';
import {
  supabase,
  type Store,
  type Category,
  type Exhibition,
  type StoreImage,
  type Promotion,
  type Profile,
} from '../../lib/supabase';
import { AdminTable } from '../../components/admin/AdminTable';
import { AdminModal } from '../../components/admin/AdminModal';
import { useAuth } from '../../contexts/AuthContext';
import { FormMapPicker } from '../../components/admin/FormMapPicker';

export function AdminStoresPage() {
  const { user, profile } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [storeAdmins, setStoreAdmins] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentStore, setCurrentStore] = useState<Partial<Store> | null>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Tab state inside modal
  const [activeModalTab, setActiveModalTab] = useState<'details' | 'gallery' | 'promotions'>('details');

  // Sub-resource states (linked to current edited store)
  const [galleryImages, setGalleryImages] = useState<StoreImage[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  // Form inputs for new sub-resources
  const [newImageUrl, setNewImageUrl] = useState('');
  const [promoTitle, setPromoTitle] = useState('');
  const [promoDesc, setPromoDesc] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoBanner, setPromoBanner] = useState('');
  const [promoStart, setPromoStart] = useState('');
  const [promoEnd, setPromoEnd] = useState('');
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);


  useEffect(() => {
    if (user) {
      loadDependencies();
    }
  }, [user, profile?.role]);

  async function loadDependencies() {
    try {
      setLoading(true);
      const [categoriesRes, exhibitionsRes, storeAdminsRes] = await Promise.all([
        supabase.from('categories').select('*').order('name'),
        supabase.from('exhibitions').select('*').order('title'),
        supabase.from('profiles').select('*').eq('role', 'store_admin').order('name'),
      ]);

      setCategories(categoriesRes.data || []);
      setExhibitions(exhibitionsRes.data || []);
      setStoreAdmins(storeAdminsRes.data || []);

      await fetchStores();
    } catch (err) {
      console.error('Error loading store page dependencies:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStores() {
    try {
      let query = supabase
        .from('stores')
        .select(`
          *,
          categories:category_id (id, name, color),
          exhibitions:exhibition_id (id, title)
        `);

      if (profile?.role === 'store_admin' && user?.id) {
        query = query.eq('store_admin_id', user.id);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      const storesList = data || [];
      setStores(storesList);

      // If store_admin, automatically open the edit page for their assigned store
      if (profile?.role === 'store_admin' && storesList.length > 0 && !hasAutoOpened) {
        setHasAutoOpened(true);
        handleOpenEdit(storesList[0]);
      }
    } catch (err) {
      console.error('Error fetching stores:', err);
    }
  }

  // Load photos and promotions for the selected store when editing
  async function loadStoreSubResources(storeId: string) {
    try {
      const [imagesRes, promosRes] = await Promise.all([
        supabase.from('store_images').select('*').eq('store_id', storeId).order('created_at', { ascending: false }),
        supabase.from('promotions').select('*').eq('store_id', storeId).order('created_at', { ascending: false }),
      ]);
      setGalleryImages(imagesRes.data || []);
      setPromotions(promosRes.data || []);
    } catch (err) {
      console.error('Error fetching store gallery/promos:', err);
    }
  }

  // Helper function to upload image file to Supabase storage public bucket 'store-assets'
  const uploadImage = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
    // Store assets will be in root of the bucket for ease of access
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('store-assets')
      .upload(filePath, file);

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage
      .from('store-assets')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const handleOpenAdd = () => {
    setCurrentStore({
      name: '',
      description: '',
      logo_url: '',
      category_id: categories[0]?.id || '',
      exhibition_id: exhibitions[0]?.id || '',
      floor: '1',
      opening_time: '09:00:00',
      closing_time: '18:00:00',
      latitude: 6.535472,
      longitude: 80.401000,
      phone: '',
      email: '',
      website: '',
      is_active: true,
    });
    setFormError('');
    setActiveModalTab('details');
    setGalleryImages([]);
    setPromotions([]);
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (store: Store) => {
    setCurrentStore(store);
    setFormError('');
    setActiveModalTab('details');
    loadStoreSubResources(store.id);
    setIsFormModalOpen(true);
  };

  const handleOpenDelete = (store: Store) => {
    setCurrentStore(store);
    setIsDeleteModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentStore || !user) return;
    if (!currentStore.name) {
      setFormError('Store name is required');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      const payload = {
        name: currentStore.name,
        description: currentStore.description || null,
        logo_url: currentStore.logo_url || null,
        category_id: currentStore.category_id || null,
        exhibition_id: currentStore.exhibition_id || null,
        floor: currentStore.floor || null,
        opening_time: currentStore.opening_time || null,
        closing_time: currentStore.closing_time || null,
        latitude: currentStore.latitude ? Number(currentStore.latitude) : null,
        longitude: currentStore.longitude ? Number(currentStore.longitude) : null,
        phone: currentStore.phone || null,
        email: currentStore.email || null,
        website: currentStore.website || null,
        is_active: !!currentStore.is_active,
        store_admin_id: profile?.role === 'admin'
          ? (currentStore.store_admin_id ?? null)
          : null,
        created_by: currentStore.created_by || user.id,
      };

      if (currentStore.id) {
        // Update
        const { error } = await supabase
          .from('stores')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', currentStore.id);
        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('stores')
          .insert(payload);
        if (error) throw error;
      }

      setIsFormModalOpen(false);
      fetchStores();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentStore?.id) return;

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('stores')
        .delete()
        .eq('id', currentStore.id);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      fetchStores();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  };

  // --- SUB-RESOURCES INLINE ACTIONS ---

  const handleAddImage = async () => {
    if (!currentStore?.id || !newImageUrl.trim()) return;
    try {
      const { error } = await supabase
        .from('store_images')
        .insert({
          store_id: currentStore.id,
          image_url: newImageUrl.trim(),
        });
      if (error) throw error;
      setNewImageUrl('');
      loadStoreSubResources(currentStore.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not add image');
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    try {
      const { error } = await supabase
        .from('store_images')
        .delete()
        .eq('id', imageId);
      if (error) throw error;
      if (currentStore?.id) {
        loadStoreSubResources(currentStore.id);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete image');
    }
  };

  const handleSavePromotion = async () => {
    if (!currentStore?.id || !promoTitle.trim()) return;
    try {
      const payload = {
        store_id: currentStore.id,
        title: promoTitle.trim(),
        description: promoDesc.trim() || null,
        discount_code: promoCode.trim() || null,
        banner_url: promoBanner.trim() || null,
        start_date: promoStart || null,
        end_date: promoEnd || null,
        is_active: true,
      };

      if (editingPromoId) {
        const { error } = await supabase
          .from('promotions')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingPromoId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('promotions')
          .insert(payload);
        if (error) throw error;
      }

      // Reset promo fields
      setPromoTitle('');
      setPromoDesc('');
      setPromoCode('');
      setPromoBanner('');
      setPromoStart('');
      setPromoEnd('');
      setEditingPromoId(null);

      loadStoreSubResources(currentStore.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save promotion');
    }
  };

  const handleStartEditPromotion = (promo: Promotion) => {
    setEditingPromoId(promo.id);
    setPromoTitle(promo.title || '');
    setPromoDesc(promo.description || '');
    setPromoCode(promo.discount_code || '');
    setPromoBanner(promo.banner_url || '');
    setPromoStart(promo.start_date || '');
    setPromoEnd(promo.end_date || '');
  };

  const handleCancelEditPromotion = () => {
    setEditingPromoId(null);
    setPromoTitle('');
    setPromoDesc('');
    setPromoCode('');
    setPromoBanner('');
    setPromoStart('');
    setPromoEnd('');
  };


  const handleDeletePromotion = async (promoId: string) => {
    try {
      const { error } = await supabase
        .from('promotions')
        .delete()
        .eq('id', promoId);
      if (error) throw error;
      if (currentStore?.id) {
        loadStoreSubResources(currentStore.id);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete promotion');
    }
  };

  const filteredStores = stores.filter((st) => {
    const matchesSearch =
      st.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (st.description && st.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      !selectedCategoryFilter || st.category_id === selectedCategoryFilter;

    return matchesSearch && matchesCategory;
  });

  const columns = [
    {
      key: 'name',
      label: 'Store / Booth',
      render: (row: Store) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {row.logo_url ? (
            <img
              src={row.logo_url}
              alt={row.name}
              style={{ width: 32, height: 32, borderRadius: '6px', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '6px',
                background: 'var(--color-surface2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 700,
              }}
            >
              {row.name[0]}
            </div>
          )}
          <div>
            <div style={{ fontWeight: 600 }}>{row.name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
              Floor: {row.floor || '1'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (row: Store) => {
        const cat = row.categories;
        return cat ? (
          <span
            className="badge"
            style={{
              background: `${cat.color || 'var(--color-primary)'}15`,
              color: cat.color || 'var(--color-primary-h)',
              borderColor: `${cat.color || 'var(--color-primary)'}30`,
            }}
          >
            <Tag size={12} style={{ marginRight: 2 }} />
            {cat.name}
          </span>
        ) : (
          <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem' }}>None</span>
        );
      },
    },
    {
      key: 'exhibition',
      label: 'Exhibition Event',
      render: (row: Store) => (
        <span style={{ fontSize: '0.85rem' }}>
          {row.exhibitions?.title || <span style={{ color: 'var(--color-muted)' }}>Standalone / None</span>}
        </span>
      ),
    },
    {
      key: 'hours',
      label: 'Hours',
      render: (row: Store) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}>
          <Clock size={12} className="text-muted" />
          {row.opening_time ? row.opening_time.substring(0, 5) : '09:00'} -{' '}
          {row.closing_time ? row.closing_time.substring(0, 5) : '18:00'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: '100px',
      render: (row: Store) => (
        <span className={`badge ${row.is_active ? 'badge-success' : 'badge-inactive'}`}>
          {row.is_active ? 'Active' : 'Disabled'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '120px',
      render: (row: Store) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => handleOpenEdit(row)}
            title="Edit store details, gallery, and promotions"
          >
            <Edit2 size={14} />
          </button>
          {profile?.role !== 'store_admin' && (
            <button
              className="btn btn-danger btn-sm btn-icon"
              onClick={() => handleOpenDelete(row)}
              title="Delete store"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>{profile?.role === 'store_admin' ? 'My Store Design & Settings' : 'Stores & Booths'}</h1>
          <p>{profile?.role === 'store_admin' ? 'Manage your store details, photos, and promotions' : 'Organize exhibitors, floor maps, and contact info'}</p>
        </div>
        {profile?.role !== 'store_admin' && (
          <button className="btn btn-primary" onClick={handleOpenAdd}>
            <Plus size={16} />
            Add Store
          </button>
        )}
      </header>

      {/* Toolbar */}
      <section className="data-table-wrap">
        <div className="data-table-toolbar">
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', flex: 1 }}>
            <div className="search-wrap">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search by store name..."
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="form-select"
              style={{ width: '180px', padding: '0.5rem 1rem' }}
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <AdminTable
          columns={columns}
          rows={filteredStores}
          loading={loading}
          emptyMessage="No stores or booths created."
        />
      </section>

      {/* Add / Edit Form Modal */}
      {isFormModalOpen && currentStore && (
        <AdminModal
          title={currentStore.id ? 'Edit Store & Profile' : 'Add Store / Booth'}
          onClose={() => setIsFormModalOpen(false)}
          maxWidth={600}
        >
          {/* Sub-tabs if editing an existing store */}
          {currentStore.id && (
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1.25rem', paddingBottom: '0.5rem' }}>
              <button
                type="button"
                className={`btn btn-sm ${activeModalTab === 'details' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveModalTab('details')}
              >
                Store Profile
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeModalTab === 'gallery' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveModalTab('gallery')}
              >
                <ImageIcon size={14} /> Gallery Images ({galleryImages.length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeModalTab === 'promotions' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveModalTab('promotions')}
              >
                <Gift size={14} /> Promotions ({promotions.length})
              </button>
            </div>
          )}

          {activeModalTab === 'details' && (
            <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {formError && (
                <div className="alert alert-error">
                  <span>{formError}</span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="store-name">Store Name *</label>
                <input
                  id="store-name"
                  type="text"
                  className="form-input"
                  required
                  value={currentStore.name || ''}
                  onChange={(e) => setCurrentStore({ ...currentStore, name: e.target.value })}
                  placeholder="Shop or Booth Name"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="store-desc">Description</label>
                <textarea
                  id="store-desc"
                  className="form-textarea"
                  value={currentStore.description || ''}
                  onChange={(e) => setCurrentStore({ ...currentStore, description: e.target.value })}
                  placeholder="Describe what this booth sells or does..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="store-cat">Category</label>
                  <select
                    id="store-cat"
                    className="form-select"
                    value={currentStore.category_id || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, category_id: e.target.value })}
                  >
                    <option value="">Select Category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="store-ex">Exhibition Event</label>
                  <select
                    id="store-ex"
                    className="form-select"
                    value={currentStore.exhibition_id || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, exhibition_id: e.target.value })}
                  >
                    <option value="">Standalone (No Exhibition)</option>
                    {exhibitions.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {profile?.role === 'admin' && (
                <div className="form-group">
                  <label className="form-label" htmlFor="store-admin">Store Administrator</label>
                  <select
                    id="store-admin"
                    className="form-select"
                    value={currentStore.store_admin_id || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, store_admin_id: e.target.value || null })}
                  >
                    <option value="">Unassigned / None</option>
                    {storeAdmins.map((adm) => (
                      <option key={adm.id} value={adm.id}>
                        {adm.name || 'Unnamed'} ({adm.email || 'No email'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="store-floor">Floor / Level</label>
                  <input
                    id="store-floor"
                    type="text"
                    className="form-input"
                    value={currentStore.floor || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, floor: e.target.value })}
                    placeholder="e.g. Ground, 1, 2"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="store-open">Opening Time</label>
                  <input
                    id="store-open"
                    type="time"
                    className="form-input"
                    value={currentStore.opening_time || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, opening_time: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="store-close">Closing Time</label>
                  <input
                    id="store-close"
                    type="time"
                    className="form-input"
                    value={currentStore.closing_time || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, closing_time: e.target.value })}
                  />
                </div>
              </div>

              {/* Coordinates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="store-lat">Latitude</label>
                  <input
                    id="store-lat"
                    type="number"
                    step="any"
                    className="form-input"
                    value={currentStore.latitude ?? ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, latitude: Number(e.target.value) })}
                    placeholder="e.g. 6.9271"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="store-lng">Longitude</label>
                  <input
                    id="store-lng"
                    type="number"
                    step="any"
                    className="form-input"
                    value={currentStore.longitude ?? ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, longitude: Number(e.target.value) })}
                    placeholder="e.g. 79.8612"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Position Picker</label>
                <div style={{ height: '180px', width: '100%' }}>
                  <FormMapPicker
                    latitude={currentStore.latitude || 0}
                    longitude={currentStore.longitude || 0}
                    onChange={(lat, lng) => setCurrentStore({ ...currentStore, latitude: lat, longitude: lng })}
                  />
                </div>
              </div>

              {/* Contacts */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="store-phone">Phone</label>
                  <input
                    id="store-phone"
                    type="tel"
                    className="form-input"
                    value={currentStore.phone || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, phone: e.target.value })}
                    placeholder="+9471..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="store-email">Email</label>
                  <input
                    id="store-email"
                    type="email"
                    className="form-input"
                    value={currentStore.email || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, email: e.target.value })}
                    placeholder="exhibitor@brand.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="store-web">Website</label>
                  <input
                    id="store-web"
                    type="text"
                    className="form-input"
                    value={currentStore.website || ''}
                    onChange={(e) => setCurrentStore({ ...currentStore, website: e.target.value })}
                    placeholder="brand.com"
                  />
                </div>
              </div>

              {/* Store Logo file upload & manual input */}
              <div className="form-group">
                <label className="form-label">Store Logo / Brand Icon</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  {currentStore.logo_url ? (
                    <img
                      src={currentStore.logo_url}
                      alt="Logo Preview"
                      style={{ width: 48, height: 48, borderRadius: '8px', objectFit: 'cover', border: '1px solid var(--color-border)' }}
                    />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: '8px', background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ImageIcon size={20} color="var(--color-muted)" />
                    </div>
                  )}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          setSubmitting(true);
                          const url = await uploadImage(file);
                          setCurrentStore((prev) => prev ? { ...prev, logo_url: url } : null);
                        } catch (err: unknown) {
                          alert('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                      className="form-input"
                      style={{ fontSize: '0.85rem', padding: '0.4rem 0.65rem' }}
                    />
                    <input
                      type="url"
                      placeholder="Or enter logo URL manually..."
                      className="form-input"
                      value={currentStore.logo_url || ''}
                      onChange={(e) => setCurrentStore({ ...currentStore, logo_url: e.target.value })}
                      style={{ fontSize: '0.85rem', padding: '0.4rem 0.65rem' }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!!currentStore.is_active}
                      onChange={(e) => setCurrentStore({ ...currentStore, is_active: e.target.checked })}
                    />
                    <span className="toggle-track" />
                  </label>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Active / Visible</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsFormModalOpen(false)}
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
          )}

          {activeModalTab === 'gallery' && currentStore.id && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Add New Image File upload */}
              <div className="form-group">
                <label className="form-label">Upload New Gallery Photos (Multiple Selection Allowed)</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0 || !currentStore?.id) return;
                      try {
                        setSubmitting(true);
                        
                        // Upload all images concurrently
                        const insertPromises = Array.from(files).map(async (file) => {
                          const url = await uploadImage(file);
                          return {
                            store_id: currentStore.id!,
                            image_url: url,
                          };
                        });
                        
                        const payload = await Promise.all(insertPromises);
                        
                        // Bulk insert images into database
                        const { error } = await supabase
                          .from('store_images')
                          .insert(payload);
                        
                        if (error) throw error;
                        loadStoreSubResources(currentStore.id);
                      } catch (err: unknown) {
                        alert('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
                      } finally {
                        setSubmitting(false);
                        e.target.value = ''; // reset file input
                      }
                    }}
                    className="form-input"
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.5rem' }}>
                  <input
                    type="url"
                    className="form-input"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="Or enter gallery image URL manually..."
                    style={{ fontSize: '0.85rem', flex: 1 }}
                  />
                  <button type="button" className="btn btn-ghost" onClick={handleAddImage} disabled={!newImageUrl.trim()}>
                    Add URL
                  </button>
                </div>
              </div>

              {/* Images list */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '1rem', maxHeight: '300px', overflowY: 'auto' }}>
                {galleryImages.length === 0 ? (
                  <p style={{ gridColumn: '1 / -1', color: 'var(--color-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem' }}>
                    No gallery images added yet.
                  </p>
                ) : (
                  galleryImages.map((img) => (
                    <div key={img.id} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)', height: '90px' }}>
                      <img src={img.image_url} alt="Gallery" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button
                        type="button"
                        onClick={() => handleDeleteImage(img.id)}
                        className="btn btn-danger btn-icon"
                        style={{ position: 'absolute', right: '4px', top: '4px', padding: '0.2rem', borderRadius: '4px' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeModalTab === 'promotions' && currentStore.id && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Add / Edit Promotion Form */}
              <div className="glass" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-warning)' }}>
                  {editingPromoId ? 'Edit Promotion / Discount' : 'New Promotion / Discount'}
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Offer Title (e.g. 20% OFF Electronics)"
                    value={promoTitle}
                    onChange={(e) => setPromoTitle(e.target.value)}
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Code (e.g. ELEC20)"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                  />
                </div>

                <textarea
                  className="form-textarea"
                  placeholder="Offer details/description..."
                  value={promoDesc}
                  onChange={(e) => setPromoDesc(e.target.value)}
                  style={{ minHeight: '60px' }}
                />

                {/* Promo Banner / Flyer upload */}
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.65rem' }}>Promo Banner / Flyer Image</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {promoBanner && (
                      <img
                        src={promoBanner}
                        alt="Promo Preview"
                        style={{ width: 60, height: 40, borderRadius: '4px', objectFit: 'cover', border: '1px solid var(--color-border)' }}
                      />
                    )}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            setSubmitting(true);
                            const url = await uploadImage(file);
                            setPromoBanner(url);
                          } catch (err: unknown) {
                            alert('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
                          } finally {
                            setSubmitting(false);
                          }
                        }}
                        className="form-input"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                      />
                      <input
                        type="url"
                        className="form-input"
                        placeholder="Or enter banner URL manually..."
                        value={promoBanner}
                        onChange={(e) => setPromoBanner(e.target.value)}
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.65rem' }}>Start Date</label>
                    <input type="date" className="form-input" value={promoStart} onChange={(e) => setPromoStart(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.65rem' }}>End Date</label>
                    <input type="date" className="form-input" value={promoEnd} onChange={(e) => setPromoEnd(e.target.value)} />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {editingPromoId && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleCancelEditPromotion}
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSavePromotion}
                    disabled={!promoTitle.trim()}
                  >
                    {editingPromoId ? 'Update Deal' : 'Create Deal'}
                  </button>
                </div>
              </div>

              {/* Promotions List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto' }}>
                {promotions.length === 0 ? (
                  <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem' }}>
                    No active deals running yet.
                  </p>
                ) : (
                  promotions.map((promo) => (
                    <div
                      key={promo.id}
                      style={{
                        padding: '0.75rem 1rem',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px dashed var(--color-border)',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <h4 style={{ fontSize: '0.9rem', fontWeight: 700 }}>{promo.title}</h4>
                        {promo.discount_code && <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--color-warning)' }}>Code: {promo.discount_code}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon"
                          onClick={() => handleStartEditPromotion(promo)}
                          title="Edit promotion"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm btn-icon"
                          onClick={() => handleDeletePromotion(promo.id)}
                          title="Delete promotion"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </AdminModal>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && currentStore && (
        <AdminModal
          title="Confirm Delete"
          onClose={() => setIsDeleteModalOpen(false)}
          maxWidth={400}
        >
          <div style={{ textAlign: 'center' }}>
            <div className="confirm-icon">
              <Trash2 size={24} color="var(--color-danger)" />
            </div>
            <h3 style={{ marginBottom: '0.5rem', fontWeight: 700 }}>Delete Store?</h3>
            <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Are you sure you want to delete <strong>{currentStore.name}</strong>? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
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
                Delete
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </main>
  );
}
