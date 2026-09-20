import { describe, it, expect } from 'vitest';
import {
  buildCalibrationUrl,
  sanitizeFilename,
  generateQrDataUrl,
  type QrCalibrateTarget,
} from '../qrCodeGenerator';

describe('qrCodeGenerator', () => {
  describe('buildCalibrationUrl', () => {
    it('constructs a calibration URL for a store', () => {
      const target: QrCalibrateTarget = {
        id: 'store-123',
        name: 'Tech Pavilion Stall #5',
        type: 'store',
        latitude: 6.535600,
        longitude: 80.401200,
        floor: '2',
      };

      const url = buildCalibrationUrl(target, 'https://exnav.local');
      expect(url).toContain('https://exnav.local/map?');
      expect(url).toContain('calibrate=store');
      expect(url).toContain('id=store-123');
      expect(url).toContain('lat=6.535600');
      expect(url).toContain('lng=80.401200');
      expect(url).toContain('floor=2');
      expect(url).toContain('label=Tech+Pavilion+Stall+%235');
    });

    it('constructs a calibration URL for an entrance node without floor', () => {
      const target: QrCalibrateTarget = {
        id: 'node-entrance-1',
        name: 'Main North Gate',
        type: 'entrance',
        latitude: 6.535860,
        longitude: 80.400350,
      };

      const url = buildCalibrationUrl(target, 'http://localhost:5173');
      expect(url).toContain('http://localhost:5173/map?');
      expect(url).toContain('calibrate=entrance');
      expect(url).toContain('id=node-entrance-1');
      expect(url).toContain('lat=6.535860');
      expect(url).toContain('lng=80.400350');
      expect(url).not.toContain('floor=');
    });
  });

  describe('sanitizeFilename', () => {
    it('cleans filename of non-alphanumeric characters', () => {
      expect(sanitizeFilename('Stall #1 — Robotics & AI')).toBe('stall__1___robotics___ai');
      expect(sanitizeFilename('Main Entrance / Gate A')).toBe('main_entrance___gate_a');
      expect(sanitizeFilename('SimpleName_123')).toBe('simplename_123');
    });
  });

  describe('generateQrDataUrl', () => {
    it('generates a valid PNG data URL', async () => {
      const testUrl = 'https://exnav.local/map?calibrate=entrance&lat=6.535&lng=80.401';
      const dataUrl = await generateQrDataUrl(testUrl, { width: 256 });

      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(dataUrl.length).toBeGreaterThan(100);
    });
  });
});
