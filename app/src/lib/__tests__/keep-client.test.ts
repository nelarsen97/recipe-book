import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addShoppingItems,
  clearKeepSession,
  fetchChecklists,
  KeepError,
} from '@/lib/keep/client';
import { AUTH_URL, CHANGES_URL, RawNode } from '@/lib/keep/protocol';

const fetchMock = jest.fn();
(globalThis as { fetch: unknown }).fetch = fetchMock;

const creds = { email: 'me@gmail.com', masterToken: 'aas_et/tok', noteId: 'note-1' };

const authOk = { text: async () => 'Auth=oauth-token-1\nExpiry=9999999999' };
const json = (body: unknown, status = 200) => ({ status, json: async () => body });

// The epoch trashed stamp is what Keep sends on live notes.
const live = { trashed: '1970-01-01T00:00:00.000Z' };
const accountNodes: RawNode[] = [
  {
    id: 'note-1',
    serverId: 'srv-1',
    type: 'LIST',
    parentId: 'root',
    title: 'Shopping',
    timestamps: live,
  },
  {
    id: 'item-milk',
    type: 'LIST_ITEM',
    parentId: 'note-1',
    text: 'Milk',
    checked: false,
    sortValue: '20000',
    timestamps: live,
  },
  {
    id: 'item-eggs',
    type: 'LIST_ITEM',
    parentId: 'note-1',
    text: 'eggs',
    checked: true,
    sortValue: 30000,
    timestamps: live,
  },
  { id: 'note-2', serverId: 'srv-2', type: 'NOTE', parentId: 'root', title: 'Ideas' },
];

/** Auth always succeeds; /changes downloads the account and accepts uploads. */
function mockHappyBackend(nodes: RawNode[] = accountNodes) {
  const uploads: Record<string, unknown>[] = [];
  fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
    if (url === AUTH_URL) return authOk;
    if (url === CHANGES_URL) {
      const body = JSON.parse(init.body);
      if ((body.nodes as unknown[]).length > 0) {
        uploads.push(body);
        return json({ toVersion: 'v2', truncated: false, nodes: [] });
      }
      return json({ toVersion: 'v1', truncated: false, nodes });
    }
    throw new Error(`unexpected url ${url}`);
  });
  return uploads;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  clearKeepSession();
  fetchMock.mockReset();
});

