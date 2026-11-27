// React Native's Pressable state type only lists `pressed`. react-native-web
// also passes `hovered`, and the web UI uses it for hover styles. Declaring it
// optional keeps those styles type-safe without claiming native has hover.
import 'react-native';

declare module 'react-native' {
  interface PressableStateCallbackType {
    readonly hovered?: boolean;
  }
}

// Side-effect CSS imports (src/constants/theme.ts pulls in the web font sheet).
declare module '*.css';
