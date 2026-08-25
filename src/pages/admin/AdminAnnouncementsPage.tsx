import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Check, Megaphone, BellRing } from 'lucide-react';
import { supabase, type Announcement } from '../../lib/supabase';
import { AdminModal } from '../../components/admin/AdminModal';
import { useAuth } from '../../contexts/AuthContext';

export function AdminAnnouncementsPage() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentAnnouncement, setCurrentAnnouncement] = useState<Partial<Announcement> | null>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Broadcast states
  const [broadcastId, setBroadcastId] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [broadcastingLoading, setBroadcastingLoading] = useState(false);

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  async function fetchAnnouncements() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Extract current live broadcast status
      const broadcast = data?.find((a) => a.type === 'broadcast');
      if (broadcast) {
        setBroadcastId(broadcast.id);
        setIsLive(broadcast.is_active);
        setYoutubeUrl(broadcast.message);
      } else {
        setBroadcastId(null);
        setIsLive(false);
      }

      setAnnouncements(data || []);
    } catch (err) {
      console.error('Error fetching announcements:', err);
    } finally {
      setLoading(false);
    }
  }

  function extractYoutubeId(urlOrId: string): string | null {
    if (!urlOrId) return null;
    const clean = urlOrId.trim();
    if (clean.length === 11 && !clean.includes('/') && !clean.includes('?')) {
      return clean;
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|live\/)([^#&?]*).*/;
    const match = clean.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  }

  const handleToggleBroadcast = async () => {
    if (!user) return;
    setBroadcastingLoading(true);
    try {
      if (isLive) {
        // Stop broadcast
        if (broadcastId) {
          const { error } = await supabase
            .from('announcements')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', broadcastId);
          if (error) throw error;
          setIsLive(false);
        }
      } else {
        // Start broadcast
        const ytId = extractYoutubeId(youtubeUrl);
        if (!ytId) {
          alert('Please enter a valid YouTube Video ID or Live URL.');
          return;
        }

        const payload = {
          title: 'Live Voice Broadcast',
          message: ytId,
          type: 'broadcast',
          is_active: true,
          created_by: user.id,
        };

        if (broadcastId) {
          // Update existing
          const { error } = await supabase
            .from('announcements')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', broadcastId);
          if (error) throw error;
        } else {
          // Insert new
          const { data, error } = await supabase
            .from('announcements')
            .insert(payload)
            .select();
          if (error) throw error;
          if (data && data[0]) {
            setBroadcastId(data[0].id);
          }
        }
        setIsLive(true);
      }
      fetchAnnouncements();
    } catch (err) {
      console.error('Error toggling broadcast:', err);
      alert(err instanceof Error ? err.message : 'Broadcast toggle failed');
    } finally {
      setBroadcastingLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setCurrentAnnouncement({
      title: '',
      message: '',
      type: 'info',
      is_active: true,
    });
    setFormError('');
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (ann: Announcement) => {
    setCurrentAnnouncement(ann);
    setFormError('');
    setIsFormModalOpen(true);
  };

  const handleOpenDelete = (ann: Announcement) => {
    setCurrentAnnouncement(ann);
    setIsDeleteModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAnnouncement || !user) return;
    if (!currentAnnouncement.title || !currentAnnouncement.message) {
      setFormError('Title and message are required');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      const payload = {
        title: currentAnnouncement.title,
        message: currentAnnouncement.message,
        type: currentAnnouncement.type || 'info',
        is_active: !!currentAnnouncement.is_active,
        created_by: user.id,
      };

      if (currentAnnouncement.id) {
        // Update
        const { error } = await supabase
          .from('announcements')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', currentAnnouncement.id);
        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('announcements')
          .insert(payload);
        if (error) throw error;
      }

      setIsFormModalOpen(false);
      fetchAnnouncements();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentAnnouncement?.id) return;

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('id', currentAnnouncement.id);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      fetchAnnouncements();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (ann: Announcement) => {
    try {
      const { error } = await supabase
        .from('announcements')
        .update({ is_active: !ann.is_active, updated_at: new Date().toISOString() })
        .eq('id', ann.id);
      if (error) throw error;
      fetchAnnouncements();
    } catch (err) {
      console.error('Error toggling announcement activity:', err);
    }
  };

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>Announcements</h1>
          <p>Broadcast alerts, news, and safety guidelines to visitors</p>
        </div>
        <button className="btn btn-primary" onClick={handleOpenAdd}>
          <Plus size={16} />
          Broadcast Announcement
        </button>
      </header>

      {/* Voice Broadcast Manager Card */}
      <section
        className="glass"
        style={{
          padding: '1.5rem',
          marginBottom: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          borderLeft: `6px solid ${isLive ? '#ef4444' : 'var(--color-border)'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              className={isLive ? 'live-dot-pulse' : ''}
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                backgroundColor: isLive ? '#ef4444' : 'var(--color-muted)',
              }}
            />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>Online Voice Broadcast (YouTube)</h2>
          </div>
          {isLive && (
            <span
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              LIVE BROADCAST ACTIVE
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: 0 }}>
          Broadcast your voice live from your device microphone to all visitors. Stream via OBS Studio or YouTube web cam to get your Live URL, then input it below.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-input"
            style={{ flex: 1, minWidth: '250px' }}
            disabled={isLive || broadcastingLoading}
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="Paste YouTube Live URL or 11-character Video ID (e.g., watch?v=dQw4w9WgXcQ)"
          />
          <button
            className={`btn ${isLive ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleToggleBroadcast}
            disabled={broadcastingLoading || (!isLive && !youtubeUrl.trim())}
            style={{ minWidth: '160px' }}
          >
            {broadcastingLoading ? (
              <span className="spinner" />
            ) : isLive ? (
              'Stop Broadcast'
            ) : (
              'Start Broadcast'
            )}
          </button>
        </div>
      </section>

      {/* Grid of announcements */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="glass skeleton" style={{ height: '120px', width: '100%' }} />
          ))
        ) : announcements.filter((a) => a.type !== 'broadcast').length === 0 ? (
          <div className="glass" style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-muted)' }}>
            No announcements created yet.
          </div>
        ) : (
          announcements.filter((a) => a.type !== 'broadcast').map((ann) => (
            <div
              key={ann.id}
              className="glass"
              style={{
                padding: '1.5rem',
                borderLeft: `6px solid var(--color-${
                  ann.type === 'emergency'
                    ? 'danger'
                    : ann.type === 'warning'
                    ? 'warning'
                    : 'primary'
                })`,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: '10px',
                    background: `var(--color-${
                      ann.type === 'emergency'
                        ? 'danger'
                        : ann.type === 'warning'
                        ? 'warning'
                        : 'primary'
                    })15`,
                    color: `var(--color-${
                      ann.type === 'emergency'
                        ? 'danger'
                        : ann.type === 'warning'
                        ? 'warning'
                        : 'primary-h'
                    })`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {ann.type === 'emergency' ? <BellRing size={20} /> : <Megaphone size={20} />}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{ann.title}</h3>
                    <span className={`badge badge-${ann.type}`}>{ann.type}</span>
                  </div>
                  <p style={{ fontSize: '0.925rem', marginTop: '0.4rem', lineHeight: 1.5, color: 'var(--color-text)' }}>
                    {ann.message}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
                    Created at {new Date(ann.created_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                {/* Active Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 600 }}>
                    {ann.is_active ? 'Active' : 'Draft'}
                  </span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={ann.is_active}
                      onChange={() => handleToggleActive(ann)}
                    />
                    <span className="toggle-track" />
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => handleOpenEdit(ann)}
                    title="Edit announcement"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="btn btn-danger btn-sm btn-icon"
                    onClick={() => handleOpenDelete(ann)}
                    title="Delete announcement"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Add / Edit Form Modal */}
      {isFormModalOpen && currentAnnouncement && (
        <AdminModal
          title={currentAnnouncement.id ? 'Edit Announcement' : 'New Broadcast'}
          onClose={() => setIsFormModalOpen(false)}
        >
          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {formError && (
              <div className="alert alert-error">
                <span>{formError}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="ann-title">Title *</label>
              <input
                id="ann-title"
                type="text"
                className="form-input"
                required
                value={currentAnnouncement.title || ''}
                onChange={(e) => setCurrentAnnouncement({ ...currentAnnouncement, title: e.target.value })}
                placeholder="Alert or Announcement Header"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="ann-type">Broadcast Type</label>
              <select
                id="ann-type"
                className="form-select"
                value={currentAnnouncement.type || 'info'}
                onChange={(e) => setCurrentAnnouncement({ ...currentAnnouncement, type: e.target.value as 'info' | 'warning' | 'emergency' })}
              >
                <option value="info">Info / News Broadcast</option>
                <option value="warning">Warning / Schedule Update</option>
                <option value="emergency">Emergency / Alert Broadcast</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="ann-msg">Message Body *</label>
              <textarea
                id="ann-msg"
                className="form-textarea"
                required
                value={currentAnnouncement.message || ''}
                onChange={(e) => setCurrentAnnouncement({ ...currentAnnouncement, message: e.target.value })}
                placeholder="Write the announcement description or notification content here..."
                style={{ minHeight: '120px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={!!currentAnnouncement.is_active}
                    onChange={(e) => setCurrentAnnouncement({ ...currentAnnouncement, is_active: e.target.checked })}
                  />
                  <span className="toggle-track" />
                </label>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Active (Visible to users)</span>
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
                Broadcast
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && currentAnnouncement && (
        <AdminModal
          title="Delete Announcement?"
          onClose={() => setIsDeleteModalOpen(false)}
          maxWidth={400}
        >
          <div style={{ textAlign: 'center' }}>
            <div className="confirm-icon">
              <Trash2 size={24} color="var(--color-danger)" />
            </div>
            <h3 style={{ marginBottom: '0.5rem', fontWeight: 700 }}>Delete Broadcast?</h3>
            <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Are you sure you want to delete <strong>{currentAnnouncement.title}</strong>? Visitors will no longer see this update.
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
