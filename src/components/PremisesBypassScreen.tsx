import React from 'react';
import { MapPin, ExternalLink, ShieldAlert, Compass } from 'lucide-react';
import defaultInvexLogo from '../pics/logo.png';
import defaultPartnerLogo from '../pics/partner.png';
import defaultPartner2Logo from '../pics/partner2.png';

interface PremisesBypassScreenProps {
  onBypass: () => void;
  allowBypass?: boolean;
  isAdmin?: boolean;
  onMockMode?: () => void;
  googleMapsUrl?: string;
  premisesLat?: number;
  premisesLng?: number;
  distanceKm?: number | null;
}

export const PremisesBypassScreen: React.FC<PremisesBypassScreenProps> = ({
  onBypass,
  allowBypass = true,
  isAdmin = false,
  onMockMode,
  googleMapsUrl,
  premisesLat = 6.535472,
  premisesLng = 80.401000,
  distanceKm = null,
}) => {
  // Construct navigation URL if none specified
  const targetMapUrl =
    googleMapsUrl && googleMapsUrl.trim().length > 0
      ? googleMapsUrl.trim()
      : `https://www.google.com/maps/dir/?api=1&destination=${premisesLat},${premisesLng}`;

  return (
    <div
      className="animate-fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        backgroundColor: '#070b14',
        backgroundImage: `
          radial-gradient(ellipse 90% 60% at 50% -10%, rgba(99, 102, 241, 0.28), transparent 70%),
          radial-gradient(ellipse 70% 50% at 50% 110%, rgba(168, 85, 247, 0.22), transparent 70%),
          radial-gradient(circle at 20% 40%, rgba(34, 211, 238, 0.12), transparent 50%),
          radial-gradient(circle at 80% 60%, rgba(99, 102, 241, 0.12), transparent 50%)
        `,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1.75rem 1.25rem 1.5rem',
        overflowY: 'auto',
        boxSizing: 'border-box',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      {/* ── Top Header: INVEX Logo ─────────────────────────── */}
      <header
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.4rem',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Subtle glow behind logo */}
          <div
            style={{
              position: 'absolute',
              width: '120px',
              height: '50px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(99, 102, 241, 0.6) 0%, transparent 70%)',
              filter: 'blur(16px)',
              pointerEvents: 'none',
            }}
          />
          <img
            src={defaultInvexLogo}
            alt="INVEX 2026"
            style={{
              height: '56px',
              width: 'auto',
              maxWidth: '220px',
              objectFit: 'contain',
              position: 'relative',
              filter: 'drop-shadow(0 4px 16px rgba(99, 102, 241, 0.4))',
            }}
          />
        </div>
      </header>

      {/* ── Center Content: Notice & Actions ──────────────── */}
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: '540px',
          width: '100%',
          margin: 'auto 0',
          padding: '1.25rem 0',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Pulsing Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.35rem 0.9rem',
            borderRadius: '999px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: '#f87171',
            fontSize: '0.78rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '1rem',
            boxShadow: '0 0 16px rgba(239, 68, 68, 0.2)',
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: '#ef4444',
              boxShadow: '0 0 8px #ef4444',
              animation: 'pulse 2s infinite',
            }}
          />
          <span>Exhibition Boundary Notice</span>
        </div>

        {/* Main Heading */}
        <h1
          style={{
            fontSize: 'clamp(1.25rem, 4vw, 1.85rem)',
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.25,
            letterSpacing: '-0.02em',
            margin: '0 0 0.85rem',
            textShadow: '0 2px 14px rgba(0, 0, 0, 0.6)',
          }}
        >
          You're not in the exhibition premises, please reach to it.
        </h1>

        {/* Informative Subtitle explaining user limit */}
        <p
          style={{
            fontSize: '0.92rem',
            lineHeight: 1.65,
            color: 'rgba(203, 213, 225, 0.9)',
            margin: '0 0 1.25rem',
            maxWidth: '460px',
          }}
        >
          Because of the high volume of users, live interactive map navigation is limited to visitors currently on-site. Please proceed to the exhibition center to start exploring booths and attractions.
        </p>

        {/* Distance Pill if available */}
        {distanceKm !== null && distanceKm > 0 && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.25rem 0.75rem',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '0.8rem',
              color: 'var(--color-muted)',
              marginBottom: '1.25rem',
            }}
          >
            <Compass size={14} color="var(--color-accent)" />
            <span>
              Estimated distance from venue:{' '}
              <strong style={{ color: '#fff' }}>
                {distanceKm >= 1 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm * 1000)} m`}
              </strong>
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.75rem',
            width: '100%',
            maxWidth: '340px',
          }}
        >
          {/* Primary Action: Google Maps Button */}
          <a
            href={targetMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            id="bypass-google-maps-btn"
            style={{
              width: '100%',
              padding: '0.85rem 1.4rem',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              color: '#ffffff',
              fontSize: '0.95rem',
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.55rem',
              textDecoration: 'none',
              boxShadow: '0 6px 25px rgba(99, 102, 241, 0.45)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              transition: 'all 0.2s ease',
              boxSizing: 'border-box',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 10px 30px rgba(99, 102, 241, 0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 6px 25px rgba(99, 102, 241, 0.45)';
            }}
          >
            <MapPin size={18} />
            <span>Open in Google Maps</span>
            <ExternalLink size={15} style={{ opacity: 0.8 }} />
          </a>

          {/* Bypass Button (Controlled by Admin Settings or Admin Role) */}
          {(allowBypass || isAdmin) && (
            <button
              type="button"
              onClick={onBypass}
              id="bypass-continue-map-btn"
              style={{
                width: '100%',
                padding: '0.7rem 1.25rem',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: 'var(--color-muted)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = '#ffffff';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.color = 'var(--color-muted)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
              }}
            >
              <span>Bypass &amp; View Map</span>
            </button>
          )}

          {/* Admin Testing Switch */}
          {isAdmin && onMockMode && (
            <button
              type="button"
              onClick={onMockMode}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-accent)',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                padding: '0.2rem',
                marginTop: '0.2rem',
                textDecoration: 'underline',
              }}
            >
              Admin: Switch to Mock Location
            </button>
          )}

          {/* Strict Notice when Bypass is Disabled by Admin */}
          {!allowBypass && !isAdmin && (
            <span
              style={{
                fontSize: '0.75rem',
                color: 'rgba(148, 163, 184, 0.8)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                marginTop: '0.25rem',
              }}
            >
              <ShieldAlert size={13} color="#f59e0b" />
              <span>Bypass is disabled during peak hours</span>
            </span>
          )}
        </div>
      </main>

      {/* ── Footer: Partner Logos (CipherX & PrintX) ───────── */}
      <footer
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.65rem',
          width: '100%',
          maxWidth: '480px',
          position: 'relative',
          zIndex: 2,
          borderTop: '1px solid rgba(255, 255, 255, 0.07)',
          paddingTop: '0.9rem',
        }}
      >
        <span
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'rgba(148, 163, 184, 0.65)',
          }}
        >
          Powered By
        </span>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.25rem',
            flexWrap: 'wrap',
          }}
        >
          {/* CipherX Logo Capsule */}
          <a
            href="https://cipherx.com.lk"
            target="_blank"
            rel="noopener noreferrer"
            title="CipherX - cipherx.com.lk"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.4rem 0.85rem',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(34, 211, 238, 0.25)',
              boxShadow: '0 0 16px rgba(34, 211, 238, 0.1)',
              transition: 'all 0.2s ease',
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.6)';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(34, 211, 238, 0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.25)';
              e.currentTarget.style.boxShadow = '0 0 16px rgba(34, 211, 238, 0.1)';
            }}
          >
            <img
              src={defaultPartnerLogo}
              alt="CipherX"
              style={{
                height: '24px',
                width: 'auto',
                objectFit: 'contain',
              }}
            />
          </a>

          {/* PrintX Logo Capsule */}
          <a
            href="https://printx.web.lk"
            target="_blank"
            rel="noopener noreferrer"
            title="PrintX - printx.web.lk"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.4rem 0.85rem',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(168, 85, 247, 0.25)',
              boxShadow: '0 0 16px rgba(168, 85, 247, 0.1)',
              transition: 'all 0.2s ease',
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.6)';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(168, 85, 247, 0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.25)';
              e.currentTarget.style.boxShadow = '0 0 16px rgba(168, 85, 247, 0.1)';
            }}
          >
            <img
              src={defaultPartner2Logo}
              alt="PrintX"
              style={{
                height: '24px',
                width: 'auto',
                objectFit: 'contain',
              }}
            />
          </a>
        </div>
      </footer>
    </div>
  );
};
