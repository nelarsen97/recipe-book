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

export function fetchRecipes(): Promise<Recipe[]> {
  return request('/recipes');
}

/** Idempotent upsert; the server returns the winning copy (last write wins). */
export function pushRecipe(recipe: Recipe): Promise<Recipe> {
  return request(`/recipes/${recipe.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: recipe.name,
      ingredients: recipe.ingredients,
      updated_at: recipe.updated_at,
    }),
  });
}

/** Idempotent: succeeds even if the recipe is already gone. */
export function pushDelete(id: string): Promise<void> {
  return request(`/recipes/${id}`, { method: 'DELETE' });
}

export function addToKeep(items: string[]): Promise<KeepAddResult> {
  return request('/keep/add', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}
