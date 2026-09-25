import { useEffect, useState } from 'react';
import {
  PhoneCall,
  Plus,
  Edit2,
  Trash2,
  Check,
  ExternalLink,
  Video,
  ShieldAlert,
  Flame,
  Shield,
  Save,
  AlertCircle,
} from 'lucide-react';
import { AdminModal } from '../../components/admin/AdminModal';
import {
  fetchEmergencyContacts,
  saveEmergencyContacts,
  fetchVideoLivesConfig,
  saveVideoLivesConfig,
  type EmergencyContact,
  type VideoLivesConfig,
  DEFAULT_EMERGENCY_CONTACTS,
  DEFAULT_VIDEO_LIVES,
} from '../../services/appSettingsService';

export function AdminEmergencyPage() {
  // Video Lives state
  const [videoConfig, setVideoConfig] = useState<VideoLivesConfig>(DEFAULT_VIDEO_LIVES);
  const [videoSaving, setVideoSaving] = useState(false);
  const [videoSuccess, setVideoSuccess] = useState(false);

  // Emergency Contacts state
  const [contacts, setContacts] = useState<EmergencyContact[]>(DEFAULT_EMERGENCY_CONTACTS);
  const [loading, setLoading] = useState(true);

  // Contact Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentContact, setCurrentContact] = useState<Partial<EmergencyContact> | null>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [contactsData, videoData] = await Promise.all([
        fetchEmergencyContacts(),
        fetchVideoLivesConfig(),
      ]);
      setContacts(contactsData);
      setVideoConfig(videoData);
    } catch (err) {
      console.error('Error loading emergency & live streams data:', err);
    } finally {
      setLoading(false);
    }
  }

  // ── Video Lives Handlers ────────────────────────────────────
  const handleSaveVideoLives = async (e: React.FormEvent) => {
    e.preventDefault();
    setVideoSaving(true);
    setVideoSuccess(false);
    try {
      await saveVideoLivesConfig(videoConfig);
      setVideoSuccess(true);
      setTimeout(() => setVideoSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save video lives config:', err);
      alert('Failed to save video lives configuration');
    } finally {
      setVideoSaving(false);
    }
  };

  // ── Emergency Contacts Handlers ─────────────────────────────
  const handleOpenAdd = () => {
    setCurrentContact({
      id: `em-${Date.now()}`,
      title: '',
      phone: '',
      department: '',
      description: '',
      icon: 'phone',
      is_active: true,
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (contact: EmergencyContact) => {
    setCurrentContact({ ...contact });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenDelete = (contact: EmergencyContact) => {
    setCurrentContact(contact);
    setIsDeleteModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentContact?.title?.trim() || !currentContact?.phone?.trim()) {
      setFormError('Title and Phone Number are required');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      let updatedList: EmergencyContact[];
      const existingIndex = contacts.findIndex((c) => c.id === currentContact.id);

      if (existingIndex >= 0) {
        updatedList = contacts.map((c, i) =>
          i === existingIndex ? (currentContact as EmergencyContact) : c
        );
      } else {
        const newContact: EmergencyContact = {
          id: currentContact.id || `em-${Date.now()}`,
          title: currentContact.title.trim(),
          phone: currentContact.phone.trim(),
          department: currentContact.department?.trim() || '',
          description: currentContact.description?.trim() || '',
          icon: currentContact.icon || 'phone',
          is_active: currentContact.is_active ?? true,
        };
        updatedList = [...contacts, newContact];
      }

      setContacts(updatedList);
      await saveEmergencyContacts(updatedList);
      setIsModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!currentContact?.id) return;
    try {
      setSubmitting(true);
      const updatedList = contacts.filter((c) => c.id !== currentContact.id);
      setContacts(updatedList);
      await saveEmergencyContacts(updatedList);
      setIsDeleteModalOpen(false);
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (contact: EmergencyContact) => {
    const updatedList = contacts.map((c) =>
      c.id === contact.id ? { ...c, is_active: !c.is_active } : c
    );
    setContacts(updatedList);
    await saveEmergencyContacts(updatedList);
  };

  const renderIcon = (icon?: string) => {
    switch (icon) {
      case 'ambulance':
        return <ShieldAlert size={18} className="text-rose-400" />;
      case 'fire':
        return <Flame size={18} className="text-amber-400" />;
      case 'police':
        return <Shield size={18} className="text-blue-400" />;
      default:
        return <PhoneCall size={18} className="text-emerald-400" />;
    }
  };

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>Emergency Contacts &amp; Live Streams</h1>
          <p>Configure emergency hotline numbers and video livestream URLs shown to visitors</p>
        </div>
        <button className="btn btn-primary" onClick={handleOpenAdd} id="btn-add-emergency-contact">
          <Plus size={16} />
          Add Emergency Contact
        </button>
      </header>

      {/* ── Section 1: Video Live Stream Links ────────────────────── */}
      <section
        className="glass"
        style={{
          padding: '1.5rem',
          borderRadius: '1rem',
          marginBottom: '2rem',
          borderLeft: '5px solid #ef4444',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Video size={18} color="#ef4444" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
              Live Video Streams Configuration
            </h2>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
              Visitors who click &quot;Video Lives&quot; on the home page can choose between YouTube Live and Facebook Live
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveVideoLives} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
            {/* YouTube Live URL */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#e11d48',
                    display: 'inline-block',
                  }}
                />
                YouTube Live URL
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                <input
                  type="url"
                  className="form-control"
                  placeholder="https://www.youtube.com/watch?v=... or @channel/live"
                  value={videoConfig.youtube_url}
                  onChange={(e) => setVideoConfig({ ...videoConfig, youtube_url: e.target.value })}
                  style={{ flex: 1 }}
                />
                {videoConfig.youtube_url && (
                  <a
                    href={videoConfig.youtube_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                    title="Test YouTube link"
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <ExternalLink size={15} />
                  </a>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.25rem', display: 'block' }}>
                Paste the full YouTube live stream URL, video URL, or channel live link
              </span>
            </div>

            {/* Facebook Live URL */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#1877F2',
                    display: 'inline-block',
                  }}
                />
                Facebook Live URL
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                <input
                  type="url"
                  className="form-control"
                  placeholder="https://www.facebook.com/.../live"
                  value={videoConfig.facebook_url}
                  onChange={(e) => setVideoConfig({ ...videoConfig, facebook_url: e.target.value })}
                  style={{ flex: 1 }}
                />
                {videoConfig.facebook_url && (
                  <a
                    href={videoConfig.facebook_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                    title="Test Facebook link"
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <ExternalLink size={15} />
                  </a>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.25rem', display: 'block' }}>
                Paste your official Facebook Page live video link or live video feed
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'flex-end' }}>
            {videoSuccess && (
              <span style={{ color: '#10b981', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Check size={16} /> Saved successfully!
              </span>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={videoSaving}
              id="btn-save-video-lives"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Save size={15} />
              {videoSaving ? 'Saving...' : 'Save Video Live Links'}
            </button>
          </div>
        </form>
      </section>

      {/* ── Section 2: Emergency Contacts List ────────────────────── */}
      <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '8px',
                background: 'rgba(244, 63, 94, 0.2)',
                border: '1px solid rgba(244, 63, 94, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PhoneCall size={18} color="#f43f5e" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
                Emergency Hotline Directory ({contacts.length})
              </h2>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                Displayed in the visitor &quot;Emergency Contacts&quot; modal with 1-tap direct dialing
              </p>
            </div>
          </div>

          <button className="btn btn-primary btn-sm" onClick={handleOpenAdd}>
            <Plus size={14} /> Add Number
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-muted)' }}>
            Loading emergency numbers...
          </div>
        ) : contacts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-muted)' }}>
            <AlertCircle size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
            <p>No emergency contacts added yet. Click &quot;Add Emergency Contact&quot; above to create one.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>Type</th>
                  <th>Title &amp; Department</th>
                  <th>Phone Number</th>
                  <th>Description</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {renderIcon(contact.icon)}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                        {contact.title}
                      </div>
                      {contact.department && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                          {contact.department}
                        </div>
                      )}
                    </td>
                    <td>
                      <a
                        href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}
                        style={{
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          color: '#38bdf8',
                          textDecoration: 'none',
                        }}
                      >
                        {contact.phone}
                      </a>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--color-muted)', maxWidth: 260 }}>
                      {contact.description || '—'}
                    </td>
                    <td>
                      <button
                        onClick={() => handleToggleActive(contact)}
                        className={`badge ${contact.is_active !== false ? 'badge-success' : 'badge-secondary'}`}
                        style={{ cursor: 'pointer', border: 'none' }}
                        title="Click to toggle active state"
                      >
                        {contact.is_active !== false ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                        <button
                          onClick={() => handleOpenEdit(contact)}
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Edit contact"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleOpenDelete(contact)}
                          className="btn btn-ghost btn-sm btn-icon text-danger"
                          title="Delete contact"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Add / Edit Modal ───────────────────────────────────────── */}
      {isModalOpen && currentContact && (
        <AdminModal
          onClose={() => setIsModalOpen(false)}
          title={contacts.some((c) => c.id === currentContact.id) ? 'Edit Emergency Contact' : 'Add Emergency Contact'}
        >
          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {formError && (
              <div className="alert alert-danger" style={{ fontSize: '0.85rem', padding: '0.6rem 0.8rem' }}>
                {formError}
              </div>
            )}

            <div className="form-group">
              <label>Contact Title *</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Medical Center & Ambulance, Campus Police"
                value={currentContact.title || ''}
                onChange={(e) => setCurrentContact({ ...currentContact, title: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label>Phone / Hotline Number *</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. 1990, 119, +94 11 265 0301"
                value={currentContact.phone || ''}
                onChange={(e) => setCurrentContact({ ...currentContact, phone: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label>Department / Category</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Health & Safety, Security, Fire Services"
                value={currentContact.department || ''}
                onChange={(e) => setCurrentContact({ ...currentContact, department: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Icon Style</label>
              <select
                className="form-control"
                value={currentContact.icon || 'phone'}
                onChange={(e) => setCurrentContact({ ...currentContact, icon: e.target.value as any })}
              >
                <option value="ambulance">Ambulance / Medical Care</option>
                <option value="police">Police / Security</option>
                <option value="fire">Fire &amp; Rescue</option>
                <option value="phone">General Telephone Hotline</option>
                <option value="shield">General Safety / Shield</option>
              </select>
            </div>

            <div className="form-group">
              <label>Description / Location Notes</label>
              <textarea
                className="form-control"
                rows={2}
                placeholder="e.g. Available 24/7 on campus grounds, Booth A01"
                value={currentContact.description || ''}
                onChange={(e) => setCurrentContact({ ...currentContact, description: e.target.value })}
              />
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <input
                type="checkbox"
                id="contact-active"
                checked={currentContact.is_active !== false}
                onChange={(e) => setCurrentContact({ ...currentContact, is_active: e.target.checked })}
              />
              <label htmlFor="contact-active" style={{ cursor: 'pointer', margin: 0, fontWeight: 500 }}>
                Active (visible to visitors)
              </label>
            </div>

            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Saving...' : 'Save Contact'}
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* ── Delete Confirmation Modal ──────────────────────────────── */}
      {isDeleteModalOpen && currentContact && (
        <AdminModal
          onClose={() => setIsDeleteModalOpen(false)}
          title="Delete Emergency Contact"
        >
          <div style={{ padding: '0.5rem 0' }}>
            <p style={{ margin: '0 0 1rem 0' }}>
              Are you sure you want to delete <strong>{currentContact.title}</strong> ({currentContact.phone})?
            </p>
            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteConfirm}
                disabled={submitting}
              >
                {submitting ? 'Deleting...' : 'Delete Contact'}
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </main>
  );
}
