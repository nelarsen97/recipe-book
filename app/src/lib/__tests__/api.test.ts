import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addToKeep,
  ApiError,
  fetchRecipes,
  NOT_CONFIGURED,
  pushDelete,
  pushRecipe,
} from '@/lib/api';
import { saveSettings } from '@/lib/settings';

const fetchMock = jest.fn();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const configure = () =>
  saveSettings({ serverEnabled: true, serverUrl: 'http://srv:8000', apiKey: 'secret' });

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('when the server is not configured', () => {
  it('rejects without hitting the network', async () => {
    await expect(fetchRecipes()).rejects.toThrow(NOT_CONFIGURED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when only the url is set', async () => {
    await saveSettings({ serverEnabled: true, serverUrl: 'http://srv', apiKey: '' });
    await expect(fetchRecipes()).rejects.toThrow(NOT_CONFIGURED);
  });
});

describe('fetchRecipes', () => {
  it('GETs /recipes with the API key header and returns the parsed body', async () => {
    await configure();
    const recipes = [{ id: '1', name: 'Pancakes', ingredients: [], updated_at: 1 }];
    fetchMock.mockResolvedValue(response(recipes));

    expect(await fetchRecipes()).toEqual(recipes);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://srv:8000/recipes',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'secret' }),
      })
    );
  });
});

describe('error handling', () => {
  beforeEach(configure);

  it('maps 401 to a friendly API-key message', async () => {
    fetchMock.mockResolvedValue(response({}, 401));
    await expect(fetchRecipes()).rejects.toThrow('The server rejected the API key. Check Settings.');
    await expect(fetchRecipes()).rejects.toMatchObject({ status: 401 });
  });

  it('surfaces the server-provided detail message', async () => {
    fetchMock.mockResolvedValue(response({ detail: 'Keep is not connected' }, 503));
    await expect(fetchRecipes()).rejects.toThrow('Keep is not connected');
  });

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(fetchRecipes()).rejects.toThrow('Server error (HTTP 500)');
  });

  it('wraps network failures in a reachability message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const error = await fetchRecipes().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toContain('Could not reach the server at http://srv:8000');
  });
});

describe('pushRecipe', () => {
  it('PUTs the recipe fields to /recipes/:id and returns the winning copy', async () => {
    await configure();
    const recipe = { id: 'r1', name: 'Tacos', ingredients: ['beef'], updated_at: 42, dirty: true };
    const accepted = { id: 'r1', name: 'Tacos', ingredients: ['beef'], updated_at: 42 };
    fetchMock.mockResolvedValue(response(accepted));

    expect(await pushRecipe(recipe)).toEqual(accepted);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://srv:8000/recipes/r1');
    expect(init.method).toBe('PUT');
    // dirty is client bookkeeping and must not leak to the server
    expect(JSON.parse(init.body)).toEqual({ name: 'Tacos', ingredients: ['beef'], updated_at: 42 });
  });
});

describe('pushDelete', () => {
  it('DELETEs and resolves on a 204 with no body', async () => {
    await configure();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('204 has no body');
      },
    });
    await expect(pushDelete('r1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://srv:8000/recipes/r1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('addToKeep', () => {
  it('POSTs the items to /keep/add', async () => {
    await configure();
    const result = { added: 2, skipped: 0, skipped_items: [] };
    fetchMock.mockResolvedValue(response(result));

    expect(await addToKeep(['flour', 'milk'])).toEqual(result);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://srv:8000/keep/add');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ items: ['flour', 'milk'] });
  });
});
