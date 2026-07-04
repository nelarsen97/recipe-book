import { ApiError, fetchRecipes, pushDelete, pushRecipe } from './api';
import { loadSettings } from './settings';
import {
  clearPendingDelete,
  dirtyRecipes,
  markSynced,
  mergeServerRecipes,
  pendingCount,
  pendingDeletes,
} from './store';

export type SyncResult = {
  ok: boolean;
  /** Local changes still waiting to reach the server after this attempt. */
  pending: number;
  error?: string;
};

let inFlight: Promise<SyncResult> | null = null;
let lastAttempt = 0;

/**
 * Pull the server's recipes, merge them into the local store (last
 * write wins), then push local changes: dirty upserts and queued
 * deletes. Safe to call often — concurrent calls share one run.
 */
export function syncNow(): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Throttled variant for automatic triggers (app open / foreground). */
export function maybeSync(minIntervalMs = 15_000): Promise<SyncResult> | null {
  if (!inFlight && Date.now() - lastAttempt < minIntervalMs) return null;
  return syncNow();
}

async function run(): Promise<SyncResult> {
  lastAttempt = Date.now();

  // Local-only mode: leave dirty flags in place so everything syncs
  // if the server connection is enabled later.
  if (!(await loadSettings()).serverEnabled) {
    return { ok: true, pending: 0 };
  }

  try {
    // Pull. Merging keeps local unsynced work (see mergeServerRecipes).
    await mergeServerRecipes(await fetchRecipes());

    // Push local changes. One failure shouldn't strand the rest.
    let error: string | undefined;
    for (const recipe of await dirtyRecipes()) {
      try {
        await markSynced(await pushRecipe(recipe));
      } catch (e) {
        error = e instanceof ApiError ? e.message : String(e);
      }
    }
    for (const id of await pendingDeletes()) {
      try {
        await pushDelete(id);
        await clearPendingDelete(id);
      } catch (e) {
        error = e instanceof ApiError ? e.message : String(e);
      }
    }

    return { ok: !error, pending: await pendingCount(), error };
  } catch (e) {
    return {
      ok: false,
      pending: await pendingCount(),
      error: e instanceof ApiError ? e.message : String(e),
    };
  }
}
