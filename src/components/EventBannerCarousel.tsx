import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Calendar,
  MapPin,
  Ticket,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Navigation,
} from 'lucide-react';
import type { Exhibition } from '../lib/supabase';
import { parseEventDescription } from '../utils/events';

interface EventBannerCarouselProps {
  events: Exhibition[];
  loading?: boolean;
}

function formatDates(startStr: string | null, endStr: string | null): string {
  if (!startStr && !endStr) return 'Dates Announced Soon';
  if (startStr && !endStr) {
    try {
      return new Date(startStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return startStr;
    }
  }
  if (startStr && endStr) {
    if (startStr === endStr) {
      try {
        return new Date(startStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch {
        return startStr;
      }
    }
    try {
      const s = new Date(startStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const e = new Date(endStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${s} – ${e}`;
    } catch {
      return `${startStr} to ${endStr}`;
    }
  }
  return endStr || '';
}

export function EventBannerCarousel({ events, loading }: EventBannerCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const slideCount = events.length > 0 ? events.length : 1;

  // Auto-advance slider every 6s unless hovered
  useEffect(() => {
    if (slideCount <= 1 || isHovered) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % slideCount);
    }, 6000);
    return () => clearInterval(timer);
  }, [slideCount, isHovered]);

  const handlePrev = () => {
    setActiveIndex((prev) => (prev - 1 + slideCount) % slideCount);
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % slideCount);
  };

  if (loading) {
    return (
      <div className="events-banner-section scroll-reveal" id="events-banner-section">
        <div className="event-banner-skeleton glass skeleton" />
      </div>
    );
  }

  // Fallback demo event when no events have been created yet in the database
  const displayEvents: Partial<Exhibition>[] = events.length > 0 ? events : [
    {
      id: 'welcome-event',
      title: 'Kalawana National School Exhibition 2026',
      description: 'Welcome to the premier educational, innovation & technology festival with 80+ campus stalls, interactive science labs, and community projects. <!--EVENT_META:{"price":"Free Entry","offers":"Complimentary Campus Map & Stalls Access"}-->',
      location: 'Main School Grounds & Auditorium, Kalawana',
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
      image_url: '',
      is_featured: true,
      latitude: 6.535472,
      longitude: 80.401000,
    } as Partial<Exhibition>,
  ];

  const currentEvent = displayEvents[activeIndex % displayEvents.length] || displayEvents[0];
  const meta = parseEventDescription(currentEvent.description);
  const datesLabel = formatDates(currentEvent.start_date || null, currentEvent.end_date || null);
  const venue = currentEvent.location || 'Campus Main Ground';

  return (
    <section
      className="events-banner-section scroll-reveal"
      id="events-banner-section"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      aria-label="Campus Events and Highlights"
    >
      <div className="event-banner-container glass">
        {/* Full-bleed background image or decorative gradient */}
        <div className="event-banner-bg-wrap">
          {currentEvent.image_url ? (
            <img
              src={currentEvent.image_url}
              alt={currentEvent.title}
              className="event-banner-img"
              loading="lazy"
            />
          ) : (
            <div className="event-banner-fallback-gradient" />
          )}
          {/* Cinematic Vignette Overlays for Maximum Legibility */}
          <div className="event-banner-overlay" />
          <div className="event-banner-glow-accent" />
        </div>

        {/* Content layer inside banner */}
        <div className="event-banner-content">
          {/* Top Badges: Event Tag, Special Offers, Price */}
          <div className="event-banner-badges">
            <span className="event-badge-tag">
              <CalendarDays size={13} />
              <span>EVENT</span>
            </span>

            {meta.offers && (
              <span className="event-badge-offer" title="Promotional Offer">
                <Sparkles size={13} />
                <span>{meta.offers}</span>
              </span>
            )}

            {meta.price && (
              <span className="event-badge-price" title="Ticket / Entrance Price">
                <Ticket size={13} />
                <span>{meta.price}</span>
              </span>
            )}

            {currentEvent.is_featured && (
              <span className="event-badge-featured">
                ★ Featured
              </span>
            )}
          </div>

          {/* Event Title */}
          <h2 className="event-banner-title">{currentEvent.title}</h2>

          {/* Description */}
          {meta.description && (
            <p className="event-banner-desc">{meta.description}</p>
          )}

          {/* Meta Details: Venue & Dates */}
          <div className="event-banner-meta-row">
            <div className="event-banner-meta-item event-meta-venue">
              <MapPin size={15} className="event-meta-icon" />
              <span>{venue}</span>
            </div>
            <div className="event-banner-meta-item event-meta-date">
              <Calendar size={15} className="event-meta-icon" />
              <span>{datesLabel}</span>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="event-banner-actions">
            {currentEvent.id && currentEvent.id !== 'welcome-event' ? (
              <Link
                to={`/exhibitions/${currentEvent.id}`}
                className="btn btn-primary event-banner-cta"
                id={`event-cta-${currentEvent.id}`}
              >
                <span>View Event Details</span>
                <ArrowRight size={15} />
              </Link>
            ) : (
              <Link to="/stores" className="btn btn-primary event-banner-cta" id="event-cta-stores">
                <span>Browse Campus Stalls</span>
                <ArrowRight size={15} />
              </Link>
            )}

            {currentEvent.latitude && currentEvent.longitude && (
              <Link
                to={`/map?lat=${currentEvent.latitude}&lng=${currentEvent.longitude}`}
                className="btn btn-ghost event-banner-map-btn"
                title="Locate venue on interactive map"
              >
                <Navigation size={15} />
                <span>Locate Venue</span>
              </Link>
            )}
          </div>
        </div>

        {/* Carousel Navigation Arrows if multiple events */}
        {slideCount > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrev}
              className="event-banner-arrow event-banner-arrow-left"
              aria-label="Previous event slide"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="event-banner-arrow event-banner-arrow-right"
              aria-label="Next event slide"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}

        {/* Carousel Dot Indicators if multiple events */}
        {slideCount > 1 && (
          <div className="event-banner-dots">
            {displayEvents.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`event-banner-dot ${idx === activeIndex ? 'active' : ''}`}
                aria-label={`Jump to event slide ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
