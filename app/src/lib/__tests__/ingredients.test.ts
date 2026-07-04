import { parseIngredient, provisionIngredient, sanitizeQty } from '@/lib/ingredients';

describe('parseIngredient', () => {
  it('splits a bare count from its name', () => {
    expect(parseIngredient('3 onions')).toEqual({ qty: '3', rest: ' onions' });
  });

  it('splits a number glued to its unit', () => {
    expect(parseIngredient('400g tomato')).toEqual({ qty: '400', rest: 'g tomato' });
    expect(parseIngredient('13oz cheddar')).toEqual({ qty: '13', rest: 'oz cheddar' });
  });

  it('handles decimal quantities', () => {
    expect(parseIngredient('1.5 cups milk')).toEqual({ qty: '1.5', rest: ' cups milk' });
  });

  it('drops leading whitespace before the number', () => {
    expect(parseIngredient('  400g tomato')).toEqual({ qty: '400', rest: 'g tomato' });
  });

  it('returns qty null when the text does not start with a number', () => {
    expect(parseIngredient('salt')).toEqual({ qty: null, rest: 'salt' });
    expect(parseIngredient('.5 cups')).toEqual({ qty: null, rest: '.5 cups' });
    expect(parseIngredient('')).toEqual({ qty: null, rest: '' });
  });

  it('parses a number-only ingredient with an empty rest', () => {
    expect(parseIngredient('3')).toEqual({ qty: '3', rest: '' });
  });

  it('treats a fraction as an integer qty plus fixed text (documented simplification)', () => {
    expect(parseIngredient('1/2 cup sugar')).toEqual({ qty: '1', rest: '/2 cup sugar' });
  });
});

describe('sanitizeQty', () => {
  it('strips everything except digits and dots', () => {
    expect(sanitizeQty('2a0')).toBe('20');
    expect(sanitizeQty('12 ')).toBe('12');
    expect(sanitizeQty('-3')).toBe('3');
  });

  it('keeps only the first decimal point', () => {
    expect(sanitizeQty('1.2.3')).toBe('1.23');
  });

  it('passes through empty and partial input as display state', () => {
    expect(sanitizeQty('')).toBe('');
    expect(sanitizeQty('.')).toBe('.');
    expect(sanitizeQty('200.')).toBe('200.');
  });
});

describe('provisionIngredient', () => {
  it('returns the original string when there is no override', () => {
    expect(provisionIngredient('400g tomato')).toBe('400g tomato');
    expect(provisionIngredient('3 onions')).toBe('3 onions');
  });

  it('splices the override in front of the fixed text', () => {
    expect(provisionIngredient('400g tomato', '200')).toBe('200g tomato');
    expect(provisionIngredient('3 onions', '2')).toBe('2 onions');
    expect(provisionIngredient('1.5 cups milk', '0.5')).toBe('0.5 cups milk');
  });

  it('falls back to the original qty when the override is empty or just a dot', () => {
    expect(provisionIngredient('400g tomato', '')).toBe('400g tomato');
    expect(provisionIngredient('400g tomato', '.')).toBe('400g tomato');
  });

  it('drops a trailing dot from a mid-edit override', () => {
    expect(provisionIngredient('400g tomato', '200.')).toBe('200g tomato');
  });

  it('ignores overrides on ingredients without a leading number', () => {
    expect(provisionIngredient('salt', '5')).toBe('salt');
  });
});
