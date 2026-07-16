import { multiplyQty, parseIngredient, provisionIngredient, sanitizeQty } from '@/lib/ingredients';

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

  it('treats a fraction as the quantity', () => {
    expect(parseIngredient('1/2 cup sugar')).toEqual({ qty: '1/2', rest: ' cup sugar' });
    expect(parseIngredient('3/4tsp nutmeg')).toEqual({ qty: '3/4', rest: 'tsp nutmeg' });
  });

  it('treats a mixed number as the quantity', () => {
    expect(parseIngredient('1 1/2 cups flour')).toEqual({ qty: '1 1/2', rest: ' cups flour' });
  });

  it('does not mistake a following word or number for a mixed-number fraction', () => {
    expect(parseIngredient('3 onions')).toEqual({ qty: '3', rest: ' onions' });
    expect(parseIngredient('2 4-inch tortillas')).toEqual({ qty: '2', rest: ' 4-inch tortillas' });
  });
});

describe('sanitizeQty', () => {
  it('strips everything except digits, dots, slashes, and spaces', () => {
    expect(sanitizeQty('2a0')).toBe('20');
    expect(sanitizeQty('-3')).toBe('3');
    // A trailing space is kept as mid-edit state (typing "1 1/2").
    expect(sanitizeQty('12 ')).toBe('12 ');
  });

  it('keeps only the first decimal point', () => {
    expect(sanitizeQty('1.2.3')).toBe('1.23');
  });

  it('allows fractions and mixed numbers', () => {
    expect(sanitizeQty('1/2')).toBe('1/2');
    expect(sanitizeQty('1 1/2')).toBe('1 1/2');
  });

  it('keeps only the first fraction slash and collapses repeated spaces', () => {
    expect(sanitizeQty('1/2/3')).toBe('1/23');
    expect(sanitizeQty('1  1/2')).toBe('1 1/2');
  });

  it('passes through empty and partial input as display state', () => {
    expect(sanitizeQty('')).toBe('');
    expect(sanitizeQty('.')).toBe('.');
    expect(sanitizeQty('200.')).toBe('200.');
    expect(sanitizeQty('1/')).toBe('1/');
  });
});

describe('multiplyQty', () => {
  it('multiplies whole numbers', () => {
    expect(multiplyQty('400', 2)).toBe('800');
    expect(multiplyQty('3', 4)).toBe('12');
  });

  it('returns whole numbers unchanged at 1x', () => {
    expect(multiplyQty('400', 1)).toBe('400');
    expect(multiplyQty('1/2', 1)).toBe('1/2');
    expect(multiplyQty('1.5', 1)).toBe('1.5');
  });

  it('keeps decimals decimal', () => {
    expect(multiplyQty('1.5', 3)).toBe('4.5');
    expect(multiplyQty('0.25', 2)).toBe('0.5');
    expect(multiplyQty('1.1', 3)).toBe('3.3');
  });

  it('collapses a decimal that multiplies to a whole number', () => {
    expect(multiplyQty('1.5', 2)).toBe('3');
  });

  it('keeps fractions fractional, promoting to mixed numbers', () => {
    expect(multiplyQty('1/2', 3)).toBe('1 1/2');
    expect(multiplyQty('3/4', 2)).toBe('1 1/2');
    expect(multiplyQty('1/4', 3)).toBe('3/4');
  });

  it('multiplies mixed numbers', () => {
    expect(multiplyQty('1 1/2', 2)).toBe('3');
    expect(multiplyQty('1 1/4', 3)).toBe('3 3/4');
  });

  it('leaves a zero-denominator fraction alone', () => {
    expect(multiplyQty('1/0', 2)).toBe('1/0');
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

  it('splices fraction and mixed-number overrides', () => {
    expect(provisionIngredient('1/2 cup sugar', '1/4')).toBe('1/4 cup sugar');
    expect(provisionIngredient('3 onions', '1 1/2')).toBe('1 1/2 onions');
    expect(provisionIngredient('1 1/2 cups flour', '2')).toBe('2 cups flour');
  });

  it('falls back to the original qty when the override has no digits', () => {
    expect(provisionIngredient('400g tomato', '')).toBe('400g tomato');
    expect(provisionIngredient('400g tomato', '.')).toBe('400g tomato');
    expect(provisionIngredient('400g tomato', '/')).toBe('400g tomato');
  });

  it('drops mid-edit leftovers from the end of an override', () => {
    expect(provisionIngredient('400g tomato', '200.')).toBe('200g tomato');
    expect(provisionIngredient('400g tomato', '1/')).toBe('1g tomato');
  });

  it('ignores overrides on ingredients without a leading number', () => {
    expect(provisionIngredient('salt', '5')).toBe('salt');
  });
});
