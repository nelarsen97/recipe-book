jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The Screen wrapper (rendered by every screen) animates a keyboard inset with
// Reanimated + the native keyboard controller. Reanimated's shipped mock still
// pulls in native worklets (which can't load under node), so stub the small
// surface Screen uses directly; use the keyboard controller's shipped jest mock.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const AnimatedView = React.forwardRef((props: object, ref: unknown) =>
    React.createElement(View, { ...props, ref })
  );
  AnimatedView.displayName = 'Animated.View';
  return {
    __esModule: true,
    default: { View: AnimatedView, createAnimatedComponent: (c: unknown) => c },
    View: AnimatedView,
    // Run the worklet so the derived style is still produced from mocked values.
    useAnimatedStyle: (fn: () => object) => {
      try {
        return fn();
      } catch {
        return {};
      }
    },
    useSharedValue: (value: unknown) => ({ value }),
  };
});
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest')
);

// Screens read safe-area insets, but tests render them without a provider.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);

// In-memory stand-in for the device keystore (holds the Keep master token).
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      store.delete(key);
    },
  };
});
