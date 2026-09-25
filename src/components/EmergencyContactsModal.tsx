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
import mainDarkBg from '../pics/main dark.png';

interface EmergencyContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const getInitialContacts = (): EmergencyContact[] => {
  try {
    const cached = localStorage.getItem('exnav_emergency_contacts');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((c: EmergencyContact) => c.is_active !== false);
      }
    }
  } catch {
    // fallback
  }
  return DEFAULT_EMERGENCY_CONTACTS.filter((c) => c.is_active !== false);
};

export function EmergencyContactsModal({ isOpen, onClose }: EmergencyContactsModalProps) {
  const [contacts, setContacts] = useState<EmergencyContact[]>(getInitialContacts);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;

    // Fetch fresh contacts from Supabase in the background without clearing the UI or blinking
    fetchEmergencyContacts().then((data) => {
      if (mounted && Array.isArray(data)) {
        const activeContacts = data.filter((c) => c.is_active !== false);
        setContacts((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(activeContacts)) {
            return prev;
          }
          return activeContacts;
        });
        setLoading(false);
      }
    }).catch((err) => {
      console.warn('fetchEmergencyContacts error:', err);
      if (mounted) setLoading(false);
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
        return <ShieldAlert size={18} className="text-rose-400" />;
      case 'fire':
        return <Flame size={18} className="text-amber-400" />;
      case 'police':
        return <Shield size={18} className="text-sky-400" />;
      default:
        return <PhoneCall size={18} className="text-emerald-400" />;
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
        backgroundColor: 'rgba(5, 8, 16, 0.65)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.75rem',
        animation: 'emergencyFadeIn 0.18s ease-out',
      }}
    >
      <div
        className="glass"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '490px',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '1.2rem',
          backgroundColor: '#070a14',
          position: 'relative',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)',
          overflow: 'hidden',
          animation: 'emergencySlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Blurred Background Image: main dark.png */}
        <div
          style={{
            position: 'absolute',
            inset: -20,
            backgroundImage: `url(${mainDarkBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'right top',
            backgroundRepeat: 'no-repeat',
            filter: 'blur(9px)',
            transform: 'scale(1.06)',
            pointerEvents: 'none',
            zIndex: 0,
            opacity: 0.9,
          }}
        />

        {/* Dark Mask layer over blurred image for maximum readability */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(8, 12, 22, 0.42) 0%, rgba(6, 9, 18, 0.68) 100%)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        {/* Content Wrapper */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
          {/* Header */}
          <div
            style={{
              padding: '0.9rem 1.15rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.03)',
            }}
          >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '10px',
                background: 'rgba(244, 63, 94, 0.09)',
                border: '1px solid rgba(244, 63, 94, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PhoneCall size={18} color="#f87171" />
            </div>
            <div>
              <h2
                id="emergency-modal-title"
                style={{
                  fontSize: '1.02rem',
                  fontWeight: 800,
                  color: '#fff',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                }}
              >
                Emergency Contacts
                <span
                  style={{
                    fontSize: '0.62rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '0.12rem 0.4rem',
                    borderRadius: '999px',
                    background: 'rgba(244, 63, 94, 0.12)',
                    color: '#f87171',
                    border: '1px solid rgba(244, 63, 94, 0.25)',
                    fontWeight: 700,
                  }}
                >
                  Hotlines
                </span>
              </h2>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                Tap any number below to dial immediately
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-icon"
            title="Close dialog"
            style={{ borderRadius: '50%', width: 30, height: 30, padding: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content list */}
        <div
          style={{
            padding: '0.75rem 0.95rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.55rem',
          }}
        >
          {loading ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.85rem' }}>
              Loading emergency hotlines...
            </div>
          ) : contacts.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.85rem' }}>
              No emergency contacts configured yet.
            </div>
          ) : (
            contacts.map((contact, index) => (
              <div
                key={contact.id}
                className="emergency-contact-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '11px',
                  background: 'rgba(12, 17, 32, 0.65)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.09)',
                  gap: '0.7rem',
                  animation: 'emergencyCardSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
                  animationDelay: `${index * 0.055}s`,
                  willChange: 'transform, opacity',
                  transition: 'background 0.2s ease, border-color 0.2s ease, transform 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(18, 25, 46, 0.78)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)';
                  e.currentTarget.style.transform = 'translateX(4px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(12, 17, 32, 0.65)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.09)';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: '8px',
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
                    {/* Title & department pill with wrap so title doesn't truncate */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.87rem',
                          color: '#f8fafc',
                          lineHeight: 1.25,
                        }}
                      >
                        {contact.title}
                      </span>
                      {contact.department && (
                        <span
                          style={{
                            fontSize: '0.62rem',
                            padding: '0.08rem 0.35rem',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.07)',
                            color: 'var(--color-muted)',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          {contact.department}
                        </span>
                      )}
                    </div>

                    {/* Phone number and subtitle row */}
                    <div style={{ marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: '0.88rem',
                          fontWeight: 800,
                          letterSpacing: '0.03em',
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
                          padding: '0.1rem 0.2rem',
                          cursor: 'pointer',
                          color: copiedId === contact.id ? '#10b981' : 'var(--color-muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                          fontSize: '0.68rem',
                        }}
                      >
                        {copiedId === contact.id ? <Check size={11} /> : <Copy size={11} />}
                        {copiedId === contact.id && 'Copied'}
                      </button>

                      {contact.description && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--color-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '170px',
                            opacity: 0.75,
                          }}
                        >
                          · {contact.description}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Somewhat transparent Call action button */}
                <a
                  href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    padding: '0.38rem 0.75rem',
                    borderRadius: '8px',
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    color: '#34d399',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(16, 185, 129, 0.24)';
                    e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.55)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(16, 185, 129, 0.14)';
                    e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <Phone size={12} />
                  Call
                </a>
              </div>
            ))
          )}
        </div>

          {/* Footer info note */}
          <div
            style={{
              padding: '0.6rem 1.15rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.07)',
              background: 'rgba(0, 0, 0, 0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.72rem',
              color: 'var(--color-muted)',
            }}
          >
            <span>Available 24/7 on campus &amp; premises</span>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.76rem', padding: '0.2rem 0.65rem', borderRadius: '6px' }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
