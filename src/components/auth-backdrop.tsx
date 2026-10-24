import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useLayoutWidth } from '@/components/phone-frame';

// The scene every sign-in screen sits in: a photograph of a desk at dusk, with
// the form floating in the middle of it.
//
// The photograph is bright through the window, so it gets shaded twice before
// any text lands on it: a pool of dark behind the form, and a vignette down the
// page. Without them the placeholders in the fields vanish into the city lights.

/** Where the layout stops being a wide scene and becomes a phone screen. */
const COMPACT_MAX_WIDTH = 600;

// The building mark alone, cut out of synq-logo.jpg onto transparency (no
// black card, no wordmark) so it sits *in* the photograph rather than on a tile
// pasted over it. The original logo file is untouched.
const MARK = require('../../assets/images/synq-mark.png');
const BACKDROP = require('../../assets/images/login-background.jpg');

/** The mark is taller than it is wide; width follows height, never the reverse. */
const MARK_ASPECT = 312 / 448;

/** The vignette: heavier at the top and bottom, where nothing important sits. */
const DOWN_THE_PAGE = [
  'rgba(6, 6, 10, 0.62)',
  'rgba(6, 6, 10, 0.18)',
  'rgba(6, 6, 10, 0.78)',
] as const;

function Scrim() {
  return (
    // A 100x100 box stretched over the screen: the pool is then placed in
    // percentages of the window, whatever shape it is, rather than of an SVG
    // that has no intrinsic size.
    <Svg
      style={styles.layer}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient id="pool" cx="50%" cy="50%" rx="48%" ry="62%">
          <Stop offset="0" stopColor="#05050A" stopOpacity={0.86} />
          <Stop offset="0.55" stopColor="#05050A" stopOpacity={0.6} />
          <Stop offset="1" stopColor="#05050A" stopOpacity={0.12} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill="url(#pool)" />
    </Svg>
  );
}

/** The logo and the line under it, sized for the screen it lands on. */
export function BrandMark() {
  const width = useLayoutWidth();
  const compact = width <= COMPACT_MAX_WIDTH;

  return (
    <View style={styles.brand}>
      <Image
        source={MARK}
        style={[styles.logo, compact && styles.logoCompact]}
        contentFit="contain"
        accessibilityLabel="Synq"
      />
      <View style={styles.tagline}>
        <Text style={[styles.taglineText, compact && styles.taglineTextCompact]}>
          YOUR AI WORKFORCE
        </Text>
        <Text style={[styles.taglineText, compact && styles.taglineTextCompact]}>
          FOR YOUR BUSINESS
        </Text>
      </View>
    </View>
  );
}

export function AuthBackdrop({ children }: PropsWithChildren) {
  return (
    <View style={styles.root}>
      {/* Cropped rather than fitted: on a phone the window and the skyline stay
          in frame, and the edges of the desk are what get cut. */}
      <Image source={BACKDROP} style={styles.layer} contentFit="cover" />

      <Scrim />
      <LinearGradient pointerEvents="none" colors={DOWN_THE_PAGE} style={styles.layer} />

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#09090C' },
  fill: { flex: 1 },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 48,
  },

  brand: { alignItems: 'center', gap: 18, marginBottom: 34 },
  // No radius and no square: there is no card behind the mark any more, so a
  // rounded corner would only crop the drawing. A soft shadow keeps the white
  // readable if the photograph is bright behind it.
  logo: {
    height: 96,
    width: 96 * MARK_ASPECT,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
  },
  logoCompact: { height: 76, width: 76 * MARK_ASPECT },
  tagline: { alignItems: 'center', gap: 4 },
  taglineText: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: 4.5,
    textAlign: 'center',
  },
  taglineTextCompact: { fontSize: 11, letterSpacing: 3 },
});
