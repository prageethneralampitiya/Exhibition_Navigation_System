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
  rightLogoAlt = 'CipherX',
  rightLogo2Url = defaultPartner2Logo,
  rightLogo2Alt = 'PrintX',
  partnerKeyword = 'Powered By',
}: SiteFooterProps) {
  return (
    <footer className="site-partner-ribbon" role="contentinfo" aria-label="Partner Ribbon">
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
              <a
                href="https://cipherx.com.lk"
                target="_blank"
                rel="noopener noreferrer"
                className="partner-ribbon-logo-wrap glow-cyan"
                title="CipherX - cipherx.com.lk"
                style={{ textDecoration: 'none', display: 'inline-flex' }}
              >
                <img
                  src={rightLogoUrl}
                  alt={rightLogoAlt}
                  className="partner-ribbon-logo partner-logo-1"
                />
              </a>
            )}
            {rightLogo2Url && (
              <a
                href="https://printx.web.lk"
                target="_blank"
                rel="noopener noreferrer"
                className="partner-ribbon-logo-wrap glow-purple"
                title="PrintX - printx.web.lk"
                style={{ textDecoration: 'none', display: 'inline-flex' }}
              >
                <img
                  src={rightLogo2Url}
                  alt={rightLogo2Alt}
                  className="partner-ribbon-logo partner-logo-2"
                />
              </a>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
