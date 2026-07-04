/**
 * TEMPORARY diagnostic — remove once we know whether Google Keep handles the
 * CREATE_ITEM_LIST intent. Android-only; renders nothing elsewhere.
 *
 * The question we're answering: can we hand Keep a ready-made checklist (one
 * checkbox per ingredient) via an Android intent, instead of the copy/paste
 * dance? Google documents CREATE_ITEM_LIST for exactly this, but it dates to
 * the old Search-Actions era and there's no proof Keep still listens for it.
 *
 * Each button fires one intent and reports what happened:
 *   1. CREATE_ITEM_LIST → Keep      — the one we actually want.
 *   2. CREATE_ITEM_LIST → (chooser) — does ANY installed app claim it?
 *   3. CREATE_NOTE → Keep           — control: Keep IS documented to handle
 *                                     this, so it should open a plain note.
 *                                     Proves our intent plumbing works.
 *
 * A rejected promise means no activity claimed the intent (dead end). If #1
 * opens Keep with the right title but no items, that's the extra-typing caveat
 * (expo-intent-launcher sends the array as a serializable list, not a String[])
 * and the fix is a small native module.
 */
import * as IntentLauncher from 'expo-intent-launcher';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/theme';

const A = {
  CREATE_ITEM_LIST: 'com.google.android.gms.actions.CREATE_ITEM_LIST',
  CREATE_NOTE: 'com.google.android.gms.actions.CREATE_NOTE',
  LIST_NAME: 'com.google.android.gms.actions.extra.LIST_NAME',
  ITEM_NAMES: 'com.google.android.gms.actions.extra.ITEM_NAMES',
  NAME: 'com.google.android.gms.actions.extra.NAME',
  TEXT: 'com.google.android.gms.actions.extra.TEXT',
  KEEP_PKG: 'com.google.android.keep',
};

async function fire(label: string, action: string, params: IntentLauncher.IntentLauncherParams) {
  try {
    const res = await IntentLauncher.startActivityAsync(action, params);
    Alert.alert(`${label}: opened`, `An app handled it (resultCode ${res.resultCode}).`);
  } catch (e) {
    Alert.alert(`${label}: NOT handled`, String(e));
  }
}

export default function KeepIntentTest({ listName, items }: { listName: string; items: string[] }) {
  if (Platform.OS !== 'android') return null;

  const button = (label: string, onPress: () => void) => (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>🧪 Keep intent test ({items.length} items)</Text>
      {button('1. CREATE_ITEM_LIST → Keep', () =>
        fire('Item list (Keep)', A.CREATE_ITEM_LIST, {
          packageName: A.KEEP_PKG,
          extra: { [A.LIST_NAME]: listName, [A.ITEM_NAMES]: items },
        })
      )}
      {button('2. CREATE_ITEM_LIST → any app', () =>
        fire('Item list (chooser)', A.CREATE_ITEM_LIST, {
          extra: { [A.LIST_NAME]: listName, [A.ITEM_NAMES]: items },
        })
      )}
      {button('3. CREATE_NOTE → Keep (control)', () =>
        fire('Note (Keep)', A.CREATE_NOTE, {
          packageName: A.KEEP_PKG,
          type: 'text/plain',
          extra: { [A.NAME]: listName, [A.TEXT]: items.join('\n') },
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    gap: 8,
  },
  heading: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  button: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
