import { describe, it, expect } from 'vitest';
import {
  calculateShortestRotation,
  calculateReturnToNorthRotation,
  shouldUpdateHeading,
  calculateMovementBearing,
} from '../headingUp';

describe('Heading-Up Auto-Rotating Navigation Utilities', () => {
  describe('calculateShortestRotation', () => {
    it('rotates to point heading straight UP (-heading)', () => {
      // Heading East (90°) -> camera rotates -90° so East points UP
      expect(calculateShortestRotation(0, 90)).toBe(-90);
      // Heading South (180°) -> camera rotates -180°
      expect(calculateShortestRotation(0, 180)).toBe(-180);
      // Heading West (270°) -> camera rotates +90° (-270° = +90°)
      expect(calculateShortestRotation(0, 270)).toBe(90);
    });

    it('correctly handles the 359° → 0° (or 1°) transition via shortest path', () => {
      // User is currently at heading 359° (camera at -359° or +1°)
      const currentCameraAngle = 1; // 1° is equivalent to -359°
      // User turns right to heading 2° (target camera is -2°)
      // Shortest delta is -3° (from 1° to -2°)
      const newAngle = calculateShortestRotation(currentCameraAngle, 2);
      expect(newAngle).toBe(-2);
      expect(Math.abs(newAngle - currentCameraAngle)).toBe(3);
    });

    it('correctly handles the 1° → 359° transition via shortest path', () => {
      // User is currently at heading 1° (camera at -1°)
      const currentCameraAngle = -1;
      // User turns left to heading 359° (target camera is -359° or +1°)
      // Shortest delta is +2° (from -1° to +1°)
      const newAngle = calculateShortestRotation(currentCameraAngle, 359);
      expect(newAngle).toBe(1);
      expect(Math.abs(newAngle - currentCameraAngle)).toBe(2);
    });

    it('accumulates continuous rotation without sudden flips', () => {
      let angle = 0;
      // Rotate clockwise through full circle: 0 -> 90 -> 180 -> 270 -> 360/0
      angle = calculateShortestRotation(angle, 90);
      expect(angle).toBe(-90);

      angle = calculateShortestRotation(angle, 180);
      expect(angle).toBe(-180);

      angle = calculateShortestRotation(angle, 270);
      expect(angle).toBe(-270);

      angle = calculateShortestRotation(angle, 0);
      expect(angle).toBe(-360); // Cleanly wraps to -360° continuously, not jumping to 0°
    });
  });

  describe('calculateReturnToNorthRotation', () => {
    it('returns to 0° mod 360 via the shortest path', () => {
      expect(calculateReturnToNorthRotation(-355)).toBe(-360);
      expect(calculateReturnToNorthRotation(-5)).toBe(0);
      expect(calculateReturnToNorthRotation(175)).toBe(0);
      expect(calculateReturnToNorthRotation(-185)).toBe(-360);
    });
  });

  describe('shouldUpdateHeading (Deadband filter)', () => {
    it('accepts initial heading when lastHeading is null', () => {
      expect(shouldUpdateHeading(45, null)).toBe(true);
    });

    it('ignores null, undefined, or NaN headings', () => {
      expect(shouldUpdateHeading(null, 45)).toBe(false);
      expect(shouldUpdateHeading(undefined, 45)).toBe(false);
      expect(shouldUpdateHeading(NaN, 45)).toBe(false);
    });

    it('ignores fluctuations smaller than threshold (< 2.5°)', () => {
      expect(shouldUpdateHeading(46.0, 45.0, 2.5)).toBe(false); // 1.0° diff
      expect(shouldUpdateHeading(47.2, 45.0, 2.5)).toBe(false); // 2.2° diff
    });

    it('accepts fluctuations greater than or equal to threshold', () => {
      expect(shouldUpdateHeading(47.6, 45.0, 2.5)).toBe(true); // 2.6° diff
      expect(shouldUpdateHeading(90.0, 45.0, 2.5)).toBe(true);
    });

    it('handles threshold check across the 359° ↔ 0° boundary', () => {
      // 359.5° to 0.5° is only 1.0° difference -> should ignore
      expect(shouldUpdateHeading(0.5, 359.5, 2.5)).toBe(false);
      // 358° to 2° is 4° difference -> should trigger update
      expect(shouldUpdateHeading(2.0, 358.0, 2.5)).toBe(true);
    });
  });

  describe('calculateMovementBearing', () => {
    it('calculates North heading (0°) correctly', () => {
      // Moving due North: latitude increases, longitude unchanged
      const bearing = calculateMovementBearing(6.5350, 80.4010, 6.5360, 80.4010);
      expect(bearing).toBeCloseTo(0, 0);
    });

    it('calculates South heading (180°) correctly', () => {
      // Moving due South: latitude decreases, longitude unchanged
      const bearing = calculateMovementBearing(6.5360, 80.4010, 6.5350, 80.4010);
      expect(bearing).toBeCloseTo(180, 0);
    });

    it('calculates East heading (90°) correctly', () => {
      // Moving due East: latitude unchanged, longitude increases
      const bearing = calculateMovementBearing(6.5350, 80.4010, 6.5350, 80.4020);
      expect(bearing).toBeCloseTo(90, 0);
    });

    it('calculates West heading (270°) correctly', () => {
      // Moving due West: latitude unchanged, longitude decreases
      const bearing = calculateMovementBearing(6.5350, 80.4020, 6.5350, 80.4010);
      expect(bearing).toBeCloseTo(270, 0);
    });
  });
});
