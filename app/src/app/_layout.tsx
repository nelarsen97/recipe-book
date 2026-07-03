import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { maybeSync, syncNow } from '@/lib/sync';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  // Sync on app open, and again whenever the app returns to the foreground.
  useEffect(() => {
    syncNow();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeSync();
    });
    return () => subscription.remove();
  }, []);

  return (
    <>
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
    </>
  );
}
