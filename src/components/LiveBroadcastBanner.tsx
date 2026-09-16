import { Radio, Volume2, VolumeX, X, Megaphone } from 'lucide-react';
import { useLiveBroadcast } from '../contexts/LiveBroadcastContext';

/**
 * LiveBroadcastBanner
 *
 * Full banner shown at the top-centre when a broadcast is active and not dismissed.
 * After the user dismisses it, a small floating pill icon (top-right) stays visible
 * so they can toggle mute/listen at any time — no page refresh needed.
 *
 * Audio state (playing/muted) is owned by LiveBroadcastContext and shared with
 * any other component that calls useLiveBroadcast() (e.g. the map mini-button).
 */
export function LiveBroadcastBanner() {
  const { activeBroadcast, isPlaying, isDismissed, handleListen, handleMute, handleDismiss, handleExpand } =
    useLiveBroadcast();

  // Nothing active — render nothing at all
  if (!activeBroadcast) return null;

  // ── Minimized pill shown after dismissal ────────────────────────────────
  if (isDismissed) {
    return (
      <button
        onClick={handleExpand}
        id="live-broadcast-mini-pill"
        title={isPlaying ? 'Live audio playing — click to expand' : 'Live broadcast available — click to expand'}
        style={{
          position: 'fixed',
          top: 'calc(10px + var(--safe-top, 0px))',
          right: '14px',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.35rem 0.7rem 0.35rem 0.5rem',
          borderRadius: '20px',
          background: isPlaying
            ? 'rgba(239, 68, 68, 0.18)'
            : 'rgba(11, 15, 26, 0.82)',
          border: `1px solid ${isPlaying ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.12)'}`,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          cursor: 'pointer',
          boxShadow: isPlaying
            ? '0 0 0 2px rgba(239,68,68,0.2), 0 4px 14px rgba(0,0,0,0.4)'
            : '0 4px 14px rgba(0,0,0,0.4)',
          transition: 'all 0.2s ease',
          color: isPlaying ? '#f87171' : 'var(--color-muted)',
        }}
      >
        {/* Pulsing live dot */}
        <span
          className={isPlaying ? 'live-dot-pulse' : undefined}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: isPlaying ? '#ef4444' : '#64748b',
            flexShrink: 0,
            display: 'inline-block',
          }}
        />
        <Radio size={13} />
        <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em' }}>
          {isPlaying ? 'LIVE' : 'LIVE'}
        </span>
        {isPlaying
          ? <Volume2 size={12} />
          : <VolumeX size={12} />
        }
      </button>
    );
  }

  // ── Full banner ──────────────────────────────────────────────────────────
  return (
    <div
      className="glass"
      style={{
        position: 'fixed',
        top: 'calc(12px + var(--safe-top, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 24px)',
        maxWidth: '520px',
        zIndex: 9999,
        padding: '0.75rem 1rem',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        border: '1px solid rgba(239, 68, 68, 0.25)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), inset 0 0 10px rgba(239, 68, 68, 0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
        {/* Pulsing broadcast icon */}
        <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <div
            className="live-dot-pulse"
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: '#ef4444',
            }}
          />
          <Megaphone size={14} color="#f87171" style={{ position: 'absolute', top: -14, left: -2 }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            Live Audio Guide
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {isPlaying ? 'Streaming live audio...' : 'Host is broadcasting announcement'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        {isPlaying ? (
          <button
            onClick={handleMute}
            className="btn btn-sm"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              padding: '0.25rem 0.6rem',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <VolumeX size={12} />
            Mute
          </button>
        ) : (
          <button
            onClick={handleListen}
            className="btn btn-sm btn-primary"
            style={{
              padding: '0.25rem 0.6rem',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Volume2 size={12} />
            Listen
          </button>
        )}

        {/* Dismiss — audio keeps playing; mini-pill appears */}
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-muted)',
            cursor: 'pointer',
            padding: '0.2rem',
            display: 'flex',
          }}
          title="Minimize (audio keeps playing if active)"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
