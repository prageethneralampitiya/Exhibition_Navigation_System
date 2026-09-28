/**
 * Utility functions for Google Maps-style Heading-Up camera rotation and movement tracking.
 */

/**
 * Calculates the shortest angular delta to rotate from a current continuous
 * camera rotation angle to align with a new target heading.
 *
 * For heading-up camera: when user heading is H (0° = North, 90° = East),
 * the camera must rotate to -H so that the heading vector points straight UP.
 *
 * Correctly handles the 359° ↔ 0° wrap-around transition by always choosing
 * the shortest path (delta between -180° and +180°), preventing unsightly 350° spins.
 */
export function calculateShortestRotation(currentCameraAngle: number, targetHeading: number): number {
  const normHeading = ((targetHeading % 360) + 360) % 360;
  const targetAngle = -normHeading;

  let delta = ((targetAngle - currentCameraAngle) % 360);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  return currentCameraAngle + delta;
}

/**
 * Calculates the shortest path to return the camera back to North-Up (0° orientation).
 */
export function calculateReturnToNorthRotation(currentCameraAngle: number): number {
  let delta = ((0 - currentCameraAngle) % 360);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  return currentCameraAngle + delta;
}

/**
 * Checks whether the heading change exceeds the deadband threshold.
 * Ignores tiny GPS heading fluctuations to prevent camera shaking.
 *
 * @param newHeading The newly reported heading in degrees [0, 360)
 * @param lastHeading The last confirmed heading in degrees [0, 360)
 * @param threshold Minimum angular change in degrees to trigger an update (default: 2.5°)
 */
export function shouldUpdateHeading(
  newHeading: number | null | undefined,
  lastHeading: number | null,
  threshold = 2.5
): boolean {
  if (newHeading === null || newHeading === undefined || isNaN(newHeading)) {
    return false;
  }
  if (lastHeading === null) {
    return true;
  }

  const normNew = ((newHeading % 360) + 360) % 360;
  const normLast = ((lastHeading % 360) + 360) % 360;

  // Angular difference between two angles in [0, 360)
  const diff = Math.abs(((normNew - normLast + 540) % 360) - 180);
  return diff >= threshold;
}

/**
 * Calculates the forward azimuth movement bearing (in degrees, 0 = North, 90 = East)
 * between two GPS coordinates using spherical trigonometry.
 */
export function calculateMovementBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return ((bearing % 360) + 360) % 360;
}
