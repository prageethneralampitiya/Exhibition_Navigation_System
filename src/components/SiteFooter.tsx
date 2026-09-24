import defaultInvexLogo from '../pics/logo.png';
import defaultPartnerLogo from '../pics/partner.png';
import defaultPartner2Logo from '../pics/partner2.png';

export interface SiteFooterProps {
  /** Optional image URL for the left entity (Host/Organizer). Defaults to INVEX 2026 logo */
  leftLogoUrl?: string;
  leftLogoAlt?: string;

  /** Optional image URL for first partner logo. Defaults to partner.png */
  rightLogoUrl?: string;
  rightLogoAlt?: string;

  /** Optional image URL for second partner logo. Defaults to partner2.png */
  rightLogo2Url?: string;
  rightLogo2Alt?: string;

  /** Keyword connecting the left & right entities (e.g. "Partner with", "In Partnership with") */
  partnerKeyword?: string;
}

export function SiteFooter({
  leftLogoUrl = defaultInvexLogo,
  leftLogoAlt = 'INVEX 2026',
  rightLogoUrl = defaultPartnerLogo,
  rightLogoAlt = 'Official Partner',
  rightLogo2Url = defaultPartner2Logo,
  rightLogo2Alt = 'Official Partner 2',
  partnerKeyword = 'Partner with',
}: SiteFooterProps) {
  return (
    <footer className="site-partner-ribbon scroll-reveal" role="contentinfo" aria-label="Partner Ribbon">
      <div className="partner-ribbon-container">
        {/* Left Entity / Main Logo */}
        <div className="partner-ribbon-col partner-ribbon-left">
          {leftLogoUrl ? (
            <div className="partner-ribbon-logo-wrap glow-gold" title={leftLogoAlt}>
              <img
                src={leftLogoUrl}
                alt={leftLogoAlt}
                className="partner-ribbon-logo left-logo"
              />
            </div>
          ) : (
            <span className="partner-ribbon-fallback">INVEX 2026</span>
          )}
        </div>

        {/* Center Keyword */}
        <div className="partner-ribbon-col partner-ribbon-center">
          <span className="partner-ribbon-keyword">{partnerKeyword}</span>
        </div>

        {/* Right Entity / Partner Logos */}
        <div className="partner-ribbon-col partner-ribbon-right">
          <div className="partner-logos-group">
            {rightLogoUrl && (
              <div className="partner-ribbon-logo-wrap glow-cyan" title={rightLogoAlt}>
                <img
                  src={rightLogoUrl}
                  alt={rightLogoAlt}
                  className="partner-ribbon-logo partner-logo-1"
                />
              </div>
            )}
            {rightLogo2Url && (
              <div className="partner-ribbon-logo-wrap glow-purple" title={rightLogo2Alt}>
                <img
                  src={rightLogo2Url}
                  alt={rightLogo2Alt}
                  className="partner-ribbon-logo partner-logo-2"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
