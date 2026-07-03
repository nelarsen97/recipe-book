import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local-first recipe store. Every change is written here immediately
 * (marked dirty) so a network problem can never lose a recipe; sync.ts
 * reconciles this store with the server.
 */

export type Recipe = {
  id: string;
  name: string;
  ingredients: string[];
  /** Epoch ms of the last local or server edit; last write wins on sync. */
  updated_at: number;
  /** True when this recipe has local changes the server hasn't seen. */
  dirty?: boolean;
};

type StoreData = {
  recipes: Recipe[];
  /** Recipe ids deleted locally but not yet deleted on the server. */
  pendingDeletes: string[];
};

const KEY = 'recipe-book/store';

let data: StoreData | null = null;
const listeners = new Set<() => void>();

export function uuid4(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

async function load(): Promise<StoreData> {
  if (data) return data;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    data = {
      recipes: Array.isArray(parsed?.recipes) ? parsed.recipes : [],
      pendingDeletes: Array.isArray(parsed?.pendingDeletes) ? parsed.pendingDeletes : [],
    };
  } catch {
    data = { recipes: [], pendingDeletes: [] };
  }
  return data;
}

async function persist(): Promise<void> {
  if (!data) return;
  await AsyncStorage.setItem(KEY, JSON.stringify(data));
  listeners.forEach((fn) => fn());
}

/** Re-render hook: fires after every store change (including sync). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function sortByName(recipes: Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getRecipes(): Promise<Recipe[]> {
  return sortByName((await load()).recipes);
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  return (await load()).recipes.find((r) => r.id === id) ?? null;
}

export async function pendingCount(): Promise<number> {
  const store = await load();
  return store.recipes.filter((r) => r.dirty).length + store.pendingDeletes.length;
}

export async function upsertLocal(input: {
  id?: string;
  name: string;
  ingredients: string[];
}): Promise<Recipe> {
  const store = await load();
  const recipe: Recipe = {
    id: input.id ?? uuid4(),
    name: input.name,
    ingredients: input.ingredients,
    updated_at: Date.now(),
    dirty: true,
  };
  const index = store.recipes.findIndex((r) => r.id === recipe.id);
  if (index >= 0) store.recipes[index] = recipe;
  else store.recipes.push(recipe);
  await persist();
  return recipe;
}

export async function deleteLocal(id: string): Promise<void> {
  const store = await load();
  store.recipes = store.recipes.filter((r) => r.id !== id);
  if (!store.pendingDeletes.includes(id)) store.pendingDeletes.push(id);
  await persist();
}

/**
 * Merge the authoritative server list into the local store, preserving
 * anything the server hasn't seen yet:
 * - locally dirty recipes win over the server copy unless the server's
 *   is newer (last write wins);
 * - clean local recipes missing from the server were deleted elsewhere
 *   and are dropped;
 * - recipes with a pending local delete are ignored until the delete
 *   is pushed.
 */
export async function mergeServerRecipes(serverRecipes: Recipe[]): Promise<void> {
  const store = await load();
  const localById = new Map(store.recipes.map((r) => [r.id, r]));
  const merged: Recipe[] = [];

  for (const server of serverRecipes) {
    if (store.pendingDeletes.includes(server.id)) continue;
    const local = localById.get(server.id);
    if (local?.dirty && local.updated_at >= server.updated_at) {
      merged.push(local);
    } else {
      merged.push({ ...server, dirty: false });
    }
  }
  for (const local of store.recipes) {
    if (local.dirty && !serverRecipes.some((s) => s.id === local.id)) {
      merged.push(local);
    }
  }

  store.recipes = merged;
  await persist();
}

/** Replace a dirty recipe with the server's accepted copy. */
export async function markSynced(server: Recipe): Promise<void> {
  const store = await load();
  const index = store.recipes.findIndex((r) => r.id === server.id);
  if (index >= 0) store.recipes[index] = { ...server, dirty: false };
  await persist();
}

export async function clearPendingDelete(id: string): Promise<void> {
  const store = await load();
  store.pendingDeletes = store.pendingDeletes.filter((d) => d !== id);
  await persist();
}

export async function dirtyRecipes(): Promise<Recipe[]> {
  return (await load()).recipes.filter((r) => r.dirty);
}

export async function pendingDeletes(): Promise<string[]> {
  return [...(await load()).pendingDeletes];
}
