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