describe('addShoppingItems', () => {
  it('appends new items below the list and skips ones already unchecked', async () => {
    const uploads = mockHappyBackend();

    const result = await addShoppingItems(creds, ['milk', '2 eggs', 'butter']);

    expect(result).toEqual({ added: ['2 eggs', 'butter'], skipped: ['milk'] });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].targetVersion).toBe('v1');
    const sent = uploads[0].nodes as RawNode[];
    expect(sent.map((n) => n.text)).toEqual(['2 eggs', 'butter']);
    for (const node of sent) {
      expect(node.type).toBe('LIST_ITEM');
      expect(node.parentId).toBe('note-1');
      expect(node.parentServerId).toBe('srv-1');
      expect(node.checked).toBe(false);
    }
    // Bottom placement: below the current minimum (20000), stepping by 10000.
    expect(sent.map((n) => n.sortValue)).toEqual([10000, 0]);
  });

  it('does not upload anything when every item is already on the list', async () => {
    const uploads = mockHappyBackend();

    const result = await addShoppingItems(creds, ['MILK ']);

    expect(result).toEqual({ added: [], skipped: ['MILK'] });
    expect(uploads).toHaveLength(0);
  });

  it('sends the master token to the auth endpoint and the OAuth token to Keep', async () => {
    mockHappyBackend();

    await addShoppingItems(creds, ['butter']);

    const authCall = fetchMock.mock.calls.find(([url]) => url === AUTH_URL);
    expect(authCall[1].body).toContain('EncryptedPasswd=aas_et%2Ftok');
    expect(authCall[1].body).toContain('Email=me%40gmail.com');
    const changesCall = fetchMock.mock.calls.find(([url]) => url === CHANGES_URL);
    expect(changesCall[1].headers.Authorization).toBe('OAuth oauth-token-1');
  });

  it('reuses the OAuth token across calls instead of re-authenticating', async () => {
    mockHappyBackend();

    await addShoppingItems(creds, ['butter']);
    await addShoppingItems(creds, ['flour']);

    expect(fetchMock.mock.calls.filter(([url]) => url === AUTH_URL)).toHaveLength(1);
  });

  it('re-authenticates once when Keep reports an expired token', async () => {
    let changesCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AUTH_URL) return authOk;
      changesCalls += 1;
      if (changesCalls === 1) return json({ error: { code: 401, message: 'expired' } });
      return json({ toVersion: 'v1', truncated: false, nodes: accountNodes });
    });

    const result = await addShoppingItems(creds, ['milk']);

    expect(result.skipped).toEqual(['milk']);
    expect(fetchMock.mock.calls.filter(([url]) => url === AUTH_URL)).toHaveLength(2);
  });

  it('follows truncated pagination until the full tree has arrived', async () => {
    const pages = [
      json({ toVersion: 'v-page1', truncated: true, nodes: [accountNodes[0]] }),
      json({ toVersion: 'v-page2', truncated: false, nodes: accountNodes.slice(1) }),
    ];
    const downloadBodies: Record<string, unknown>[] = [];
    const uploads: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
      if (url === AUTH_URL) return authOk;
      const body = JSON.parse(init.body);
      if ((body.nodes as unknown[]).length > 0) {
        uploads.push(body);
        return json({ toVersion: 'v3', truncated: false, nodes: [] });
      }
      downloadBodies.push(body);
      return pages.shift();
    });

    await addShoppingItems(creds, ['butter']);

    expect(downloadBodies).toHaveLength(2);
    expect(downloadBodies[0]).not.toHaveProperty('targetVersion');
    expect(downloadBodies[1].targetVersion).toBe('v-page1');
    expect(uploads[0].targetVersion).toBe('v-page2');
  });

  it('explains a rejected master token', async () => {
    fetchMock.mockResolvedValue({ text: async () => 'Error=BadAuthentication' });

    await expect(addShoppingItems(creds, ['x'])).rejects.toThrow(
      'Google rejected the master token'
    );
  });

  it('explains an unreachable network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(addShoppingItems(creds, ['x'])).rejects.toThrow('Could not reach Google');
  });

  it('reports rate limiting in plain words', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === AUTH_URL ? authOk : json({ error: { code: 429, message: 'rateLimitExceeded' } })
    );

    await expect(addShoppingItems(creds, ['x'])).rejects.toThrow('rate-limiting');
  });

  it.each([
    ['nope', 'was not found in this account'],
    ['note-2', 'is a plain note, not a checklist'],
  ])('reports a bad note id (%s)', async (noteId, message) => {
    mockHappyBackend();

    await expect(addShoppingItems({ ...creds, noteId }, ['x'])).rejects.toThrow(message);
  });

  it('reports a trashed shopping list', async () => {
    mockHappyBackend([
      { ...accountNodes[0], timestamps: { trashed: '2026-01-01T00:00:00.000000Z' } },
    ]);

    await expect(addShoppingItems(creds, ['x'])).rejects.toThrow('is in the trash');
  });

  it('throws KeepError instances so callers can tell Keep failures apart', async () => {
    fetchMock.mockRejectedValue(new TypeError('down'));

    await expect(addShoppingItems(creds, ['x'])).rejects.toBeInstanceOf(KeepError);
  });
});

describe('fetchChecklists', () => {
  it('lists live checklists with unchecked counts, skipping plain/archived/trashed notes', async () => {
    mockHappyBackend([
      ...accountNodes,
      {
        id: 'note-3',
        type: 'LIST',
        parentId: 'root',
        title: 'Archive me',
        isArchived: true,
        timestamps: live,
      },
      {
        id: 'note-4',
        type: 'LIST',
        parentId: 'root',
        title: 'Binned',
        timestamps: { trashed: '2026-01-01T00:00:00.000000Z' },
      },
      { id: 'note-5', type: 'LIST', parentId: 'root', title: '', timestamps: live },
    ]);

    expect(await fetchChecklists({ email: creds.email, masterToken: creds.masterToken })).toEqual([
      { id: 'note-5', title: '(untitled)', uncheckedCount: 0 },
      { id: 'note-1', title: 'Shopping', uncheckedCount: 1 },
    ]);
  });
});
