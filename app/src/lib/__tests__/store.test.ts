/**
 * The store module caches its data in module scope, so every test gets a
 * fresh module registry (and with it a fresh AsyncStorage mock).
 */
type Store = typeof import('@/lib/store');

let store: Store;

beforeEach(() => {
  jest.resetModules();
  store = require('@/lib/store');
});

describe('uuid4', () => {
  it('produces RFC 4122 version-4 ids', () => {
    expect(store.uuid4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => store.uuid4()));
    expect(ids.size).toBe(200);
  });
});

describe('upsertLocal', () => {
  it('creates a dirty recipe with a generated id and timestamp', async () => {
    const before = Date.now();
    const recipe = await store.upsertLocal({ name: 'Pancakes', ingredients: ['flour'] });
    expect(recipe.id).toBeTruthy();
    expect(recipe.dirty).toBe(true);
    expect(recipe.updated_at).toBeGreaterThanOrEqual(before);
    expect(await store.getRecipe(recipe.id)).toEqual(recipe);
  });

  it('replaces an existing recipe when given its id', async () => {
    const original = await store.upsertLocal({ name: 'Pancakes', ingredients: ['flour'] });
    await store.upsertLocal({ id: original.id, name: 'Waffles', ingredients: ['flour', 'eggs'] });
    expect(await store.getRecipes()).toHaveLength(1);
    expect((await store.getRecipe(original.id))?.name).toBe('Waffles');
  });

  it('round-trips steps, defaulting to none when omitted', async () => {
    const withSteps = await store.upsertLocal({
      name: 'Pancakes',
      ingredients: ['flour'],
      steps: ['Mix', 'Fry'],
    });
    expect((await store.getRecipe(withSteps.id))?.steps).toEqual(['Mix', 'Fry']);

    const withoutSteps = await store.upsertLocal({ name: 'Toast', ingredients: ['bread'] });
    expect((await store.getRecipe(withoutSteps.id))?.steps).toEqual([]);
  });
});

describe('load-time migration', () => {
  it('defaults steps to [] for recipes stored before steps existed', async () => {
    // Required after resetModules so it's the same mock instance the
    // freshly-loaded store module reads from.
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(
      'recipe-book/store',
      JSON.stringify({
        recipes: [{ id: 'old1', name: 'Legacy', ingredients: ['salt'], updated_at: 1 }],
        pendingDeletes: [],
      })
    );
    const legacy = await store.getRecipe('old1');
    expect(legacy?.steps).toEqual([]);
  });
});

describe('getRecipes', () => {
  it('sorts by name, case-insensitively', async () => {
    await store.upsertLocal({ name: 'banana bread', ingredients: [] });
    await store.upsertLocal({ name: 'Apple pie', ingredients: [] });
    await store.upsertLocal({ name: 'Cherry cake', ingredients: [] });
    expect((await store.getRecipes()).map((r) => r.name)).toEqual([
      'Apple pie',
      'banana bread',
      'Cherry cake',
    ]);
  });

  it('returns null from getRecipe for an unknown id', async () => {
    expect(await store.getRecipe('nope')).toBeNull();
  });
});

