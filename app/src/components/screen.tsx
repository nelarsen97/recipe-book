import { ReactNode } from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
 * the content view into a scrollable region above the keyboard. Under
 * edge-to-edge Android the OS no longer resizes the window for the keyboard,
 * so we drive the spacer from react-native-keyboard-controller's animated
 * keyboard height instead — it tracks the keyboard frame-by-frame (via
 * WindowInsetsAnimation), so the content squeezes smoothly in sync. The height
 * is reported as a negative offset (for use as translateY), hence `Math.abs`;
 * `max(insets.bottom, …)` keeps the nav-bar spacer when the keyboard is closed.
 */
export default function Screen({ children, style }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useReanimatedKeyboardAnimation();
  const animatedStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(insets.bottom, Math.abs(height.value)),
  }));
  return (
    <Animated.View style={[styles.screen, animatedStyle]}>
      <Animated.View style={[styles.content, style]}>{children}</Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
});
