import { describe, it, expect } from 'vitest';
import { parseEventDescription, formatEventDescription } from '../events';

describe('events metadata utility', () => {
  it('formats and parses description, price, and offers correctly', () => {
    const text = 'Annual University Innovation Showcase';
    const price = 'Free Admission (Registration Required)';
    const offers = 'Early bird visitors get 25% merchandise voucher';

    const formatted = formatEventDescription(text, price, offers);
    expect(formatted).toContain(text);
    expect(formatted).toContain('<!--EVENT_META:');

    const parsed = parseEventDescription(formatted);
    expect(parsed.description).toBe(text);
    expect(parsed.price).toBe(price);
    expect(parsed.offers).toBe(offers);
  });

  it('handles plain text without metadata tags', () => {
    const plain = 'Simple event description without special pricing';
    const parsed = parseEventDescription(plain);
    expect(parsed.description).toBe(plain);
    expect(parsed.price).toBe('');
    expect(parsed.offers).toBe('');
  });

  it('handles empty or null values gracefully', () => {
    expect(parseEventDescription(null)).toEqual({ description: '', price: '', offers: '' });
    expect(parseEventDescription(undefined)).toEqual({ description: '', price: '', offers: '' });
    expect(formatEventDescription('', '', '')).toBe('');
  });
});
