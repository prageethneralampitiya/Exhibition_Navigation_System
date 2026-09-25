import { useEffect, useState } from 'react';
import { X, Radio, ExternalLink } from 'lucide-react';
import {
  fetchVideoLivesConfig,
  type VideoLivesConfig,
  DEFAULT_VIDEO_LIVES,
} from '../services/appSettingsService';

interface VideoLivesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VideoLivesModal({ isOpen, onClose }: VideoLivesModalProps) {
  const [config, setConfig] = useState<VideoLivesConfig>(DEFAULT_VIDEO_LIVES);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;

    fetchVideoLivesConfig().then((data) => {
      if (mounted) {
        setConfig(data);
      }
    });

    const handleUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === 'object') {
        setConfig(detail);
      }
    };
    window.addEventListener('video-lives-updated', handleUpdated);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      mounted = false;
      window.removeEventListener('video-lives-updated', handleUpdated);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const ytUrl = config.youtube_url?.trim() || 'https://www.youtube.com';
  const fbUrl = config.facebook_url?.trim() || 'https://www.facebook.com';

  return (
    <div
      className="video-lives-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-lives-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 8, 16, 0.8)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
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
          maxWidth: '480px',
          borderRadius: '1.4rem',
          background: 'linear-gradient(155deg, rgba(20, 26, 44, 0.96) 0%, rgba(11, 14, 25, 0.98) 100%)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 45px rgba(239, 68, 68, 0.15)',
          overflow: 'hidden',
          animation: 'emergencySlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.4rem 1.5rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.18) 0%, transparent 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 16px rgba(239, 68, 68, 0.35)',
              }}
            >
              <Radio size={22} color="#ef4444" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h2
                  id="video-lives-modal-title"
                  style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', margin: 0 }}
                >
                  Video Lives
                </h2>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '0.15rem 0.45rem',
                    borderRadius: '20px',
                    background: 'rgba(239, 68, 68, 0.25)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#ef4444',
                      display: 'inline-block',
                      animation: 'pulse 1.5s infinite',
                    }}
                  />
                  Live Stream
                </span>
              </div>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
                Select a streaming platform to join live
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

        {/* Action Buttons Body */}
        <div style={{ padding: '1.6rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* YouTube Live Button */}
          <a
            href={ytUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            id="btn-youtube-live"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1.15rem 1.35rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #e11d48 0%, #b91c1c 60%, #991b1b 100%)',
              color: '#ffffff',
              textDecoration: 'none',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              boxShadow: '0 8px 24px rgba(225, 29, 72, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.35)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(225, 29, 72, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.45)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0) scale(1)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(225, 29, 72, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.35)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {/* Stylized YouTube play logo */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.01em' }}>
                  YouTube Live
                </div>
                <div style={{ fontSize: '0.8rem', opacity: 0.88, marginTop: '0.15rem' }}>
                  Watch official stream in HD
                </div>
              </div>
            </div>
            <ExternalLink size={18} style={{ opacity: 0.9 }} />
          </a>

          {/* Facebook Live Button */}
          <a
            href={fbUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            id="btn-facebook-live"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1.15rem 1.35rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #1877F2 0%, #0c63d4 60%, #0a4fa8 100%)',
              color: '#ffffff',
              textDecoration: 'none',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              boxShadow: '0 8px 24px rgba(24, 119, 242, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.35)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(24, 119, 242, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.45)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0) scale(1)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(24, 119, 242, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.35)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {/* Stylized Facebook logo */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.01em' }}>
                  Facebook Live
                </div>
                <div style={{ fontSize: '0.8rem', opacity: 0.88, marginTop: '0.15rem' }}>
                  Join discussion &amp; live chat
                </div>
              </div>
            </div>
            <ExternalLink size={18} style={{ opacity: 0.9 }} />
          </a>
        </div>

        {/* Footer */}
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
          <span>Streams open in official external viewer</span>
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
