import {
  buildChangesRequestBody,
  buildListItemNode,
  buildOAuthRequestBody,
  bottomSortValues,
  findChecklist,
  formatTimestamp,
  generateNodeId,
  generateSessionId,
  isLive,
  itemsOfList,
  parseAuthResponse,
  planAdditions,
  RawNode,
} from '@/lib/keep/protocol';

// Keep's servers reject requests that don't look like the Android app,
// so these tests pin the exact wire shapes ported from gpsoauth 2.0.0
// and gkeepapi 0.17.1.

describe('buildOAuthRequestBody', () => {
  it('carries the master token and the Keep app identity', () => {
    const body = buildOAuthRequestBody('me@gmail.com', 'aas_et/TOKEN+/=', 'abcdef1234567890');
    const fields = Object.fromEntries(new URLSearchParams(body));

    expect(fields).toEqual({
      accountType: 'HOSTED_OR_GOOGLE',
      Email: 'me@gmail.com',
      has_permission: '1',
      EncryptedPasswd: 'aas_et/TOKEN+/=',
      service:
        'oauth2:https://www.googleapis.com/auth/memento https://www.googleapis.com/auth/reminders',
      source: 'android',
      androidId: 'abcdef1234567890',
      app: 'com.google.android.keep',
      client_sig: '38918a453d07199354f8b19af05ec6562ced5788',
      device_country: 'us',
      operatorCountry: 'us',
      lang: 'en',
      sdk_version: '17',
      google_play_services_version: '240913000',
    });
  });

  it('escapes reserved characters in values', () => {
    const body = buildOAuthRequestBody('a+b@gmail.com', 'tok&en=1', 'id');
    expect(body).toContain('Email=a%2Bb%40gmail.com');
    expect(body).toContain('EncryptedPasswd=tok%26en%3D1');
  });
});

describe('parseAuthResponse', () => {
  it('parses key=value lines, keeping "=" inside values', () => {
    expect(parseAuthResponse('Auth=ya29.a=b=c\nExpiry=1234\n\nissueAdvice=auto')).toEqual({
      Auth: 'ya29.a=b=c',
      Expiry: '1234',
      issueAdvice: 'auto',
    });
  });

  it('surfaces error responses', () => {
    expect(parseAuthResponse('Error=BadAuthentication\nUrl=https://x')).toEqual({
      Error: 'BadAuthentication',
      Url: 'https://x',
    });
  });
});

describe('formatTimestamp', () => {
  it('renders six fractional digits like Python strftime %f', () => {
    expect(formatTimestamp(0)).toBe('1970-01-01T00:00:00.000000Z');
    expect(formatTimestamp(1751700000123)).toBe('2025-07-05T07:20:00.123000Z');
  });
});

describe('id generation', () => {
  it('node ids are "<hex millis>.<16 hex digits>"', () => {
    const id = generateNodeId(0x18cba99, () => 0.5);
    expect(id).toMatch(/^18cba99\.[0-9a-f]{16}$/);
  });

  it('session ids are "s--<millis>--<10 digits>"', () => {
    expect(generateSessionId(1700000000000, () => 0)).toBe('s--1700000000000--1000000000');
    expect(generateSessionId(1, () => 0.999999999)).toMatch(/^s--1--9\d{9}$/);
  });
});

describe('buildListItemNode', () => {
  it('matches gkeepapi ListItem.save() for a fresh unchecked item', () => {
    const node = buildListItemNode({
      id: 'abc.def',
      noteId: 'note-1',
      noteServerId: 'srv-1',
      text: '200g tomato',
      sortValue: -10000,
      epochMs: 0,
    });

    expect(node).toEqual({
      id: 'abc.def',
      kind: 'notes#node',
      type: 'LIST_ITEM',
      parentId: 'note-1',
      sortValue: -10000,
      text: '200g tomato',
      timestamps: {
        kind: 'notes#timestamps',
        created: '1970-01-01T00:00:00.000000Z',
        updated: '1970-01-01T00:00:00.000000Z',
        userEdited: '1970-01-01T00:00:00.000000Z',
      },
      nodeSettings: {
        newListItemPlacement: 'BOTTOM',
        graveyardState: 'COLLAPSED',
        checkedListItemsPolicy: 'GRAVEYARD',
      },
      annotationsGroup: { kind: 'notes#annotationsGroup' },
      parentServerId: 'srv-1',
      superListItemId: null,
      checked: false,
    });
  });
});

