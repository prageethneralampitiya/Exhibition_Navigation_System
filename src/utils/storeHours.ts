/**
 * Store Operating Hours Utility
 * Default hours: 09:00 (9:00 AM) to 21:00 (9:00 PM).
 * Any store with missing hours or the legacy 18:00 closing time is mapped to 21:00.
 */

export function getEffectiveStoreHours(openingTime?: string | null, closingTime?: string | null): {
  opening: string;
  closing: string;
} {
  const opening = (!openingTime || openingTime === '00:00:00') ? '09:00' : openingTime.substring(0, 5);
  let closing = (!closingTime || closingTime === '00:00:00') ? '21:00' : closingTime.substring(0, 5);

  // Upgrade old default of 18:00 to 21:00 (9:00 PM)
  if (closing === '18:00') {
    closing = '21:00';
  }

  return { opening, closing };
}

export function formatStoreHours(openingTime?: string | null, closingTime?: string | null): string {
  const { opening, closing } = getEffectiveStoreHours(openingTime, closingTime);
  return `${opening} - ${closing}`;
}

export function isStoreCurrentlyOpen(openingTime?: string | null, closingTime?: string | null): boolean {
  const { opening, closing } = getEffectiveStoreHours(openingTime, closingTime);
  const now = new Date();
  const [oh, om] = opening.split(':').map(Number);
  const [ch, cm] = closing.split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= oh * 60 + om && mins < ch * 60 + cm;
}
