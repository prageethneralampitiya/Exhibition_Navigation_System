import { useEffect, useState } from 'react';
import {
  X,
  Phone,
  PhoneCall,
  ShieldAlert,
  Flame,
  Shield,
  Copy,
  Check,
} from 'lucide-react';
import {
  fetchEmergencyContacts,
  type EmergencyContact,
  DEFAULT_EMERGENCY_CONTACTS,
} from '../services/appSettingsService';

interface EmergencyContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EmergencyContactsModal({ isOpen, onClose }: EmergencyContactsModalProps) {
  const [contacts, setContacts] = useState<EmergencyContact[]>(DEFAULT_EMERGENCY_CONTACTS);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoading(true);

    fetchEmergencyContacts().then((data) => {
      if (mounted) {
        setContacts(data.filter((c) => c.is_active !== false));
        setLoading(false);
      }
    });

    const handleUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (Array.isArray(detail)) {
        setContacts(detail.filter((c) => c.is_active !== false));
      }
    };
    window.addEventListener('emergency-contacts-updated', handleUpdated);

    // ESC to close
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      mounted = false;
      window.removeEventListener('emergency-contacts-updated', handleUpdated);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = (id: string, phone: string) => {
    navigator.clipboard?.writeText(phone);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getContactIcon = (icon?: string) => {
    switch (icon) {
      case 'ambulance':
        return <ShieldAlert size={22} className="text-rose-400" />;
      case 'fire':
        return <Flame size={22} className="text-amber-400" />;
      case 'police':
        return <Shield size={22} className="text-blue-400" />;
      default:
        return <PhoneCall size={22} className="text-emerald-400" />;
    }
  };

  return (
    <div
      className="emergency-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 8, 16, 0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        animation: 'emergencyFadeIn 0.2s ease-out',
      }}
    >
      <div
        className="glass"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '540px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '1.25rem',
          background: 'linear-gradient(155deg, rgba(22, 28, 48, 0.94) 0%, rgba(13, 16, 28, 0.98) 100%)',
          border: '1px solid rgba(244, 63, 94, 0.35)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7), 0 0 40px rgba(244, 63, 94, 0.15)',
          overflow: 'hidden',
          animation: 'emergencySlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(90deg, rgba(244, 63, 94, 0.15) 0%, transparent 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '12px',
                background: 'rgba(244, 63, 94, 0.2)',
                border: '1px solid rgba(244, 63, 94, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 15px rgba(244, 63, 94, 0.3)',
              }}
            >
              <PhoneCall size={22} color="#f43f5e" />
            </div>
            <div>
              <h2
                id="emergency-modal-title"
                style={{
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  color: '#fff',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                Emergency Contacts
                <span
                  style={{
                    fontSize: '0.68rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '0.15rem 0.45rem',
                    borderRadius: '20px',
                    background: 'rgba(244, 63, 94, 0.25)',
                    color: '#fda4af',
                    border: '1px solid rgba(244, 63, 94, 0.4)',
                    fontWeight: 700,
                  }}
                >
                  Hotlines
                </span>
              </h2>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
                Tap any number below to dial immediately
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-icon"
            title="Close dialog"
            style={{ borderRadius: '50%', width: 34, height: 34 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content list */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}
        >
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)' }}>
              Loading emergency hotlines...
            </div>
          ) : contacts.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)' }}>
              No emergency contacts configured yet.
            </div>
          ) : (
            contacts.map((contact) => (
              <div
                key={contact.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1rem 1.1rem',
                  borderRadius: '1rem',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                  gap: '1rem',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: '10px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {getContactIcon(contact.icon)}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>
                        {contact.title}
                      </span>
                      {contact.department && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '6px',
                            background: 'rgba(255, 255, 255, 0.07)',
                            color: 'var(--color-muted)',
                          }}
                        >
                          {contact.department}
                        </span>
                      )}
                    </div>

                    {contact.description && (
                      <p
                        style={{
                          margin: '0.15rem 0 0 0',
                          fontSize: '0.78rem',
                          color: 'var(--color-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {contact.description}
                      </p>
                    )}

                    <div style={{ marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          fontSize: '1rem',
                          fontWeight: 800,
                          letterSpacing: '0.04em',
                          color: '#38bdf8',
                          fontFamily: 'monospace',
                        }}
                      >
                        {contact.phone}
                      </span>
                      <button
                        onClick={() => handleCopy(contact.id, contact.phone)}
                        title="Copy phone number"
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '0.2rem',
                          cursor: 'pointer',
                          color: copiedId === contact.id ? '#10b981' : 'var(--color-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                          fontSize: '0.72rem',
                        }}
                      >
                        {copiedId === contact.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedId === contact.id && 'Copied'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Call action button */}
                <a
                  href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.65rem 1.15rem',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.86rem',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
                    flexShrink: 0,
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                >
                  <Phone size={14} />
                  Call
                </a>
              </div>
            ))
          )}
        </div>

        {/* Footer info note */}
        <div
          style={{
            padding: '0.85rem 1.5rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.75rem',
            color: 'var(--color-muted)',
          }}
        >
          <span>Available 24/7 on campus &amp; exhibition premises</span>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
