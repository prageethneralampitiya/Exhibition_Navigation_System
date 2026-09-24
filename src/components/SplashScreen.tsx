import React, { useEffect, useRef, useState, useCallback } from 'react';
import defaultInvexLogo from '../pics/logo.png';
import defaultPartnerLogo from '../pics/partner.png';
import defaultPartner2Logo from '../pics/partner2.png';
import './SplashScreen.css';

interface SplashScreenProps {
  /**
   * Auto-dismiss delay in seconds (default: 4.5s).
   * Set to 0 to disable auto-dismiss.
   */
  durationSeconds?: number;
  /**
   * Callback fired when the splash screen has completely dissolved.
   */
  onDismiss?: () => void;
  /**
   * Optional custom logo URLs
   */
  invexLogoUrl?: string;
  partner1Url?: string;
  partner2Url?: string;
}

interface MistParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetRadius: number;
  alpha: number;
  targetAlpha: number;
  hueVariation: number; // subtle tint variation
  swirlAngle: number;
  swirlSpeed: number;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  durationSeconds = 4.5,
  onDismiss,
  invexLogoUrl = defaultInvexLogo,
  partner1Url = defaultPartnerLogo,
  partner2Url = defaultPartner2Logo,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const hasDismissedRef = useRef(false);

  // Smooth dismiss handler with dissolve transition
  const handleDismiss = useCallback(() => {
    if (hasDismissedRef.current || isExiting) return;
    hasDismissedRef.current = true;
    setIsExiting(true);

    try {
      sessionStorage.setItem('invex_splash_shown', 'true');
    } catch {
      // ignore storage quota / sandbox restrictions
    }

    // Wait for the dissolve animation to complete before removing from DOM
    setTimeout(() => {
      setIsVisible(false);
      onDismiss?.();
    }, 850);
  }, [isExiting, onDismiss]);

  // Support replaying intro on demand
  useEffect(() => {
    const handleReplay = () => {
      hasDismissedRef.current = false;
      setIsExiting(false);
      setIsVisible(true);
    };
    window.addEventListener('invex:replay-splash', handleReplay);
    return () => window.removeEventListener('invex:replay-splash', handleReplay);
  }, []);

  // Keyboard navigation (Esc, Space, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDismiss]);

  // Auto-dismiss timer
  useEffect(() => {
    if (durationSeconds <= 0) return;

    const timer = setTimeout(() => {
      handleDismiss();
    }, durationSeconds * 1000);

    return () => clearTimeout(timer);
  }, [durationSeconds, handleDismiss]);

  // Canvas Mist / Cloud Particle Simulation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Initialize 42 organic mist billow particles
    const particleCount = 42;
    const particles: MistParticle[] = [];

    for (let i = 0; i < particleCount; i++) {
      // Inflow from both sides (left & right) towards the center
      const fromLeft = i % 2 === 0;
      const startX = fromLeft
        ? -width * 0.2 - Math.random() * width * 0.3
        : width * 1.2 + Math.random() * width * 0.3;
      const startY = Math.random() * height;

      // Inward velocity towards screen center
      const direction = fromLeft ? 1 : -1;

      particles.push({
        x: startX,
        y: startY,
        vx: direction * (1.8 + Math.random() * 2.8),
        vy: (Math.random() - 0.5) * 0.8,
        radius: 40 + Math.random() * 60,
        targetRadius: Math.min(width, height) * (0.28 + Math.random() * 0.35),
        alpha: 0,
        targetAlpha: 0.12 + Math.random() * 0.2,
        hueVariation: Math.random() > 0.6 ? 1 : Math.random() > 0.3 ? 2 : 0,
        swirlAngle: Math.random() * Math.PI * 2,
        swirlSpeed: (Math.random() - 0.5) * 0.008,
      });
    }

    startTimeRef.current = performance.now();

    const render = (now: number) => {
      const elapsed = (now - startTimeRef.current) / 1000;
      ctx.clearRect(0, 0, width, height);

      // Render each mist puff
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Ease radius and alpha in for the first 2.5 seconds
        if (p.radius < p.targetRadius) {
          p.radius += (p.targetRadius - p.radius) * 0.035;
        }

        if (p.alpha < p.targetAlpha) {
          p.alpha += (p.targetAlpha - p.alpha) * 0.04;
        }

        // Dissolving when exiting
        if (hasDismissedRef.current) {
          p.alpha *= 0.94;
          p.radius += 2.5;
        }

        // Billow motion with slight swirl turbulence
        p.swirlAngle += p.swirlSpeed;
        p.x += p.vx + Math.cos(p.swirlAngle + elapsed) * 0.6;
        p.y += p.vy + Math.sin(p.swirlAngle + elapsed) * 0.5;

        // Slow down inward rush after entering screen
        if (Math.abs(p.vx) > 0.45) {
          p.vx *= 0.985;
        }

        // Draw soft volumetric radial cloud gradient
        if (p.alpha > 0.005) {
          const grad = ctx.createRadialGradient(
            p.x,
            p.y,
            0,
            p.x,
            p.y,
            Math.max(1, p.radius)
          );

          let r = 210, g = 230, b = 250; // default soft cool mist white
          if (p.hueVariation === 1) {
            // ice cyan tint
            r = 165; g = 243; b = 252;
          } else if (p.hueVariation === 2) {
            // ethereal periwinkle/indigo tint
            r = 199; g = 210; b = 254;
          }

          grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${p.alpha * 0.85})`);
          grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${p.alpha * 0.45})`);
          grad.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, ${p.alpha * 0.15})`);
          grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1, p.radius), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className={`splash-overlay ${isExiting ? 'splash-exiting' : ''}`}
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome Splash Screen"
    >
      {/* Dynamic 2D Canvas Mist Billows */}
      <canvas ref={canvasRef} className="splash-canvas" />

      {/* Volumetric Layered Cloud Banks */}
      <div className="splash-mist-container" aria-hidden="true">
        <div className="splash-fog-bank fog-left" />
        <div className="splash-fog-bank fog-right" />
        <div className="splash-fog-bank fog-center" />
        <div className="splash-fog-bank fog-bottom" />
      </div>

      {/* Atmospheric Vignette */}
      <div className="splash-vignette" aria-hidden="true" />

      {/* Foreground Interactive Content */}
      <div className="splash-content" onClick={(e) => e.stopPropagation()}>
        {/* Above: INVEX Logo */}
        <header className="splash-header">
          <div className="splash-invex-logo-wrap">
            <div className="splash-invex-aura" aria-hidden="true" />
            <img
              src={invexLogoUrl}
              alt="INVEX 2026"
              className="splash-invex-logo"
            />
          </div>
        </header>

        {/* Center: Exhibition Navigator */}
        <main className="splash-center">
          <div className="splash-title-wrap">
            <h1 className="splash-main-title">Exhibition Navigator</h1>
          </div>

          <div className="splash-divider" aria-hidden="true" />

          <p className="splash-tagline">
            Navigate booths, explore exhibitors &amp; discover real-time attractions effortlessly
          </p>
        </main>

        {/* Footer: Partner Logos */}
        <footer className="splash-footer">
          <div className="splash-footer-label-wrap">
            <div className="splash-footer-line" />
            <span className="splash-footer-label">Powered By</span>
            <div className="splash-footer-line" />
          </div>

          <div className="splash-partners-row">
            {partner1Url && (
              <div
                className="splash-partner-capsule glow-cyan"
                title="Powered By"
              >
                <img
                  src={partner1Url}
                  alt="Powered By"
                  className="splash-partner-logo partner-1"
                />
              </div>
            )}
            {partner2Url && (
              <div
                className="splash-partner-capsule glow-purple"
                title="Powered By"
              >
                <img
                  src={partner2Url}
                  alt="Powered By"
                  className="splash-partner-logo partner-2"
                />
              </div>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default SplashScreen;
