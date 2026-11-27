import { Platform, type StyleProp, type ViewStyle } from 'react-native';

type Events = NonNullable<ViewStyle['pointerEvents']>;

/**
 * Decorative layers should not take taps. On the web, the `pointerEvents`
 * prop logs a deprecation warning, so it goes on the style instead. Native
 * still reads the prop.
 */
export function ignoreTouches(style?: StyleProp<ViewStyle>, events: Events = 'none') {
  if (Platform.OS === 'web') return { style: [style, { pointerEvents: events }] };
  return { pointerEvents: events, style };
}
