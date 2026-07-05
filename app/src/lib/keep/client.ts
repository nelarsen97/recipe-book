/**
 * On-device Google Keep client: exchanges the master token for a
 * short-lived OAuth token, pulls the account's note tree and appends
 * shopping items to the configured checklist. The request/response
 * shapes live in protocol.ts; this file owns fetch, caching and error
 * wording.
 *
 * The OAuth token is cached in memory only — a fresh exchange per app
 * start matches what the real Keep app does, and nothing derived from
 * the master token is ever written to disk by this module.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  AUTH_URL,
  AUTH_USER_AGENT,
  buildChangesRequestBody,
  buildListItemNode,
  buildOAuthRequestBody,
  bottomSortValues,
  CHANGES_URL,
  ChangesResponse,
  findChecklist,
  generateNodeId,
  generateSessionId,
  isLive,
  itemsOfList,
  parseAuthResponse,
  planAdditions,
  RawNode,
} from './protocol';

/** A Keep failure with a message fit for an alert. */
export class KeepError extends Error {
  readonly name = 'KeepError';
}

export type KeepCredentials = {
  email: string;
  masterToken: string;
  noteId: string;
};

export type ChecklistSummary = {
  id: string;
  title: string;
  uncheckedCount: number;
};

const DEVICE_ID_KEY = 'recipe-book/keep-device-id';

const UNREACHABLE =
  'Could not reach Google. Check that this device is online.';

/**
 * Any stable hex string works as the "android id" for this flow (the
 * server uses a hard-coded one); generate one per install so Google
 * sees a consistent device.
 */
async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

function authFailureMessage(error: string | undefined): string {
  if (error === 'BadAuthentication') {
    return (
      'Google rejected the master token. Redo the master-token setup ' +
      '(get_master_token.py) and paste the new token into Settings.'
    );
  }
  if (error === 'NeedsBrowser' || error === 'DeviceManagementRequiredOrSyncDisabled') {
    return `Google requires re-verification in a browser (${error}). Redo the master-token setup.`;
  }
  return error
    ? `Google sign-in failed (${error}).`
    : 'Google sign-in failed: no token in the response.';
}

// OAuth token cache, in memory only. Keyed on the credentials so a
// token obtained for an old email/master token is never reused.
let session: { token: string; expiresAt: number; key: string } | null = null;

/** Test hook: forget the cached OAuth token. */
export function clearKeepSession(): void {
  session = null;
}

async function obtainAuthToken(
  creds: KeepCredentials,
  deviceId: string,
  force = false
): Promise<string> {
  const key = `${creds.email}\n${creds.masterToken}\n${deviceId}`;
  if (!force && session && session.key === key && Date.now() < session.expiresAt) {
    return session.token;
  }

  let text: string;
  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': AUTH_USER_AGENT,
      },
      body: buildOAuthRequestBody(creds.email, creds.masterToken, deviceId),
    });
    text = await response.text();
  } catch {
    throw new KeepError(UNREACHABLE);
  }

  const data = parseAuthResponse(text);
  if (!data.Auth) {
    throw new KeepError(authFailureMessage(data.Error));
  }

  session = {
    token: data.Auth,
    // Expiry is epoch seconds; fall back to 50 minutes, refreshed on 401.
    expiresAt: data.Expiry ? Number(data.Expiry) * 1000 : Date.now() + 50 * 60 * 1000,
    key,
  };
  return session.token;
}