describe('buildChangesRequestBody', () => {
  it('builds the ANDROID request header with the capability list', () => {
    const body = buildChangesRequestBody({ sessionId: 's--1--2', epochMs: 0 });

    expect(body.nodes).toEqual([]);
    expect(body.clientTimestamp).toBe('1970-01-01T00:00:00.000000Z');
    expect(body).not.toHaveProperty('targetVersion');
    const header = body.requestHeader as Record<string, unknown>;
    expect(header.clientSessionId).toBe('s--1--2');
    expect(header.clientPlatform).toBe('ANDROID');
    expect(header.clientVersion).toEqual({ major: '9', minor: '9', build: '9', revision: '9' });
    expect(header.capabilities).toEqual(
      ['NC', 'PI', 'LB', 'AN', 'SH', 'DR', 'TR', 'IN', 'SNB', 'MI', 'CO'].map((type) => ({ type }))
    );
  });

  it('includes targetVersion and upload nodes when given', () => {
    const node = { id: 'n' } as RawNode;
    const body = buildChangesRequestBody({
      sessionId: 's',
      epochMs: 0,
      targetVersion: 'v42',
      nodes: [node],
    });
    expect(body.targetVersion).toBe('v42');
    expect(body.nodes).toEqual([node]);
  });
});

describe('isLive', () => {
  it('treats epoch trashed/deleted stamps as live (Keep sends those on active notes)', () => {
    expect(
      isLive({ id: 'a', timestamps: { trashed: '1970-01-01T00:00:00.000Z' } })
    ).toBe(true);
    expect(isLive({ id: 'a' })).toBe(true);
  });

  it('treats real trashed or deleted stamps as gone', () => {
    expect(isLive({ id: 'a', timestamps: { trashed: '2026-01-01T00:00:00.000000Z' } })).toBe(false);
    expect(isLive({ id: 'a', timestamps: { deleted: '2026-01-01T00:00:00.000000Z' } })).toBe(false);
  });
});

const shoppingList: RawNode = {
  id: 'note-1',
  serverId: 'srv-1',
  type: 'LIST',
  parentId: 'root',
  title: 'Shopping',
};

describe('findChecklist', () => {
  const plainNote: RawNode = { id: 'note-2', serverId: 'srv-2', type: 'NOTE', parentId: 'root' };

  it('matches by client id or server id', () => {
    expect(findChecklist([plainNote, shoppingList], 'note-1')).toEqual({ note: shoppingList });
    expect(findChecklist([shoppingList], 'srv-1')).toEqual({ note: shoppingList });
  });

  it('reports missing, non-list and trashed notes distinctly', () => {
    expect(findChecklist([shoppingList], 'nope')).toEqual({ error: 'not_found' });
    expect(findChecklist([plainNote], 'note-2')).toEqual({ error: 'not_a_list' });
    const trashed = { ...shoppingList, timestamps: { trashed: '2026-01-01T00:00:00.000000Z' } };
    expect(findChecklist([trashed], 'note-1')).toEqual({ error: 'trashed' });
  });
});

describe('itemsOfList', () => {
  it('returns live LIST_ITEM children of the note only', () => {
    const mine: RawNode = { id: 'i1', type: 'LIST_ITEM', parentId: 'note-1', text: 'milk' };
    const deleted: RawNode = {
      id: 'i2',
      type: 'LIST_ITEM',
      parentId: 'note-1',
      timestamps: { deleted: '2026-01-01T00:00:00.000000Z' },
    };
    const otherNote: RawNode = { id: 'i3', type: 'LIST_ITEM', parentId: 'note-9' };
    expect(itemsOfList([mine, deleted, otherNote, shoppingList], shoppingList)).toEqual([mine]);
  });
});

describe('planAdditions', () => {
  it('skips items already unchecked on the note, case-insensitively', () => {
    expect(planAdditions(['Milk ', 'eggs'], ['milk', '2 Eggs', 'butter'])).toEqual({
      toAdd: ['2 Eggs', 'butter'],
      skipped: ['milk'],
    });
  });

  it('drops blanks and dedupes within one request', () => {
    expect(planAdditions([], ['salt', ' ', 'Salt', ''])).toEqual({
      toAdd: ['salt'],
      skipped: ['Salt'],
    });
  });
});

describe('bottomSortValues', () => {
  it('steps SORT_DELTA below the current minimum for each new item', () => {
    const items: RawNode[] = [
      { id: 'a', sortValue: 30000 },
      { id: 'b', sortValue: '20000' }, // Keep serializes sort values as strings
    ];
    expect(bottomSortValues(items, 3)).toEqual([10000, 0, -10000]);
  });

  it('seeds an empty list with a random 10-digit value like gkeepapi', () => {
    expect(bottomSortValues([], 2, () => 0)).toEqual([1000000000, 1000000000 - 10000]);
  });
});
