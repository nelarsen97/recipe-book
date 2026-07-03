import { loadSettings } from './settings';

export type Recipe = {
  id: number;
  name: string;
  ingredients: string[];
};

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

export function listRecipes(): Promise<Recipe[]> {
  return request('/recipes');
}

export function getRecipe(id: number): Promise<Recipe> {
  return request(`/recipes/${id}`);
}

export function createRecipe(name: string, ingredients: string[]): Promise<Recipe> {
  return request('/recipes', {
    method: 'POST',
    body: JSON.stringify({ name, ingredients }),
  });
}

export function updateRecipe(
  id: number,
  name: string,
  ingredients: string[]
): Promise<Recipe> {
  return request(`/recipes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name, ingredients }),
  });
}

export function deleteRecipe(id: number): Promise<void> {
  return request(`/recipes/${id}`, { method: 'DELETE' });
}

export function addToKeep(items: string[]): Promise<KeepAddResult> {
  return request('/keep/add', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}
