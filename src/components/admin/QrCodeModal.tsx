import { useEffect, useState, useRef } from 'react';
import { Download, Printer, Copy, Check, QrCode } from 'lucide-react';
import { AdminModal } from './AdminModal';
import {
  type QrCalibrateTarget,
  buildCalibrationUrl,
  generateQrDataUrl,
  downloadQrImage,
  sanitizeFilename,
} from '../../utils/qrCodeGenerator';

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: QrCalibrateTarget | null;
}

export function QrCodeModal({ isOpen, onClose, target }: QrCodeModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const printableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !target) {
      setQrDataUrl('');
      setCopied(false);
      return;
    }

    let isMounted = true;
    const generate = async () => {
      try {
        setLoading(true);
        const url = buildCalibrationUrl(target);
        const dataUrl = await generateQrDataUrl(url, { width: 400 });
        if (isMounted) {
          setQrDataUrl(dataUrl);
        }
      } catch (err) {
        console.error('Failed to generate QR code:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    generate();

    return () => {
      isMounted = false;
    };
  }, [isOpen, target]);

  if (!isOpen || !target) return null;

  const calibrationUrl = buildCalibrationUrl(target);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(calibrationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const filename = `QR_${target.type}_${sanitizeFilename(target.name)}`;
    downloadQrImage(qrDataUrl, filename);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print QR placards.');
      return;
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Check-in Placard - ${target.name}</title>
          <style>
            @page { size: A5 portrait; margin: 15mm; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              text-align: center;
              padding: 20px;
              color: #0f172a;
              background: #ffffff;
            }
            .card {
              border: 3px solid #0f172a;
              border-radius: 20px;
              padding: 30px 20px;
              max-width: 420px;
              margin: 0 auto;
            }
            .header-tag {
              font-size: 13px;
              font-weight: 800;
              letter-spacing: 0.1em;
              color: #4f46e5;
              text-transform: uppercase;
              margin-bottom: 8px;
            }
            .title {
              font-size: 26px;
              font-weight: 900;
              margin: 0 0 10px;
              line-height: 1.2;
            }
            .badge {
              display: inline-block;
              background: #f1f5f9;
              border: 1px solid #cbd5e1;
              padding: 4px 12px;
              border-radius: 20px;
              font-size: 13px;
              font-weight: 700;
              color: #334155;
              margin-bottom: 20px;
            }
            .qr-img {
              width: 260px;
              height: 260px;
              margin: 0 auto 15px;
              display: block;
            }
            .instructions {
              font-size: 14px;
              font-weight: 700;
              color: #0f172a;
              margin: 0 0 6px;
            }
            .sub-instructions {
              font-size: 11px;
              color: #64748b;
              margin: 0;
            }
            .coords {
              font-family: monospace;
              font-size: 11px;
              color: #94a3b8;
              margin-top: 15px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header-tag">🗺️ Exhibition Navigation &bull; Checkpoint</div>
            <h1 class="title">${target.name}</h1>
            <div class="badge">
              Floor ${target.floor || '1'}${target.category ? ` &bull; ${target.category}` : ''}
            </div>
            <img class="qr-img" src="${qrDataUrl}" alt="QR Code" />
            <p class="instructions">📱 Scan with your phone camera to pinpoint your location</p>
            <p class="sub-instructions">No app installation required &bull; Instantly calibrates indoor navigation</p>
            <div class="coords">${target.latitude.toFixed(6)}, ${target.longitude.toFixed(6)}</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); }
            }
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  return (
    <AdminModal
      title="Indoor Location Check-in QR Code"
      onClose={onClose}
      maxWidth={480}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleCopyLink}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            {copied ? <Check size={14} style={{ color: '#22c55e' }} /> : <Copy size={14} />}
            <span>{copied ? 'Link Copied!' : 'Copy Link'}</span>
          </button>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handlePrint}
              disabled={!qrDataUrl}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Printer size={15} />
              <span>Print Placard</span>
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleDownload}
              disabled={!qrDataUrl}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Download size={15} />
              <span>Download PNG</span>
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '0.5rem 0' }}>
        {/* Printable Placard Card Preview */}
        <div
          ref={printableRef}
          style={{
            width: '100%',
            maxWidth: '340px',
            backgroundColor: '#ffffff',
            color: '#0f172a',
            borderRadius: '16px',
            padding: '1.5rem 1.25rem',
            textAlign: 'center',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)',
            border: '2px solid rgba(255, 255, 255, 0.2)',
          }}
        >
          <div
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: '#4f46e5',
              textTransform: 'uppercase',
              marginBottom: '0.35rem',
            }}
          >
            🗺️ ExNav &bull; Checkpoint
          </div>

          <h3
            style={{
              margin: '0 0 0.4rem',
              fontSize: '1.2rem',
              fontWeight: 900,
              color: '#0f172a',
              lineHeight: 1.25,
            }}
          >
            {target.name}
          </h3>

          <div
            style={{
              display: 'inline-block',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              padding: '0.2rem 0.65rem',
              borderRadius: '20px',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#475569',
              marginBottom: '1rem',
            }}
          >
            Floor {target.floor || '1'}{target.category ? ` • ${target.category}` : ''}
          </div>

          {/* QR Code Container */}
          <div
            style={{
              width: '210px',
              height: '210px',
              margin: '0 auto 0.85rem',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {loading ? (
              <div className="spinner" style={{ width: 32, height: 32 }} />
            ) : qrDataUrl ? (
              <img src={qrDataUrl} alt="QR Code" style={{ width: '100%', height: '100%', display: 'block' }} />
            ) : (
              <QrCode size={40} style={{ color: '#94a3b8' }} />
            )}
          </div>

          <p style={{ margin: '0 0 0.25rem', fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
            📱 Scan with phone camera
          </p>
          <p style={{ margin: 0, fontSize: '0.68rem', color: '#64748b' }}>
            Instantly calibrates your exact indoor position
          </p>
        </div>

        {/* Info snippet */}
        <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', textAlign: 'center', maxWidth: '340px' }}>
          Visitors who scan this QR code will have their map location locked to this spot without GPS drift.
        </div>
      </div>
    </AdminModal>
  );
}
