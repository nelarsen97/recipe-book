import { addShoppingItems, KeepError } from './keep/client';
import { keepConfigured, loadKeepSettings } from './keep/settings';
import { loadSettings } from './settings';
import { Recipe } from './store';

export type KeepAddResult = {
  added: number;
  skipped: number;
  skipped_items: string[];
};

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export const NOT_CONFIGURED =
  'Set the server address and API key in Settings first.';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { serverUrl, apiKey } = await loadSettings();
  if (!serverUrl || !apiKey) {
    throw new ApiError(NOT_CONFIGURED);
  }

  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      ...init,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(
      `Could not reach the server at ${serverUrl}. Check that it is running and that your phone can reach it.`
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.json()).detail ?? '';
    } catch {
      // non-JSON error body
    }
    if (response.status === 401) {
      throw new ApiError('The server rejected the API key. Check Settings.', 401);
    }
    throw new ApiError(detail || `Server error (HTTP ${response.status})`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A server that predates steps omits the field; never store undefined. */
function normalizeRecipe(raw: Recipe): Recipe {
  return { ...raw, steps: Array.isArray(raw.steps) ? raw.steps : [] };
}

export async function fetchRecipes(): Promise<Recipe[]> {
  const recipes = await request<Recipe[]>('/recipes');
  return recipes.map(normalizeRecipe);
}

/** Idempotent upsert; the server returns the winning copy (last write wins). */
export async function pushRecipe(recipe: Recipe): Promise<Recipe> {
  const saved = await request<Recipe>(`/recipes/${recipe.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: recipe.name,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      updated_at: recipe.updated_at,
    }),
  });
  return normalizeRecipe(saved);
}

/** Idempotent: succeeds even if the recipe is already gone. */
export function pushDelete(id: string): Promise<void> {
  return request(`/recipes/${id}`, { method: 'DELETE' });
}

export const KEEP_NOT_CONFIGURED =
  'Fill in the Google account, master token and note ID under "Google Keep" in Settings first.';

/**
 * When the direct path is enabled the phone talks to Google Keep
 * itself; otherwise the request goes through the server's /keep/add.
 */
export async function addToKeep(items: string[]): Promise<KeepAddResult> {
  const keep = await loadKeepSettings();
  if (keep.enabled) {
    if (!keepConfigured(keep)) throw new ApiError(KEEP_NOT_CONFIGURED);
    try {
      const result = await addShoppingItems(keep, items);
      return {
        added: result.added.length,
        skipped: result.skipped.length,
        skipped_items: result.skipped,
      };
    } catch (e) {
      // Same error type as the server path so callers alert uniformly.
      if (e instanceof KeepError) throw new ApiError(e.message);
      throw e;
    }
  }
  return request('/keep/add', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}