describe('setRecipeOrder', () => {
  const names = async () => (await store.getRecipes()).map((r) => r.name);

  it('overrides the alphabetical order and persists it', async () => {
    const a = await store.upsertLocal({ name: 'Apple pie', ingredients: [] });
    const b = await store.upsertLocal({ name: 'Banana bread', ingredients: [] });
    const c = await store.upsertLocal({ name: 'Cherry cake', ingredients: [] });

    await store.setRecipeOrder([c.id, a.id, b.id]);
    expect(await names()).toEqual(['Cherry cake', 'Apple pie', 'Banana bread']);
  });

  it('notifies subscribers so the list re-renders', async () => {
    const a = await store.upsertLocal({ name: 'A', ingredients: [] });
    const listener = jest.fn();
    store.subscribe(listener);
    await store.setRecipeOrder([a.id]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sorts recipes unknown to the manual order alphabetically after it', async () => {
    const b = await store.upsertLocal({ name: 'Banana bread', ingredients: [] });
    const c = await store.upsertLocal({ name: 'Cherry cake', ingredients: [] });
    await store.setRecipeOrder([c.id, b.id]);

    await store.upsertLocal({ name: 'Zucchini soup', ingredients: [] });
    await store.upsertLocal({ name: 'Apple pie', ingredients: [] });
    expect(await names()).toEqual(['Cherry cake', 'Banana bread', 'Apple pie', 'Zucchini soup']);
  });

  it('drops ids that do not match a stored recipe', async () => {
    const b = await store.upsertLocal({ name: 'B', ingredients: [] });
    const z = await store.upsertLocal({ name: 'Z', ingredients: [] });
    await store.setRecipeOrder([z.id, 'ghost', b.id]);
    expect(await names()).toEqual(['Z', 'B']);
  });

  it('ignores an order whose recipes were all deleted', async () => {
    const doomed = await store.upsertLocal({ name: 'Doomed', ingredients: [] });
    await store.setRecipeOrder([doomed.id]);
    await store.deleteLocal(doomed.id);
    await store.upsertLocal({ name: 'Banana bread', ingredients: [] });
    await store.upsertLocal({ name: 'Apple pie', ingredients: [] });
    expect(await names()).toEqual(['Apple pie', 'Banana bread']);
  });

  it('loads a persisted manual order on startup', async () => {
    // Seed the blob directly: same mock instance the fresh store module
    // reads from on its first call, so this exercises the load path.
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(
      'recipe-book/store',
      JSON.stringify({
        recipes: [
          { id: 'a', name: 'A', ingredients: [], steps: [], updated_at: 1 },
          { id: 'z', name: 'Z', ingredients: [], steps: [], updated_at: 1 },
        ],
        pendingDeletes: [],
        order: ['z', 'a'],
      })
    );
    expect(await names()).toEqual(['Z', 'A']);
  });
});

describe('importRecipes', () => {
  it('adds new recipes and overwrites matching ids instead of duplicating', async () => {
    const mine = await store.upsertLocal({ name: 'Mine', ingredients: ['a'] });

    const { added, updated } = await store.importRecipes([
      { id: mine.id, name: 'Mine (theirs)', ingredients: ['b'], steps: ['s'] },
      { id: 'their-new-id', name: 'Theirs', ingredients: ['c'] },
    ]);

    expect(added).toBe(1);
    expect(updated).toBe(1);
    const all = await store.getRecipes();
    expect(all).toHaveLength(2); // no duplicate for the shared id
    expect((await store.getRecipe(mine.id))?.name).toBe('Mine (theirs)');
    expect((await store.getRecipe('their-new-id'))?.name).toBe('Theirs');
  });

  it('marks imported recipes dirty so they sync, and coerces missing fields', async () => {
    await store.importRecipes([{ id: 'x', name: 'Minimal' }]);
    const imported = await store.getRecipe('x');
    expect(imported?.dirty).toBe(true);
    expect(imported?.ingredients).toEqual([]);
    expect(imported?.steps).toEqual([]);
  });

  it('mints an id for a recipe imported without one, and skips nameless entries', async () => {
    const { added } = await store.importRecipes([
      { name: 'No id here', ingredients: [] },
      { ingredients: ['orphan'] }, // no name -> skipped
    ]);
    expect(added).toBe(1);
    const all = await store.getRecipes();
    expect(all).toHaveLength(1);
    expect(all[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('persists the whole batch with a single notification', async () => {
    const listener = jest.fn();
    store.subscribe(listener);
    await store.importRecipes([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('ensureSeeded', () => {
  it('seeds the bundled defaults on first run', async () => {
    const { DEFAULT_RECIPES } = require('@/lib/defaults');
    await store.ensureSeeded();
    const all = await store.getRecipes();
    expect(all).toHaveLength(DEFAULT_RECIPES.length);
    expect(all.some((r: { name: string }) => r.name === DEFAULT_RECIPES[0].name)).toBe(true);
  });

  it('does not re-seed a deleted default on the next launch', async () => {
    await store.ensureSeeded();
    const seeded = await store.getRecipes();
    await store.deleteLocal(seeded[0].id);
    const remaining = seeded.length - 1;

    await store.ensureSeeded(); // second launch
    expect(await store.getRecipes()).toHaveLength(remaining);
  });
});

describe('deleteLocal', () => {
  it('removes the recipe and queues the delete for sync', async () => {
    const recipe = await store.upsertLocal({ name: 'Doomed', ingredients: [] });
    await store.deleteLocal(recipe.id);
    expect(await store.getRecipe(recipe.id)).toBeNull();
    expect(await store.pendingDeletes()).toEqual([recipe.id]);
  });

  it('does not queue the same delete twice', async () => {
    const recipe = await store.upsertLocal({ name: 'Doomed', ingredients: [] });
    await store.deleteLocal(recipe.id);
    await store.deleteLocal(recipe.id);
    expect(await store.pendingDeletes()).toEqual([recipe.id]);
  });
});

describe('pendingCount', () => {
  it('counts dirty recipes plus queued deletes', async () => {
    await store.upsertLocal({ name: 'A', ingredients: [] });
    const b = await store.upsertLocal({ name: 'B', ingredients: [] });
    await store.deleteLocal(b.id);
    expect(await store.pendingCount()).toBe(2); // 1 dirty + 1 pending delete
  });
});

describe('mergeServerRecipes', () => {
  const serverRecipe = (id: string, name: string, updated_at: number) => ({
    id,
    name,
    ingredients: [],
    steps: [],
    updated_at,
  });

  it('adds recipes the client has never seen, marked clean', async () => {
    await store.mergeServerRecipes([serverRecipe('s1', 'From server', 10)]);
    const merged = await store.getRecipe('s1');
    expect(merged?.name).toBe('From server');
    expect(merged?.dirty).toBe(false);
  });

  it('keeps a dirty local recipe that is newer than the server copy', async () => {
    const local = await store.upsertLocal({ name: 'Local edit', ingredients: ['new'] });
    await store.mergeServerRecipes([serverRecipe(local.id, 'Stale server', local.updated_at - 1000)]);
    const kept = await store.getRecipe(local.id);
    expect(kept?.name).toBe('Local edit');
    expect(kept?.dirty).toBe(true);
  });

  it('lets a newer server copy win over a dirty local recipe', async () => {
    const local = await store.upsertLocal({ name: 'Local edit', ingredients: [] });
    await store.mergeServerRecipes([serverRecipe(local.id, 'Newer server', local.updated_at + 1000)]);
    const winner = await store.getRecipe(local.id);
    expect(winner?.name).toBe('Newer server');
    expect(winner?.dirty).toBe(false);
  });

  it('drops clean local recipes missing from the server (deleted elsewhere)', async () => {
    await store.mergeServerRecipes([serverRecipe('s1', 'Synced', 10)]);
    await store.mergeServerRecipes([]);
    expect(await store.getRecipes()).toEqual([]);
  });

  it('keeps dirty local recipes the server has never seen', async () => {
    const local = await store.upsertLocal({ name: 'Offline creation', ingredients: [] });
    await store.mergeServerRecipes([]);
    expect(await store.getRecipe(local.id)).not.toBeNull();
  });

  it('does not resurrect a recipe with a pending local delete', async () => {
    const recipe = await store.upsertLocal({ name: 'Deleted here', ingredients: [] });
    await store.deleteLocal(recipe.id);
    await store.mergeServerRecipes([serverRecipe(recipe.id, 'Deleted here', 1)]);
    expect(await store.getRecipe(recipe.id)).toBeNull();
  });
});

describe('sync bookkeeping', () => {
  it('markSynced replaces the local copy with the server copy and clears dirty', async () => {
    const local = await store.upsertLocal({ name: 'Draft', ingredients: [] });
    await store.markSynced({
      id: local.id,
      name: 'Accepted',
      ingredients: [],
      steps: [],
      updated_at: local.updated_at + 1,
    });
    const synced = await store.getRecipe(local.id);
    expect(synced?.name).toBe('Accepted');
    expect(synced?.dirty).toBe(false);
    expect(await store.pendingCount()).toBe(0);
  });

  it('clearPendingDelete removes only the given id', async () => {
    const a = await store.upsertLocal({ name: 'A', ingredients: [] });
    const b = await store.upsertLocal({ name: 'B', ingredients: [] });
    await store.deleteLocal(a.id);
    await store.deleteLocal(b.id);
    await store.clearPendingDelete(a.id);
    expect(await store.pendingDeletes()).toEqual([b.id]);
  });

  it('dirtyRecipes returns only recipes with unsynced changes', async () => {
    const dirty = await store.upsertLocal({ name: 'Dirty', ingredients: [] });
    await store.mergeServerRecipes([
      { id: 's1', name: 'Clean', ingredients: [], steps: [], updated_at: 1 },
      { ...dirty, updated_at: dirty.updated_at - 1 },
    ]);
    expect((await store.dirtyRecipes()).map((r) => r.id)).toEqual([dirty.id]);
  });
});

describe('pinning', () => {
  it('togglePinned pins in tap order and unpins again', async () => {
    const a = await store.upsertLocal({ name: 'A', ingredients: [] });
    const b = await store.upsertLocal({ name: 'B', ingredients: [] });

    await store.togglePinned(b.id);
    await store.togglePinned(a.id);
    expect(await store.getPinnedIds()).toEqual([b.id, a.id]); // pin order, not name order

    await store.togglePinned(b.id);
    expect(await store.getPinnedIds()).toEqual([a.id]);
  });

  it('movePinned reorders within the pinned list and clamps the target', async () => {
    const a = await store.upsertLocal({ name: 'A', ingredients: [] });
    const b = await store.upsertLocal({ name: 'B', ingredients: [] });
    const c = await store.upsertLocal({ name: 'C', ingredients: [] });
    for (const r of [a, b, c]) await store.togglePinned(r.id);

    await store.movePinned(c.id, 0);
    expect(await store.getPinnedIds()).toEqual([c.id, a.id, b.id]);

    await store.movePinned(c.id, 99); // clamped to the end
    expect(await store.getPinnedIds()).toEqual([a.id, b.id, c.id]);

    await store.movePinned('not-pinned', 0); // unknown id: no-op
    expect(await store.getPinnedIds()).toEqual([a.id, b.id, c.id]);
  });

  it('pinning never marks the recipe dirty', async () => {
    await store.mergeServerRecipes([
      { id: 's1', name: 'Clean', ingredients: [], steps: [], updated_at: 1 },
    ]);
    await store.togglePinned('s1');
    expect(await store.pendingCount()).toBe(0);
  });

  it('deleteLocal drops the pin along with the recipe', async () => {
    const doomed = await store.upsertLocal({ name: 'Doomed', ingredients: [] });
    await store.togglePinned(doomed.id);
    await store.deleteLocal(doomed.id);
    expect(await store.getPinnedIds()).toEqual([]);
  });

  it('getPinnedIds hides pins whose recipe was removed by a server merge', async () => {
    await store.mergeServerRecipes([
      { id: 's1', name: 'Synced', ingredients: [], steps: [], updated_at: 1 },
    ]);
    await store.togglePinned('s1');
    await store.mergeServerRecipes([]); // deleted elsewhere
    expect(await store.getPinnedIds()).toEqual([]);
  });

  it('pins survive a server merge of the pinned recipe', async () => {
    await store.mergeServerRecipes([
      { id: 's1', name: 'V1', ingredients: [], steps: [], updated_at: 1 },
    ]);
    await store.togglePinned('s1');
    await store.mergeServerRecipes([
      { id: 's1', name: 'V2', ingredients: [], steps: [], updated_at: 2 },
    ]);
    expect(await store.getPinnedIds()).toEqual(['s1']);
  });

  it('loads pinnedIds persisted by an earlier session, defaulting when absent', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(
      'recipe-book/store',
      JSON.stringify({
        recipes: [{ id: 'p1', name: 'Kept', ingredients: [], steps: [], updated_at: 1 }],
        pendingDeletes: [],
        pinnedIds: ['p1'],
      })
    );
    expect(await store.getPinnedIds()).toEqual(['p1']);
  });
});

describe('subscribe', () => {
  it('notifies on every change until unsubscribed', async () => {
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    await store.upsertLocal({ name: 'A', ingredients: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await store.upsertLocal({ name: 'B', ingredients: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
