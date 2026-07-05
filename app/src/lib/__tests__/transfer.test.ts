import type { Recipe } from '@/lib/store';
import { EXPORT_FORMAT, parseImport, serializeExport } from '@/lib/transfer';

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'r1',
  name: 'Pancakes',
  ingredients: ['flour', 'eggs'],
  steps: ['Mix', 'Fry'],
  updated_at: 123,
  dirty: true,
  ...over,
});

describe('serializeExport', () => {
  it('wraps recipes in a versioned envelope and drops the dirty flag', () => {
    const envelope = JSON.parse(serializeExport([recipe()]));
    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(envelope.version).toBe(1);
    expect(typeof envelope.exported_at).toBe('number');
    expect(envelope.recipes).toHaveLength(1);
    expect(envelope.recipes[0]).not.toHaveProperty('dirty');
    expect(envelope.recipes[0].id).toBe('r1');
  });
});

describe('parseImport', () => {
  it('round-trips what serializeExport produced', () => {
    const parsed = parseImport(serializeExport([recipe({ id: 'a' }), recipe({ id: 'b' })]));
    expect(parsed.map((r) => r.id)).toEqual(['a', 'b']);
    expect(parsed[0].name).toBe('Pancakes');
  });

  it('tolerates a bare array of recipes (no envelope)', () => {
    const parsed = parseImport(JSON.stringify([{ id: 'x', name: 'Toast', ingredients: [] }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Toast');
  });

  it('drops entries without a name', () => {
    const parsed = parseImport(JSON.stringify([{ name: 'Keep me' }, { ingredients: ['no name'] }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Keep me');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseImport('not json {')).toThrow(/valid JSON/);
  });

  it('throws when the shape is not a recipe export', () => {
    expect(() => parseImport(JSON.stringify({ hello: 'world' }))).toThrow(/recipe export/);
  });

  it('throws when there are no importable recipes', () => {
    expect(() => parseImport(JSON.stringify({ recipes: [{ ingredients: [] }] }))).toThrow(
      /no recipes/
    );
  });
});
