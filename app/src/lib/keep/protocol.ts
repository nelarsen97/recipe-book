/**
 * TypeScript port of the slice of gpsoauth + gkeepapi the app needs to
 * append items to one Google Keep checklist, so the phone can talk to
 * Keep directly instead of going through the server's /keep/add.
 *
 * Keep has no official API for personal accounts; this mimics the
 * Android Keep app the same way gkeepapi does. Ported from gpsoauth
 * 2.0.0 (perform_oauth) and gkeepapi 0.17.1 (KeepAPI.changes + node
 * serialization). Field names, header shapes and id/timestamp formats
 * are copied verbatim from those libraries — Google's endpoints are
 * picky, so when in doubt match them, not what looks tidy.
 *
 * This module is pure (no I/O, injectable clock/randomness); the fetch
 * calls live in client.ts.
 */

/** Where a master token is exchanged for a short-lived OAuth token. */
export const AUTH_URL = 'https://android.clients.google.com/auth';

/** The endpoint behind gkeepapi's sync: down- and upload in one POST. */
export const CHANGES_URL = 'https://www.googleapis.com/notes/v1/changes';

/** gpsoauth sends this User-Agent on auth requests. */
export const AUTH_USER_AGENT = 'GoogleAuth/1.4';

const OAUTH_SCOPES =
  'oauth2:https://www.googleapis.com/auth/memento https://www.googleapis.com/auth/reminders';
const KEEP_APP = 'com.google.android.keep';
// Signature of the official Keep app's signing certificate.
const KEEP_CLIENT_SIG = '38918a453d07199354f8b19af05ec6562ced5788';

/** gkeepapi's List.SORT_DELTA: spacing between adjacent list items. */
export const SORT_DELTA = 10000;

/**
 * A node as it appears in a /changes response: a note, list, list item
 * or blob. Only the fields the app reads are typed.
 */
