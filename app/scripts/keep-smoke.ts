/**
 * Prove the on-device Keep protocol against real Google endpoints
 * without building the app. Run it with bun from app/:
 *
 *   # sanity-check auth + sync, and print your checklists with ids
 *   bun scripts/keep-smoke.ts --email you@gmail.com --token "aas_et/..."
 *
 *   # the full recipe-screen flow: append items to a checklist
 *   bun scripts/keep-smoke.ts --email you@gmail.com --token "aas_et/..." \
 *     --note-id <id from the listing> --add "1 test item from keep-smoke"
 *
 * The master token comes from server/get_master_token.py. Note: Google
 * fingerprints TLS clients on the auth endpoint; if this script gets
 * BadAuthentication with a token that works elsewhere, the token may
 * still be fine on the phone — Android's TLS stack is what Google
 * expects to see. (gpsoauth ships cipher workarounds for Python for the
 * same reason.)
 */
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
} from '../src/lib/keep/protocol';

// Same constant the server uses; any stable id works for this flow.
const DEVICE_ID = 'recipe0123456789';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
  throw new Error(message); // unreachable; process is untyped in this tsconfig
}

async function main() {
  const email = arg('email');
  const token = arg('token');
  const noteId = arg('note-id');
  const add = (process.argv as string[]).flatMap((value: string, index: number) =>
    process.argv[index - 1] === '--add' ? [value] : []
  );
  if (!email || !token) {
    fail('usage: bun scripts/keep-smoke.ts --email <email> --token <master token> [--note-id <id> --add "<item>" [--add ...]]');
  }

  console.log('1) Exchanging the master token for an OAuth token...');
  const authResponse = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': AUTH_USER_AGENT,
    },
    body: buildOAuthRequestBody(email, token, DEVICE_ID),
  });
  const auth = parseAuthResponse(await authResponse.text());
  if (!auth.Auth) {
    fail(`token exchange failed: ${auth.Error ?? `HTTP ${authResponse.status}`}`);
  }
  console.log('   ✓ got an OAuth token');

  const sessionId = generateSessionId(Date.now());
  const post = async (body: Record<string, unknown>): Promise<ChangesResponse> => {
    const response = await fetch(CHANGES_URL, {
      method: 'POST',
      headers: { Authorization: `OAuth ${auth.Auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json()) as ChangesResponse;
    if (parsed.error) fail(`Keep sync failed: ${JSON.stringify(parsed.error)}`);
    return parsed;
  };

  console.log('2) Downloading the note tree...');
  const collected = new Map<string, RawNode>();
  let version: string | undefined;
  for (;;) {
    const page = await post(
      buildChangesRequestBody({ sessionId, epochMs: Date.now(), targetVersion: version })
    );
    for (const node of page.nodes ?? []) {
      if (node.parentId) collected.set(node.id, node);
      else collected.delete(node.id);
    }
    version = page.toVersion;
    if (!page.truncated) break;
  }
  const nodes = [...collected.values()];
  console.log(`   ✓ ${nodes.length} nodes at version ${version}`);

  if (!noteId || add.length === 0) {
    console.log('\nYour checklists (pass one as --note-id to test appending):\n');
    for (const note of nodes) {
      if (note.type !== 'LIST' || note.parentId !== 'root' || !isLive(note)) continue;
      const unchecked = itemsOfList(nodes, note).filter((item) => !item.checked).length;
      console.log(`   ${note.id}   ${note.title || '(untitled)'} — ${unchecked} unchecked`);
    }
    return;
  }

  console.log(`3) Appending ${add.length} item(s) to ${noteId}...`);
  const lookup = findChecklist(nodes, noteId);
  if ('error' in lookup) fail(`note lookup: ${lookup.error}`);
  const items = itemsOfList(nodes, lookup.note);
  const unchecked = items.filter((item) => !item.checked).map((item) => item.text ?? '');
  const { toAdd, skipped } = planAdditions(unchecked, add);
  if (skipped.length) console.log(`   skipping (already on the list): ${skipped.join(', ')}`);
  if (toAdd.length === 0) {
    console.log('   nothing to add');
    return;
  }
  const now = Date.now();
  const sorts = bottomSortValues(items, toAdd.length);
  await post(
    buildChangesRequestBody({
      sessionId,
      epochMs: now,
      targetVersion: version,
      nodes: toAdd.map((text, index) =>
        buildListItemNode({
          id: generateNodeId(now + index),
          noteId: lookup.note.id,
          noteServerId: lookup.note.serverId ?? null,
          text,
          sortValue: sorts[index],
          epochMs: now,
        })
      ),
    })
  );
  console.log(`   ✓ added: ${toAdd.join(', ')}`);
  console.log('\nOpen Google Keep and check the list — the items should be at the bottom.');
}

main().catch((error) => fail(String(error)));
