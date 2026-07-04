import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shared screen wrapper that keeps content clear of the Android system
 * navigation bar. The app draws edge-to-edge, so without this buffer the
 * back/home buttons overlay whatever sits at the bottom of a screen.
 *
 * The inset is a spacer below the content view (not padding on it):
 * absolutely-positioned footers anchor to the content view's bottom edge,
 * which padding would not move.
 */
export default function Screen({ children, style }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <View style={[styles.content, style]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
});
