import { useEffect, useState } from 'react';
import { X, Radio, ExternalLink } from 'lucide-react';
import {
  fetchVideoLivesConfig,
  type VideoLivesConfig,
  DEFAULT_VIDEO_LIVES,
} from '../services/appSettingsService';
import mainDarkBg from '../pics/main dark.png';

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
        backgroundColor: 'rgba(5, 8, 16, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
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
          maxWidth: '440px',
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
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div
            style={{
              padding: '0.9rem 1.15rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.02)',
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
              <Radio size={18} color="#f87171" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <h2
                  id="video-lives-modal-title"
                  style={{ fontSize: '1.02rem', fontWeight: 800, color: '#fff', margin: 0 }}
                >
                  Video Lives
                </h2>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '0.12rem 0.4rem',
                    borderRadius: '999px',
                    background: 'rgba(244, 63, 94, 0.12)',
                    color: '#f87171',
                    border: '1px solid rgba(244, 63, 94, 0.25)',
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: '#ef4444',
                      display: 'inline-block',
                      animation: 'pulse 1.5s infinite',
                    }}
                  />
                  Live Stream
                </span>
              </div>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                Select a streaming platform to join live
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

        {/* Action Buttons Body */}
        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
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
              padding: '0.7rem 0.95rem',
              borderRadius: '12px',
              background: 'rgba(12, 17, 32, 0.65)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              color: '#ffffff',
              textDecoration: 'none',
              border: '1px solid rgba(239, 68, 68, 0.28)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
              transition: 'all 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.16)';
              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.45)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(12, 17, 32, 0.65)';
              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.28)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '9px',
                  background: 'rgba(239, 68, 68, 0.18)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {/* Stylized YouTube play logo */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
                  YouTube Live
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--color-muted)', marginTop: '0.1rem' }}>
                  Watch official stream in HD
                </div>
              </div>
            </div>
            <ExternalLink size={16} style={{ color: '#ef4444', opacity: 0.8 }} />
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
              padding: '0.7rem 0.95rem',
              borderRadius: '12px',
              background: 'rgba(12, 17, 32, 0.65)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              color: '#ffffff',
              textDecoration: 'none',
              border: '1px solid rgba(59, 130, 246, 0.28)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
              transition: 'all 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.16)';
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.45)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(12, 17, 32, 0.65)';
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.28)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '9px',
                  background: 'rgba(59, 130, 246, 0.18)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  color: '#3b82f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {/* Stylized Facebook logo */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
                  Facebook Live
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--color-muted)', marginTop: '0.1rem' }}>
                  Join discussion &amp; live chat
                </div>
              </div>
            </div>
            <ExternalLink size={16} style={{ color: '#3b82f6', opacity: 0.8 }} />
          </a>
        </div>

          {/* Footer */}
          <div
            style={{
              padding: '0.6rem 1.15rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              background: 'rgba(0, 0, 0, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.72rem',
              color: 'var(--color-muted)',
            }}
          >
            <span>Streams open in official external viewer</span>
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
