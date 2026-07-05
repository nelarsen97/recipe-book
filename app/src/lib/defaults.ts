import type { Recipe } from '@/lib/store';

/**
 * Recipes seeded into a fresh install on first launch (see `ensureSeeded`).
 *
 * These are placeholders — swap in the real starter set when it's ready. The
 * ids are hardcoded on purpose: a stable UUID means that if the same default
 * recipe is later shared and imported from another install, it overwrites the
 * local copy by id instead of creating a duplicate.
 */
export const DEFAULT_RECIPES: Recipe[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Sample: Buttered Toast',
    ingredients: ['2 slices bread', '1 tbsp butter'],
    steps: ['Toast the bread until golden.', 'Spread butter while warm.'],
    updated_at: 0,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Sample: Simple Salad',
    ingredients: ['Mixed greens', 'Olive oil', 'Lemon juice', 'Salt'],
    steps: ['Toss the greens in a bowl.', 'Dress with oil, lemon, and salt.'],
    updated_at: 0,
  },
];
