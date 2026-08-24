import { useEffect, useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Calendar,
  MapPin,
  Check,
  Clock,
  Image as ImageIcon,
  ClipboardList,
} from 'lucide-react';
import { supabase, type Exhibition, type ExhibitionEvent } from '../../lib/supabase';
import { AdminTable } from '../../components/admin/AdminTable';
import { AdminModal } from '../../components/admin/AdminModal';
import { useAuth } from '../../contexts/AuthContext';

export function AdminExhibitionsPage() {
  const { user } = useAuth();
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentExhibition, setCurrentExhibition] = useState<Partial<Exhibition> | null>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Tab state inside modal
  const [activeModalTab, setActiveModalTab] = useState<'details' | 'schedule'>('details');

  // Sub-resource states (linked to current edited exhibition)
  const [events, setEvents] = useState<ExhibitionEvent[]>([]);

  // Event form inputs
  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventSpeaker, setEventSpeaker] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  useEffect(() => {
    fetchExhibitions();
  }, []);

  async function fetchExhibitions() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('exhibitions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setExhibitions(data || []);
    } catch (err) {
      console.error('Error fetching exhibitions:', err);
    } finally {
      setLoading(false);
    }
  }

  // Fetch events for the selected exhibition when editing
  async function loadExhibitionEvents(exId: string) {
    try {
      const { data, error } = await supabase
        .from('exhibition_events')
        .select('*')
        .eq('exhibition_id', exId)
        .order('start_time', { ascending: true });
      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error('Error fetching exhibition events:', err);
    }
  }

  // Upload image to public storage bucket
  const uploadImage = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
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
    setCurrentExhibition({
      title: '',
      description: '',
      image_url: '',
      location: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
      latitude: 6.535472,
      longitude: 80.401000,
      is_featured: false,
      is_active: true,
    });
    setFormError('');
    setActiveModalTab('details');
    setEvents([]);
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (exhibition: Exhibition) => {
    setCurrentExhibition(exhibition);
    setFormError('');
    setActiveModalTab('details');
    loadExhibitionEvents(exhibition.id);
    setIsFormModalOpen(true);
  };

  const handleOpenDelete = (exhibition: Exhibition) => {
    setCurrentExhibition(exhibition);
    setIsDeleteModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentExhibition || !user) return;
    if (!currentExhibition.title) {
      setFormError('Title is required');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      const payload = {
        title: currentExhibition.title,
        description: currentExhibition.description || null,
        image_url: currentExhibition.image_url || null,
        location: currentExhibition.location || null,
        start_date: currentExhibition.start_date || null,
        end_date: currentExhibition.end_date || null,
        latitude: currentExhibition.latitude ? Number(currentExhibition.latitude) : null,
        longitude: currentExhibition.longitude ? Number(currentExhibition.longitude) : null,
        is_featured: !!currentExhibition.is_featured,
        is_active: !!currentExhibition.is_active,
        created_by: user.id,
      };

      if (currentExhibition.id) {
        // Update
        const { error } = await supabase
          .from('exhibitions')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', currentExhibition.id);
        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('exhibitions')
          .insert(payload);
        if (error) throw error;
      }

      setIsFormModalOpen(false);
      fetchExhibitions();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentExhibition?.id) return;

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('exhibitions')
        .delete()
        .eq('id', currentExhibition.id);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      fetchExhibitions();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  };

  // --- EVENTS SCHEDULE ACTIONS ---

  const handleSaveEvent = async () => {
    if (!currentExhibition?.id || !eventTitle.trim() || !eventStart || !eventEnd) return;
    try {
      const payload = {
        exhibition_id: currentExhibition.id,
        title: eventTitle.trim(),
        description: eventDesc.trim() || null,
        location: eventLocation.trim() || null,
        speaker: eventSpeaker.trim() || null,
        start_time: new Date(eventStart).toISOString(),
        end_time: new Date(eventEnd).toISOString(),
      };

      if (editingEventId) {
        const { error } = await supabase
          .from('exhibition_events')
          .update(payload)
          .eq('id', editingEventId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('exhibition_events')
          .insert(payload);
        if (error) throw error;
      }

      // Reset event fields
      setEventTitle('');
      setEventDesc('');
      setEventLocation('');
      setEventSpeaker('');
      setEventStart('');
      setEventEnd('');
      setEditingEventId(null);

      loadExhibitionEvents(currentExhibition.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save event');
    }
  };

  const handleStartEditEvent = (evt: ExhibitionEvent) => {
    setEditingEventId(evt.id);
    setEventTitle(evt.title || '');
    setEventDesc(evt.description || '');
    setEventLocation(evt.location || '');
    setEventSpeaker(evt.speaker || '');
    // Convert ISO string to datetime-local format 'YYYY-MM-DDTHH:MM'
    setEventStart(evt.start_time ? new Date(evt.start_time).toISOString().substring(0, 16) : '');
    setEventEnd(evt.end_time ? new Date(evt.end_time).toISOString().substring(0, 16) : '');
  };

  const handleCancelEditEvent = () => {
    setEditingEventId(null);
    setEventTitle('');
    setEventDesc('');
    setEventLocation('');
    setEventSpeaker('');
    setEventStart('');
    setEventEnd('');
  };

  const handleDeleteEvent = async (eventId: string) => {
    try {
      const { error } = await supabase
        .from('exhibition_events')
        .delete()
        .eq('id', eventId);
      if (error) throw error;
      if (currentExhibition?.id) {
        loadExhibitionEvents(currentExhibition.id);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete event');
    }
  };

  const filteredExhibitions = exhibitions.filter((ex) =>
    ex.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (ex.location && ex.location.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const columns = [
    {
      key: 'title',
      label: 'Title',
      render: (row: Exhibition) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {row.image_url ? (
            <img src={row.image_url} alt="" style={{ width: 36, height: 24, borderRadius: '4px', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 36, height: 24, borderRadius: '4px', background: 'var(--color-surface2)' }} />
          )}
          <div>
            <div style={{ fontWeight: 600 }}>{row.title}</div>
            {row.description && (
              <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'location',
      label: 'Location',
      render: (row: Exhibition) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          <MapPin size={14} className="text-muted" />
          {row.location || 'N/A'}
        </span>
      ),
    },
    {
      key: 'dates',
      label: 'Duration',
      render: (row: Exhibition) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}>
          <Calendar size={14} className="text-muted" />
          {row.start_date || '?'} to {row.end_date || '?'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: '100px',
      render: (row: Exhibition) => {
        const nowStr = new Date().toISOString().split('T')[0];
        let statusBadge = <span className="badge badge-inactive">Inactive</span>;
        if (row.is_active) {
          if (row.end_date && row.end_date < nowStr) {
            statusBadge = <span className="badge badge-muted">Ended</span>;
          } else if (row.start_date && row.start_date > nowStr) {
            statusBadge = <span className="badge badge-info">Upcoming</span>;
          } else {
            statusBadge = <span className="badge badge-success">Active</span>;
          }
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {statusBadge}
            {row.is_featured && <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>Featured</span>}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '120px',
      render: (row: Exhibition) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => handleOpenEdit(row)}
            title="Edit exhibition, coordinates, and schedule"
          >
            <Edit2 size={14} />
          </button>
          <button
            className="btn btn-danger btn-sm btn-icon"
            onClick={() => handleOpenDelete(row)}
            title="Delete exhibition"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>Exhibitions</h1>
          <p>Create and coordinate exhibition events</p>
        </div>
        <button className="btn btn-primary" onClick={handleOpenAdd}>
          <Plus size={16} />
          Add Exhibition
        </button>
      </header>

      {/* Toolbar / Search */}
      <section className="data-table-wrap">
        <div className="data-table-toolbar">
          <div className="search-wrap">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search by title or location..."
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <AdminTable
          columns={columns}
          rows={filteredExhibitions}
          loading={loading}
          emptyMessage="No exhibitions configured."
        />
      </section>

      {/* Add / Edit Form Modal */}
      {isFormModalOpen && currentExhibition && (
        <AdminModal
          title={currentExhibition.id ? 'Edit Exhibition' : 'Add Exhibition'}
          onClose={() => setIsFormModalOpen(false)}
          maxWidth={600}
        >
          {/* Sub-tabs if editing an existing exhibition */}
          {currentExhibition.id && (
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1.25rem', paddingBottom: '0.5rem' }}>
              <button
                type="button"
                className={`btn btn-sm ${activeModalTab === 'details' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveModalTab('details')}
              >
                Exhibition Details
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeModalTab === 'schedule' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveModalTab('schedule')}
              >
                <ClipboardList size={14} /> Schedule Events ({events.length})
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
                <label className="form-label" htmlFor="ex-title">Title *</label>
                <input
                  id="ex-title"
                  type="text"
                  className="form-input"
                  required
                  value={currentExhibition.title || ''}
                  onChange={(e) => setCurrentExhibition({ ...currentExhibition, title: e.target.value })}
                  placeholder="Exhibition title"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="ex-desc">Description</label>
                <textarea
                  id="ex-desc"
                  className="form-textarea"
                  value={currentExhibition.description || ''}
                  onChange={(e) => setCurrentExhibition({ ...currentExhibition, description: e.target.value })}
                  placeholder="Short description of the event..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="ex-start">Start Date</label>
                  <input
                    id="ex-start"
                    type="date"
                    className="form-input"
                    value={currentExhibition.start_date || ''}
                    onChange={(e) => setCurrentExhibition({ ...currentExhibition, start_date: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="ex-end">End Date</label>
                  <input
                    id="ex-end"
                    type="date"
                    className="form-input"
                    value={currentExhibition.end_date || ''}
                    onChange={(e) => setCurrentExhibition({ ...currentExhibition, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="ex-location">Location / Hall</label>
                  <input
                    id="ex-location"
                    type="text"
                    className="form-input"
                    value={currentExhibition.location || ''}
                    onChange={(e) => setCurrentExhibition({ ...currentExhibition, location: e.target.value })}
                    placeholder="e.g. Hall A, Stage B"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="ex-lat">Latitude</label>
                  <input
                    id="ex-lat"
                    type="number"
                    step="any"
                    className="form-input"
                    value={currentExhibition.latitude || ''}
                    onChange={(e) => setCurrentExhibition({ ...currentExhibition, latitude: Number(e.target.value) })}
                    placeholder="e.g. 6.9271"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="ex-lng">Longitude</label>
                  <input
                    id="ex-lng"
                    type="number"
                    step="any"
                    className="form-input"
                    value={currentExhibition.longitude || ''}
                    onChange={(e) => setCurrentExhibition({ ...currentExhibition, longitude: Number(e.target.value) })}
                    placeholder="e.g. 79.8612"
                  />
                </div>
              </div>

              {/* Exhibition Banner File upload & manual URL fallback */}
              <div className="form-group">
                <label className="form-label">Exhibition Banner / Flyer</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  {currentExhibition.image_url ? (
                    <img
                      src={currentExhibition.image_url}
                      alt="Banner Preview"
                      style={{ width: 64, height: 44, borderRadius: '6px', objectFit: 'cover', border: '1px solid var(--color-border)' }}
                    />
                  ) : (
                    <div style={{ width: 64, height: 44, borderRadius: '6px', background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                          setCurrentExhibition((prev) => prev ? { ...prev, image_url: url } : null);
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
                      placeholder="Or enter image URL manually..."
                      className="form-input"
                      value={currentExhibition.image_url || ''}
                      onChange={(e) => setCurrentExhibition({ ...currentExhibition, image_url: e.target.value })}
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
                      checked={!!currentExhibition.is_featured}
                      onChange={(e) => setCurrentExhibition({ ...currentExhibition, is_featured: e.target.checked })}
                    />
                    <span className="toggle-track" />
                  </label>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Featured Event</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!!currentExhibition.is_active}
                      onChange={(e) => setCurrentExhibition({ ...currentExhibition, is_active: e.target.checked })}
                    />
                    <span className="toggle-track" />
                  </label>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Active / Visible</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
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

          {activeModalTab === 'schedule' && currentExhibition.id && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Event input Form */}
              <div className="glass" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-warning)' }}>
                  {editingEventId ? 'Edit Scheduled Event' : 'Schedule New Event'}
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Event Title (e.g. Opening Keynote Speech)"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Speaker (e.g. John Doe)"
                    value={eventSpeaker}
                    onChange={(e) => setEventSpeaker(e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <label style={{ fontSize: '0.6rem', color: 'var(--color-muted)' }}>Location</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Stage B"
                      value={eventLocation}
                      onChange={(e) => setEventLocation(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <label style={{ fontSize: '0.6rem', color: 'var(--color-muted)' }}>Start Time</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={eventStart}
                      onChange={(e) => setEventStart(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <label style={{ fontSize: '0.6rem', color: 'var(--color-muted)' }}>End Time</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={eventEnd}
                      onChange={(e) => setEventEnd(e.target.value)}
                    />
                  </div>
                </div>

                <textarea
                  className="form-textarea"
                  placeholder="Seminar details/agenda/notes..."
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                  style={{ minHeight: '60px' }}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {editingEventId && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleCancelEditEvent}
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveEvent}
                    disabled={!eventTitle.trim() || !eventStart || !eventEnd}
                  >
                    {editingEventId ? 'Update Event' : 'Add Event'}
                  </button>
                </div>
              </div>

              {/* Events timeline list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto' }}>
                {events.length === 0 ? (
                  <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem' }}>
                    No events scheduled yet.
                  </p>
                ) : (
                  events.map((evt) => {
                    const startStr = new Date(evt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div
                        key={evt.id}
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
                          <h4 style={{ fontSize: '0.9rem', fontWeight: 700 }}>{evt.title}</h4>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                            <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />
                            {startStr} {evt.location ? `· ${evt.location}` : ''}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => handleStartEditEvent(evt)}
                            title="Edit event"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            onClick={() => handleDeleteEvent(evt.id)}
                            title="Delete event"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </AdminModal>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && currentExhibition && (
        <AdminModal
          title="Confirm Delete"
          onClose={() => setIsDeleteModalOpen(false)}
          maxWidth={400}
        >
          <div style={{ textAlign: 'center' }}>
            <div className="confirm-icon">
              <Trash2 size={24} color="var(--color-danger)" />
            </div>
            <h3 style={{ marginBottom: '0.5rem', fontWeight: 700 }}>Delete Exhibition?</h3>
            <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Are you sure you want to delete <strong>{currentExhibition.title}</strong>? This action cannot be undone and will affect associated stores.
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
