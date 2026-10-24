import { createContext, useContext, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

// On a laptop or desktop the web app is shown inside a phone-sized frame, so it
// does not stretch across the whole screen. Phones, tablets and the Android app
// never see the frame. Layouts read the width of the frame rather than the
// window, which is why the frame publishes its inner width through a context.

const FRAME_WIDTH = 390;
const FRAME_HEIGHT = 844;
const FRAME_BORDER = 10;
/** Below this window width the app is simply full-screen, as on a phone. */
const FRAME_MIN_WINDOW = 600;

const FrameWidthContext = createContext<number | null>(null);

/** The width the layout should use: the phone frame's inner width when framed, else the window's. */
export function useLayoutWidth(): number {
  const framed = useContext(FrameWidthContext);
  const { width } = useWindowDimensions();
  return framed ?? width;
}

export function PhoneFrame({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const framed = Platform.OS === 'web' && width >= FRAME_MIN_WINDOW;

  if (!framed) return <>{children}</>;

  return (
    <FrameWidthContext.Provider value={FRAME_WIDTH - FRAME_BORDER * 2}>
      <View style={styles.surround}>
        <View style={[styles.device, { backgroundColor: theme.background }]}>{children}</View>
      </View>
    </FrameWidthContext.Provider>
  );
}

const styles = StyleSheet.create({
  surround: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#050505',
  },
  device: {
    width: FRAME_WIDTH,
    height: '100%',
    maxHeight: FRAME_HEIGHT,
    borderRadius: 48,
    borderWidth: FRAME_BORDER,
    borderColor: '#1c1c22',
    overflow: 'hidden',
  },
});
