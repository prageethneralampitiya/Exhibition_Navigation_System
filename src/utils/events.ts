export interface EventMeta {
  price?: string;
  offers?: string;
}

/**
 * Extracts clean user description, ticket/entrance price, and promotional offers
 * from the stored raw description string without requiring database schema changes.
 */
export function parseEventDescription(rawDescription: string | null | undefined): {
  description: string;
  price: string;
  offers: string;
} {
  if (!rawDescription) {
    return { description: '', price: '', offers: '' };
  }
  const metaMatch = rawDescription.match(/<!--EVENT_META:([\s\S]*?)-->/);
  let price = '';
  let offers = '';
  let description = rawDescription;
  if (metaMatch) {
    try {
      const parsed = JSON.parse(metaMatch[1]);
      price = parsed.price || '';
      offers = parsed.offers || '';
      description = rawDescription.replace(/<!--EVENT_META:[\s\S]*?-->/, '').trim();
    } catch {
      // ignore parse error and retain raw description
    }
  }
  return { description, price, offers };
}

/**
 * Encodes clean user description along with price and promotional offers
 * into a single text payload safely for Supabase.
 */
export function formatEventDescription(description: string, price?: string, offers?: string): string {
  const p = (price || '').trim();
  const o = (offers || '').trim();
  const d = (description || '').trim();
  if (!p && !o) {
    return d;
  }
  const meta: EventMeta = { price: p, offers: o };
  return `${d}\n\n<!--EVENT_META:${JSON.stringify(meta)}-->`.trim();
}
