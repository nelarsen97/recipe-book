import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { ensureSeeded } from '@/lib/store';
import { maybeSync, syncNow } from '@/lib/sync';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  // Seed the bundled defaults on first launch (seeded recipes are marked dirty,
  // so they push on the next sync regardless of ordering here). Sync on app
  // open, and again whenever the app returns to the foreground.
  useEffect(() => {
    ensureSeeded();
    syncNow();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeSync();
    });
    return () => subscription.remove();
  }, []);

  return (
    <KeyboardProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Recipe Book' }} />
        <Stack.Screen name="recipe/[id]" options={{ title: 'Recipe' }} />
        <Stack.Screen name="edit" options={{ title: 'Recipe' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </KeyboardProvider>
  );
}