export type RawNode = {
  id: string;
  kind?: string;
  type?: string;
  parentId?: string;
  serverId?: string;
  sortValue?: number | string;
  text?: string;
  checked?: boolean;
  title?: string;
  timestamps?: {
    trashed?: string;
    deleted?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ChangesResponse = {
  nodes?: RawNode[];
  toVersion?: string;
  truncated?: boolean;
  forceFullResync?: boolean;
  error?: { code?: number; message?: string };
  [key: string]: unknown;
};

/**
 * Body of the master-token -> OAuth-token exchange, form-encoded.
 * Mirrors gpsoauth.perform_oauth() with the parameters gkeepapi passes
 * (Keep's scopes, app id and client signature).
 */
export function buildOAuthRequestBody(
  email: string,
  masterToken: string,
  deviceId: string
): string {
  const fields: [string, string][] = [
    ['accountType', 'HOSTED_OR_GOOGLE'],
    ['Email', email],
    ['has_permission', '1'],
    ['EncryptedPasswd', masterToken],
    ['service', OAUTH_SCOPES],
    ['source', 'android'],
    ['androidId', deviceId],
    ['app', KEEP_APP],
    ['client_sig', KEEP_CLIENT_SIG],
    ['device_country', 'us'],
    ['operatorCountry', 'us'],
    ['lang', 'en'],
    ['sdk_version', '17'],
    ['google_play_services_version', '240913000'],
  ];
  return fields
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * The auth endpoint answers with key=value lines ("Auth=...\nExpiry=...");
 * on failure the interesting keys are Error and Url.
 */
export function parseAuthResponse(text: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq === -1) data[line] = '';
    else data[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return data;
}

/**
 * Keep's timestamp format: ISO-8601 with *six* fractional digits, as
 * produced by Python's %f in gkeepapi. JS dates only carry millis, so
 * pad with zeros rather than invent precision.
 */
export function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('Z', '000Z');
}

/** gkeepapi node ids: "<epoch ms in hex>.<16 hex digits of randomness>". */
export function generateNodeId(epochMs: number, random: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += Math.floor(random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  }
  return `${epochMs.toString(16)}.${suffix}`;
}

/** gkeepapi session ids: "s--<epoch ms>--<random 10-digit number>". */
export function generateSessionId(
  epochMs: number,
  random: () => number = Math.random
): string {
  const tail = 1000000000 + Math.floor(random() * 9000000000);
  return `s--${epochMs}--${tail}`;
}

/**
 * A brand-new LIST_ITEM node ready for upload, shaped exactly like
 * gkeepapi's ListItem.save() for a fresh unchecked item: default node
 * settings, empty annotations group, no indentation.
 */
export function buildListItemNode(args: {
  id: string;
  noteId: string;
  noteServerId: string | null;
  text: string;
  sortValue: number;
  epochMs: number;
}): RawNode {
  const stamp = formatTimestamp(args.epochMs);
  return {
    id: args.id,
    kind: 'notes#node',
    type: 'LIST_ITEM',
    parentId: args.noteId,
    sortValue: args.sortValue,
    text: args.text,
    timestamps: {
      kind: 'notes#timestamps',
      created: stamp,
      updated: stamp,
      userEdited: stamp,
    },
    nodeSettings: {
      newListItemPlacement: 'BOTTOM',
      graveyardState: 'COLLAPSED',
      checkedListItemsPolicy: 'GRAVEYARD',
    },
    annotationsGroup: { kind: 'notes#annotationsGroup' },
    parentServerId: args.noteServerId,
    superListItemId: null,
    checked: false,
  };
}

/**
 * Body of a /changes POST. Without targetVersion the server sends its
 * full node tree (paginated via truncated/toVersion); with it, only
 * changes since that version. New nodes ride up in `nodes`.
 */
export function buildChangesRequestBody(args: {
  sessionId: string;
  epochMs: number;
  targetVersion?: string;
  nodes?: RawNode[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    nodes: args.nodes ?? [],
    clientTimestamp: formatTimestamp(args.epochMs),
    requestHeader: {
      clientSessionId: args.sessionId,
      clientPlatform: 'ANDROID',
      clientVersion: { major: '9', minor: '9', build: '9', revision: '9' },
      capabilities: [
        { type: 'NC' },
        { type: 'PI' },
        { type: 'LB' },
        { type: 'AN' },
        { type: 'SH' },
        { type: 'DR' },
        { type: 'TR' },
        { type: 'IN' },
        { type: 'SNB' },
        { type: 'MI' },
        { type: 'CO' },
      ],
    },
  };
  if (args.targetVersion !== undefined) {
    body.targetVersion = args.targetVersion;
  }
  return body;
}

/**
 * Active notes still carry trashed/deleted timestamps set to the epoch,
 * so "absent or epoch" means live — same rule as gkeepapi's
 * TimestampsMixin.trashed/deleted.
 */
export function isLive(node: RawNode): boolean {
  const gone = (value?: string) => Boolean(value) && Date.parse(value!) > 0;
  return !gone(node.timestamps?.trashed) && !gone(node.timestamps?.deleted);
}

export type ChecklistLookup =
  | { note: RawNode }
  | { error: 'not_found' | 'not_a_list' | 'trashed' };

/**
 * Find the configured checklist. Users may have copied either the
 * client-side id or the server id, so match both (gkeepapi's Keep.get
 * does the same).
 */
export function findChecklist(nodes: RawNode[], noteId: string): ChecklistLookup {
  const note = nodes.find((n) => n.id === noteId || n.serverId === noteId);
  if (!note) return { error: 'not_found' };
  if (note.type !== 'LIST') return { error: 'not_a_list' };
  if (!isLive(note)) return { error: 'trashed' };
  return { note };
}

/** Live list items belonging to a note, unsorted. */
export function itemsOfList(nodes: RawNode[], note: RawNode): RawNode[] {
  return nodes.filter(
    (n) => n.type === 'LIST_ITEM' && n.parentId === note.id && isLive(n)
  );
}

/**
 * Same dedupe as the server's keep.py: skip anything already unchecked
 * on the note (case-insensitive), and dedupe within the request itself,
 * so repeated taps don't pile up duplicates.
 */
export function planAdditions(
  existingUnchecked: string[],
  requested: string[]
): { toAdd: string[]; skipped: string[] } {
  const existing = new Set(existingUnchecked.map((t) => t.trim().toLowerCase()));
  const toAdd: string[] = [];
  const skipped: string[] = [];
  for (const raw of requested) {
    const text = raw.trim();
    if (!text) continue;
    if (existing.has(text.toLowerCase())) {
      skipped.push(text);
      continue;
    }
    existing.add(text.toLowerCase());
    toAdd.push(text);
  }
  return { toAdd, skipped };
}

/**
 * Sort values for appending at the bottom: each new item sits SORT_DELTA
 * below the current minimum, like gkeepapi's List.add with placement
 * Bottom. An empty list gets a random 10-digit seed (gkeepapi's Node
 * constructor default).
 */
export function bottomSortValues(
  existingItems: RawNode[],
  count: number,
  random: () => number = Math.random
): number[] {
  let floor: number;
  if (existingItems.length === 0) {
    floor = 1000000000 + Math.floor(random() * 9000000000) + SORT_DELTA;
  } else {
    floor = Math.min(...existingItems.map((item) => Number(item.sortValue ?? 0)));
  }
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    floor -= SORT_DELTA;
    values.push(floor);
  }
  return values;
}
