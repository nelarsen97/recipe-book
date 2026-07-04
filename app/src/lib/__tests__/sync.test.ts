/**
 * sync.ts keeps in-flight/throttle state in module scope, so every test
 * gets a fresh module registry. The api module is mocked (network); the
 * store and settings modules are real, backed by the AsyncStorage mock.
 */
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    __esModule: true,
    ...actual,
    fetchRecipes: jest.fn(),
    pushRecipe: jest.fn(),
    pushDelete: jest.fn(),
    addToKeep: jest.fn(),
  };
});

type Api = typeof import('@/lib/api');
type Store = typeof import('@/lib/store');
type Sync = typeof import('@/lib/sync');
type Settings = typeof import('@/lib/settings');

let api: jest.Mocked<Api>;
let store: Store;
let sync: Sync;
let settings: Settings;

beforeEach(() => {
  jest.resetModules();
  api = require('@/lib/api');
  store = require('@/lib/store');
  sync = require('@/lib/sync');
  settings = require('@/lib/settings');
});

const enableServer = () =>
  settings.saveSettings({ serverEnabled: true, serverUrl: 'http://srv', apiKey: 'k' });

const serverRecipe = (id: string, name: string, updated_at = 1) => ({
  id,
  name,
  ingredients: [],
  updated_at,
});

describe('with the server connection disabled (default)', () => {
  it('reports success without touching the network', async () => {
    await store.upsertLocal({ name: 'Dirty', ingredients: [] });
    expect(await sync.syncNow()).toEqual({ ok: true, pending: 0 });
    expect(api.fetchRecipes).not.toHaveBeenCalled();
    expect(api.pushRecipe).not.toHaveBeenCalled();
    expect(api.pushDelete).not.toHaveBeenCalled();
  });

  it('keeps local changes dirty so they sync once re-enabled', async () => {
    const recipe = await store.upsertLocal({ name: 'Dirty', ingredients: [] });
    await sync.syncNow();
    expect((await store.getRecipe(recipe.id))?.dirty).toBe(true);

    await enableServer();
    api.fetchRecipes.mockResolvedValue([]);
    api.pushRecipe.mockImplementation(async (r) => ({ ...r, dirty: false }));
    expect(await sync.syncNow()).toEqual({ ok: true, pending: 0, error: undefined });
    expect(api.pushRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: recipe.id }));
    expect((await store.getRecipe(recipe.id))?.dirty).toBe(false);
  });
});

describe('with the server connection enabled', () => {
  beforeEach(enableServer);

  it('pulls, merges, and pushes dirty recipes and queued deletes', async () => {
    const local = await store.upsertLocal({ name: 'Local', ingredients: ['x'] });
    const doomed = await store.upsertLocal({ name: 'Doomed', ingredients: [] });
    await store.deleteLocal(doomed.id);

    api.fetchRecipes.mockResolvedValue([serverRecipe('s1', 'From server')]);
    api.pushRecipe.mockImplementation(async (r) => ({ ...r, dirty: false }));
    api.pushDelete.mockResolvedValue(undefined);

    expect(await sync.syncNow()).toEqual({ ok: true, pending: 0, error: undefined });

    expect(api.pushRecipe).toHaveBeenCalledTimes(1);
    expect(api.pushRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: local.id }));
    expect(api.pushDelete).toHaveBeenCalledWith(doomed.id);
    expect((await store.getRecipes()).map((r) => r.name).sort()).toEqual(['From server', 'Local']);
    expect(await store.pendingCount()).toBe(0);
  });

  it('reports a pull failure and leaves local state untouched', async () => {
    const recipe = await store.upsertLocal({ name: 'Kept', ingredients: [] });
    api.fetchRecipes.mockRejectedValue(new api.ApiError('server down', 500));

    expect(await sync.syncNow()).toEqual({ ok: false, pending: 1, error: 'server down' });
    expect((await store.getRecipe(recipe.id))?.dirty).toBe(true);
  });

  it('stringifies non-ApiError failures', async () => {
    api.fetchRecipes.mockRejectedValue(new Error('kaput'));
    expect((await sync.syncNow()).error).toBe('Error: kaput');
  });

  it('keeps a recipe dirty when its push fails, without stranding other pushes', async () => {
    const failing = await store.upsertLocal({ name: 'Failing', ingredients: [] });
    const passing = await store.upsertLocal({ name: 'Passing', ingredients: [] });

    api.fetchRecipes.mockResolvedValue([]);
    api.pushRecipe.mockImplementation(async (r) => {
      if (r.id === failing.id) throw new api.ApiError('rejected');
      return { ...r, dirty: false };
    });

    expect(await sync.syncNow()).toEqual({ ok: false, pending: 1, error: 'rejected' });
    expect((await store.getRecipe(failing.id))?.dirty).toBe(true);
    expect((await store.getRecipe(passing.id))?.dirty).toBe(false);
  });

  it('keeps a delete queued when pushing it fails', async () => {
    const doomed = await store.upsertLocal({ name: 'Doomed', ingredients: [] });
    await store.deleteLocal(doomed.id);

    api.fetchRecipes.mockResolvedValue([]);
    api.pushDelete.mockRejectedValue(new api.ApiError('delete failed'));

    expect(await sync.syncNow()).toEqual({ ok: false, pending: 1, error: 'delete failed' });
    expect(await store.pendingDeletes()).toEqual([doomed.id]);
  });

  it('shares one run between concurrent syncNow calls', async () => {
    api.fetchRecipes.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 10))
    );
    const first = sync.syncNow();
    const second = sync.syncNow();
    expect(second).toBe(first);
    await first;
    expect(api.fetchRecipes).toHaveBeenCalledTimes(1);
  });

  it('maybeSync throttles right after an attempt but allows the first one', async () => {
    api.fetchRecipes.mockResolvedValue([]);
    const first = sync.maybeSync();
    expect(first).not.toBeNull();
    await first;
    expect(sync.maybeSync()).toBeNull();
  });
});
