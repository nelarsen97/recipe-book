import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '@/lib/use-keyboard';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shared screen wrapper that keeps content clear of the Android system
 * navigation bar and the on-screen keyboard. The app draws edge-to-edge, so
 * without this buffer the back/home buttons overlay whatever sits at the
 * bottom of a screen.
 *
 * The inset is a spacer below the content view (not padding on it):
 * absolutely-positioned footers anchor to the content view's bottom edge,
 * which padding would not move.
 *
 * When the keyboard opens the spacer grows to the keyboard height, shrinking
 * the content view into a scrollable region above the keyboard (Android's
 * default window resize doesn't do this under edge-to-edge). The keyboard
 * height is measured from the screen bottom, which is where the outer view is
 * anchored, so `max(insets.bottom, keyboardHeight)` is the correct spacer.
 */
export default function Screen({ children, style }: Props) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const paddingBottom = Math.max(insets.bottom, keyboardHeight);
  return (
    <View style={[styles.screen, { paddingBottom }]}>
      <View style={[styles.content, style]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
});
