import { useEffect, useLayoutEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { logAnalyticsEvent } from '../lib/analytics';
import {
  ArrowLeft,
  MapPin,
  Clock,
  Phone,
  Mail,
  Globe,
  Tag,
  Store,
  ChevronLeft,
  ChevronRight,
  Gift,
  Navigation,
} from 'lucide-react';
import { supabase, type Store as StoreType, type StoreImage, type Promotion } from '../lib/supabase';

export function StoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [store, setStore] = useState<StoreType | null>(null);
  const [images, setImages] = useState<StoreImage[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [id]);

  useEffect(() => {
    if (id) {
      loadStoreDetails(id);
    }
  }, [id]);

  // Auto slideshow effect: advances the gallery image every 4 seconds.
  // The timer resets whenever the image index changes (manually or automatically).
  useEffect(() => {
    if (images.length <= 1) return;

    const timer = setTimeout(() => {
      setCurrentImageIndex((prev) => (prev + 1) % images.length);
    }, 4000);

    return () => clearTimeout(timer);
  }, [currentImageIndex, images.length]);

  async function loadStoreDetails(storeId: string) {
    try {
      setLoading(true);

      // Fetch store
      const { data: storeData, error: storeError } = await supabase
        .from('stores')
        .select(`
          *,
          categories:category_id (id, name, color),
          exhibitions:exhibition_id (id, title)
        `)
        .eq('id', storeId)
        .single();

      if (storeError) throw storeError;
      setStore(storeData);
      if (storeData) {
        logAnalyticsEvent('store_view', storeData.id, storeData.name);
      }

      // Fetch images & promotions in parallel
      const [imagesRes, promosRes] = await Promise.all([
        supabase
          .from('store_images')
          .select('*')
          .eq('store_id', storeId),
        supabase
          .from('promotions')
          .select('*')
          .eq('store_id', storeId)
          .eq('is_active', true),
      ]);

      setImages(imagesRes.data || []);
      setPromotions(promosRes.data || []);
    } catch (err) {
      console.error('Error fetching store details:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleNextImage = () => {
    if (images.length > 0) {
      setCurrentImageIndex((prev) => (prev + 1) % images.length);
    }
  };

  const handlePrevImage = () => {
    if (images.length > 0) {
      setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  if (!store) {
    return (
      <div className="profile-page" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Store Not Found</h1>
        <p style={{ color: 'var(--color-muted)', margin: '1rem 0' }}>
          The requested store profile does not exist or has been disabled.
        </p>
        <Link to="/stores" className="btn btn-primary">
          Back to Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="profile-page" style={{ maxWidth: 700 }}>
      {/* Back button */}
      <Link
        to="/stores"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          color: 'var(--color-muted)',
          textDecoration: 'none',
          fontSize: '0.875rem',
          marginBottom: '1.5rem',
        }}
      >
        <ArrowLeft size={16} />
        Back to Directory
      </Link>

      {/* Main Profile Info Card */}
      <section className="glass" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.25rem' }}>
          {store.logo_url ? (
            <img
              src={store.logo_url}
              alt={store.name}
              style={{ width: 72, height: 72, borderRadius: '12px', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '12px',
                background: 'var(--color-surface2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Store size={32} color="var(--color-muted)" />
            </div>
          )}

          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.2 }}>{store.name}</h1>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              {store.categories && (
                <span
                  className="badge"
                  style={{
                    background: `${store.categories.color}15`,
                    color: store.categories.color || 'var(--color-primary-h)',
                    borderColor: `${store.categories.color}35`,
                  }}
                >
                  <Tag size={10} style={{ marginRight: 2 }} />
                  {store.categories.name}
                </span>
              )}
              <span className="badge badge-muted">
                Floor {store.floor || '1'}
              </span>
            </div>
          </div>
        </div>

        <p style={{ fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--color-text)', marginBottom: '1.25rem' }}>
          {store.description || 'No description available for this exhibitor yet.'}
        </p>

        {/* Operating Hours card */}
        <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <Clock size={16} color="var(--color-accent)" />
            <div>
              <span style={{ fontWeight: 600 }}>Hours:</span>{' '}
              {store.opening_time ? store.opening_time.substring(0, 5) : '09:00'} -{' '}
              {store.closing_time ? store.closing_time.substring(0, 5) : '18:00'}
            </div>
          </div>
          {store.exhibitions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
              <MapPin size={16} color="var(--color-primary-h)" />
              <div>
                <span style={{ fontWeight: 600 }}>Exhibition:</span> {store.exhibitions.title}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Image Gallery Section */}
      {images.length > 0 && (
        <section className="glass" style={{ padding: '1.25rem', marginBottom: '1.5rem', position: 'relative' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Exhibitor Gallery</h2>
          <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', height: '240px', background: 'var(--color-bg)' }}>
            <img
              src={images[currentImageIndex].image_url}
              alt={`${store.name} gallery image`}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />

            {images.length > 1 && (
              <>
                <button
                  onClick={handlePrevImage}
                  className="btn btn-ghost btn-icon"
                  style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', borderRadius: '50%', background: 'rgba(19, 25, 41, 0.8)' }}
                  aria-label="Previous image"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={handleNextImage}
                  className="btn btn-ghost btn-icon"
                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', borderRadius: '50%', background: 'rgba(19, 25, 41, 0.8)' }}
                  aria-label="Next image"
                >
                  <ChevronRight size={18} />
                </button>
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.35rem', marginTop: '0.75rem' }}>
            {images.map((_, idx) => (
              <span
                key={idx}
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: idx === currentImageIndex ? 'var(--color-primary)' : 'var(--color-muted)',
                  cursor: 'pointer',
                }}
                onClick={() => setCurrentImageIndex(idx)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Active Promotions / Flyers */}
      {promotions.length > 0 && (
        <section className="glass" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Gift size={18} color="var(--color-warning)" />
            Active Offers & Promotions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {promotions.map((promo) => (
              <div
                key={promo.id}
                style={{
                  background: 'rgba(245,158,11,0.04)',
                  border: '1px dashed var(--color-warning)',
                  borderRadius: '8px',
                  padding: '1rem',
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'center',
                }}
              >
                {promo.banner_url && (
                  <img
                    src={promo.banner_url}
                    alt={promo.title}
                    style={{ width: 80, height: 60, borderRadius: '4px', objectFit: 'cover' }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-warning)' }}>
                    {promo.title}
                  </h3>
                  {promo.description && (
                    <p style={{ fontSize: '0.825rem', color: 'var(--color-muted)', marginTop: '0.2rem' }}>
                      {promo.description}
                    </p>
                  )}
                  {promo.discount_code && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid var(--color-border)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontFamily: 'monospace',
                          color: '#fff',
                        }}
                      >
                        Code: {promo.discount_code}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Contact Details Card */}
      <section className="glass" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Contact Exhibitor</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {/* Phone */}
          <div className="info-row" style={{ padding: '0.65rem 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--color-muted)', fontSize: '0.875rem' }}>
              <Phone size={15} />
              <span style={{ fontWeight: 600 }}>Phone</span>
            </div>
            {store.phone ? (
              <a href={`tel:${store.phone}`} style={{ fontSize: '0.9rem', color: 'var(--color-primary-h)', textDecoration: 'none' }}>
                {store.phone}
              </a>
            ) : (
              <span style={{ fontSize: '0.9rem', color: 'var(--color-muted)' }}>Not available</span>
            )}
          </div>

          {/* Email */}
          <div className="info-row" style={{ padding: '0.65rem 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--color-muted)', fontSize: '0.875rem' }}>
              <Mail size={15} />
              <span style={{ fontWeight: 600 }}>Email</span>
            </div>
            {store.email ? (
              <a href={`mailto:${store.email}`} style={{ fontSize: '0.9rem', color: 'var(--color-primary-h)', textDecoration: 'none' }}>
                {store.email}
              </a>
            ) : (
              <span style={{ fontSize: '0.9rem', color: 'var(--color-muted)' }}>Not available</span>
            )}
          </div>

          {/* Website */}
          <div className="info-row" style={{ padding: '0.65rem 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--color-muted)', fontSize: '0.875rem' }}>
              <Globe size={15} />
              <span style={{ fontWeight: 600 }}>Website</span>
            </div>
            {store.website ? (
              <a
                href={store.website.startsWith('http') ? store.website : `https://${store.website}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.9rem', color: 'var(--color-primary-h)', textDecoration: 'none' }}
              >
                {store.website}
              </a>
            ) : (
              <span style={{ fontSize: '0.9rem', color: 'var(--color-muted)' }}>Not available</span>
            )}
          </div>
        </div>
      </section>

      {/* Navigation directions action */}
      <button
        className="btn btn-primary"
        onClick={() => navigate(`/map?to=${store.id}`)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          width: '100%',
          marginTop: '1.5rem',
          padding: '0.85rem',
        }}
      >
        <Navigation size={18} />
        Navigate to Store
      </button>
    </div>
  );
}
