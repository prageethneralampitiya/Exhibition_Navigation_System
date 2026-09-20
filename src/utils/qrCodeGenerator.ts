import QRCode from 'qrcode';

export interface QrCalibrateTarget {
  id: string;
  name: string;
  type: 'store' | 'node' | 'facility' | 'entrance' | 'poi' | 'path' | 'emergency' | string;
  latitude: number;
  longitude: number;
  floor?: string | null;
  category?: string | null;
}

/**
 * Builds a direct calibration URL that visitors can scan with their phone camera.
 */
export function buildCalibrationUrl(target: QrCalibrateTarget, customBaseUrl?: string): string {
  const origin = customBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const params = new URLSearchParams({
    calibrate: target.type,
    id: target.id,
    lat: target.latitude.toFixed(6),
    lng: target.longitude.toFixed(6),
    label: target.name,
  });

  if (target.floor) {
    params.set('floor', target.floor);
  }

  return `${origin}/map?${params.toString()}`;
}

/**
 * Generates a PNG Data URL of the QR code with custom colors and high resolution.
 */
export async function generateQrDataUrl(
  url: string,
  options?: {
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
  }
): Promise<string> {
  return QRCode.toDataURL(url, {
    width: options?.width || 512,
    margin: options?.margin !== undefined ? options.margin : 2,
    color: {
      dark: options?.color?.dark || '#0f172a',
      light: options?.color?.light || '#ffffff',
    },
    errorCorrectionLevel: 'H',
  });
}

/**
 * Helper to download the QR code image directly to the administrator's computer.
 */
export function downloadQrImage(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Generates a clean filename safe for OS filesystems.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}