async function postChanges(
  authToken: string,
  body: Record<string, unknown>
): Promise<ChangesResponse> {
  let response: Response;
  try {
    response = await fetch(CHANGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new KeepError(UNREACHABLE);
  }
  try {
    return (await response.json()) as ChangesResponse;
  } catch {
    throw new KeepError(`Google Keep sync failed (HTTP ${response.status}).`);
  }
}

/**
 * POST to /changes, transparently refreshing the OAuth token once if
 * Google says it expired (mirrors gkeepapi's retry-on-401).
 */
async function sendChanges(
  creds: KeepCredentials,
  deviceId: string,
  body: Record<string, unknown>
): Promise<ChangesResponse> {
  let authToken = await obtainAuthToken(creds, deviceId);
  let result = await postChanges(authToken, body);
  if (result.error?.code === 401) {
    authToken = await obtainAuthToken(creds, deviceId, true);
    result = await postChanges(authToken, body);
  }
  if (result.error) {
    const { code, message } = result.error;
    if (code === 429) {
      throw new KeepError('Google Keep is rate-limiting requests. Wait a minute and try again.');
    }
    throw new KeepError(`Google Keep sync failed (${message || `error ${code}`}).`);
  }
  return result;
}

/**
 * Download the full node tree. Kept stateless on purpose: a personal
 * account syncs in a request or two, and starting from scratch each
 * time sidesteps every cache-consistency edge the server's gkeepapi
 * state file exists to manage.
 */
async function fetchAllNodes(
  creds: KeepCredentials,
  deviceId: string,
  sessionId: string
): Promise<{ nodes: RawNode[]; version: string | undefined }> {
  const collected = new Map<string, RawNode>();
  let version: string | undefined;
  for (;;) {
    const response = await sendChanges(
      creds,
      deviceId,
      buildChangesRequestBody({
        sessionId,
        epochMs: Date.now(),
        targetVersion: version,
      })
    );
    for (const node of response.nodes ?? []) {
      // A node without parentId is a deletion tombstone.
      if (node.parentId) collected.set(node.id, node);
      else collected.delete(node.id);
    }
    version = response.toVersion;
    if (!response.truncated) break;
  }
  return { nodes: [...collected.values()], version };
}

function describeLookupError(error: 'not_found' | 'not_a_list' | 'trashed', noteId: string): string {
  switch (error) {
    case 'not_found':
      return `Keep note "${noteId}" was not found in this account.`;
    case 'not_a_list':
      return `Keep note "${noteId}" is a plain note, not a checklist.`;
    case 'trashed':
      return `Keep note "${noteId}" is in the trash.`;
  }
}

/**
 * Append items as unchecked checkboxes to the configured checklist,
 * skipping anything already unchecked on it — the same behavior as the
 * server's /keep/add.
 */
export async function addShoppingItems(
  creds: KeepCredentials,
  items: string[]
): Promise<{ added: string[]; skipped: string[] }> {
  const deviceId = await getDeviceId();
  const sessionId = generateSessionId(Date.now());

  const { nodes, version } = await fetchAllNodes(creds, deviceId, sessionId);
  const lookup = findChecklist(nodes, creds.noteId);
  if ('error' in lookup) {
    throw new KeepError(describeLookupError(lookup.error, creds.noteId));
  }

  const listItems = itemsOfList(nodes, lookup.note);
  const unchecked = listItems.filter((item) => !item.checked).map((item) => item.text ?? '');
  const { toAdd, skipped } = planAdditions(unchecked, items);

  if (toAdd.length > 0) {
    const now = Date.now();
    const sorts = bottomSortValues(listItems, toAdd.length);
    const newNodes = toAdd.map((text, index) =>
      buildListItemNode({
        id: generateNodeId(now + index),
        noteId: lookup.note.id,
        noteServerId: lookup.note.serverId ?? null,
        text,
        sortValue: sorts[index],
        epochMs: now,
      })
    );
    const response = await sendChanges(
      creds,
      deviceId,
      buildChangesRequestBody({
        sessionId,
        epochMs: now,
        targetVersion: version,
        nodes: newNodes,
      })
    );
    if (response.forceFullResync) {
      throw new KeepError('Google Keep asked for a resync. Try again.');
    }
  }

  return { added: toAdd, skipped };
}

/**
 * All live checklists in the account, for picking the shopping list in
 * Settings (saves hand-copying a 40-character note id to the phone).
 */
export async function fetchChecklists(
  creds: Omit<KeepCredentials, 'noteId'>
): Promise<ChecklistSummary[]> {
  const deviceId = await getDeviceId();
  const sessionId = generateSessionId(Date.now());
  const { nodes } = await fetchAllNodes({ ...creds, noteId: '' }, deviceId, sessionId);

  return nodes
    .filter(
      (node) =>
        node.type === 'LIST' &&
        node.parentId === 'root' &&
        node.isArchived !== true &&
        isLive(node)
    )
    .map((note) => ({
      id: note.id,
      title: note.title || '(untitled)',
      uncheckedCount: itemsOfList(nodes, note).filter((item) => !item.checked).length,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
