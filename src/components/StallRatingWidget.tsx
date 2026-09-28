import { useState } from 'react';
import { Star, CheckCircle2, RefreshCw } from 'lucide-react';
import { useStallRating } from '../services/stallRatingService';

interface StallRatingWidgetProps {
  stallId: string;
  stallName: string;
  variant?: 'full' | 'compact' | 'badge';
  className?: string;
}

export function StallRatingWidget({
  stallId,
  stallName,
  variant = 'full',
  className = '',
}: StallRatingWidgetProps) {
  const { userRating, averageRating, totalVotes, submitRating, isSubmitting } =
    useStallRating(stallId, stallName);

  const [hoveredStars, setHoveredStars] = useState<number | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const handleRate = async (stars: number) => {
    if (isSubmitting) return;
    await submitRating(stars);
    setJustSubmitted(true);
    setIsEditing(false);
    setTimeout(() => {
      setJustSubmitted(false);
    }, 4000);
  };

  // Badge only (e.g. for small cards or lists)
  if (variant === 'badge') {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}
        style={{
          background: 'rgba(245, 158, 11, 0.12)',
          color: '#f59e0b',
          border: '1px solid rgba(245, 158, 11, 0.28)',
        }}
        title={`Average rating: ${averageRating} out of 5 (${totalVotes} visitor reviews)`}
      >
        <Star size={11} fill="#f59e0b" color="#f59e0b" style={{ flexShrink: 0 }} />
        <span>{averageRating.toFixed(1)}</span>
        <span style={{ opacity: 0.65, fontSize: '0.65rem' }}>({totalVotes})</span>
      </div>
    );
  }

  // Compact inline row
  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center gap-1.5 ${className}`}
        style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}
      >
        <div className="flex items-center" style={{ color: '#f59e0b' }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              size={14}
              fill={star <= Math.round(averageRating) ? '#f59e0b' : 'none'}
              color="#f59e0b"
            />
          ))}
        </div>
        <span style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>
          {averageRating.toFixed(1)}
        </span>
        <span style={{ opacity: 0.6 }}>({totalVotes})</span>
      </div>
    );
  }

  // Full interactive widget for Stall Detail Page

  return (
    <div
      className={`stall-rating-card glass ${className}`}
      style={{
        padding: '1.25rem',
        borderRadius: '16px',
        marginBottom: '1.5rem',
        border: '1px solid rgba(245, 158, 11, 0.25)',
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, rgba(15, 23, 42, 0.6) 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative subtle ambient amber glow */}
      <div
        style={{
          position: 'absolute',
          top: -24,
          right: -24,
          width: 90,
          height: 90,
          background: 'radial-gradient(circle, rgba(245, 158, 11, 0.2) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
              Visitor Rating
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#f59e0b',
                padding: '0.15rem 0.5rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                border: '1px solid rgba(245, 158, 11, 0.3)',
              }}
            >
              <Star size={11} fill="#f59e0b" color="#f59e0b" />
              {averageRating.toFixed(1)} / 5.0
            </span>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.2rem 0 0 0' }}>
            Based on {totalVotes} visitor review{totalVotes === 1 ? '' : 's'} across the exhibition
          </p>
        </div>

        {/* User status badge */}
        {userRating && !isEditing && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.72rem',
              color: '#10b981',
              background: 'rgba(16, 185, 129, 0.12)',
              padding: '0.25rem 0.6rem',
              borderRadius: '8px',
              border: '1px solid rgba(16, 185, 129, 0.25)',
            }}
          >
            <CheckCircle2 size={13} />
            <span>You rated: {userRating} ★</span>
          </div>
        )}
      </div>

      {/* Interactive 5-Star Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem',
          borderRadius: '12px',
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-main)', marginRight: '0.25rem' }}>
          {userRating && !isEditing ? 'Your vote:' : 'Rate stall:'}
        </span>

        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          onMouseLeave={() => setHoveredStars(null)}
        >
          {[1, 2, 3, 4, 5].map((star) => {
            const isFilled =
              hoveredStars !== null
                ? star <= hoveredStars
                : userRating
                ? star <= userRating
                : star <= Math.round(averageRating);

            const isInteractive = !userRating || isEditing;

            return (
              <button
                key={star}
                type="button"
                disabled={!isInteractive || isSubmitting}
                onClick={() => handleRate(star)}
                onMouseEnter={() => isInteractive && setHoveredStars(star)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0.2rem',
                  cursor: isInteractive ? 'pointer' : 'default',
                  transition: 'transform 0.15s ease, filter 0.15s ease',
                  transform: hoveredStars === star ? 'scale(1.25)' : 'scale(1)',
                  filter: isFilled ? 'drop-shadow(0 0 4px rgba(245, 158, 11, 0.6))' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={isInteractive ? `Give ${star} out of 5 stars` : `Rated ${userRating} stars`}
                aria-label={`Rate ${star} stars`}
              >
                <Star
                  size={24}
                  fill={isFilled ? '#f59e0b' : 'none'}
                  color={isFilled ? '#f59e0b' : 'rgba(255, 255, 255, 0.25)'}
                  strokeWidth={2}
                />
              </button>
            );
          })}
        </div>

        {/* Right action / feedback */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {justSubmitted && (
            <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700, animation: 'fadeIn 0.3s ease' }}>
              ✓ Saved!
            </span>
          )}

          {userRating && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: 'var(--color-muted)',
                fontSize: '0.7rem',
                padding: '0.2rem 0.5rem',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
              title="Change your vote"
            >
              <RefreshCw size={10} />
              Change
            </button>
          )}

          {isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-muted)',
                fontSize: '0.7rem',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.68rem', color: 'rgba(255, 255, 255, 0.4)' }}>
          🔒 1 vote per visitor (Saved in device cache to prevent duplicate votes)
        </span>
        {userRating && (
          <span style={{ fontSize: '0.68rem', color: '#10b981' }}>
            ✓ Verified visitor response
          </span>
        )}
      </div>
    </div>
  );
}
