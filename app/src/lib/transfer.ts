import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { Recipe } from '@/lib/store';

/**
 * Reading and writing the recipe-transfer file. The serialization helpers are
 * pure (and unit-tested); the file I/O is a thin, platform-branched wrapper —
 * native uses expo-file-system + the share sheet / document picker, and web
 * (where expo-file-system is unsupported) falls back to a Blob download and a
 * fetch of the picked file.
 */

export const EXPORT_FORMAT = 'recipe-book/export';
export const EXPORT_VERSION = 1;

/** A recipe as it travels in the export file (the sync-only `dirty` flag is dropped). */
export type ExportedRecipe = Pick<Recipe, 'id' | 'name' | 'ingredients' | 'steps' | 'updated_at'>;

export type ExportEnvelope = {
  format: string;
  version: number;
  exported_at: number;
  recipes: ExportedRecipe[];
};

/** A loosely-typed recipe as read back from an untrusted file, before the store normalizes it. */
export type ImportedRecipe = {
  id?: string;
  name?: string;
  ingredients?: unknown;
  steps?: unknown;
};

export function serializeExport(recipes: Recipe[]): string {
  const envelope: ExportEnvelope = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: Date.now(),
    recipes: recipes.map(({ id, name, ingredients, steps, updated_at }) => ({
      id,
      name,
      ingredients,
      steps,
      updated_at,
    })),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Read an export file's contents into a list of recipes. Accepts either a full
 * envelope or a bare array of recipes, and throws a user-facing message when
 * the file is unusable. Entries without a name are dropped (they can't be
 * imported); everything else is left for the store to normalize by UUID.
 */
export function parseImport(text: string): ImportedRecipe[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as ExportEnvelope | null)?.recipes)
      ? (parsed as ExportEnvelope).recipes
      : null;
  if (!list) throw new Error("That file doesn't look like a recipe export.");
  const recipes = list.filter(
    (r): r is ImportedRecipe =>
      !!r && typeof r === 'object' && typeof (r as ImportedRecipe).name === 'string'
  );
  if (recipes.length === 0) throw new Error('That file has no recipes to import.');
  return recipes;
}

function exportFilename(): string {
  return `recipes-${new Date().toISOString().slice(0, 10)}.json`;
}

/** Write the selected recipes to a file and hand it off (share sheet / download). */
export async function exportRecipesToFile(recipes: Recipe[]): Promise<void> {
  const contents = serializeExport(recipes);
  const filename = exportFilename();

  if (Platform.OS === 'web') {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, filename);
  file.write(contents);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Share recipes',
      UTI: 'public.json',
    });
  }
}

/** Let the user pick an export file and return its text, or null if they cancel. */
export async function pickAndReadImportFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const uri = result.assets[0].uri;

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return await response.text();
  }
  return await new File(uri).text();
}
