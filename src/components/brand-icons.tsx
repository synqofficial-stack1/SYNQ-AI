import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { SocialPlatform } from '@/lib/social';

// Simplified marks for the services Synq actually connects to. They identify a
// destination at a glance; they are drawn here rather than shipped as images so
// they stay sharp at every size and need no extra assets.

type BrandProps = { size?: number };

export function YouTubeMark({ size = 32 }: BrandProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Rect x={2} y={6} width={28} height={20} rx={6} fill="#FF0033" />
      <Path d="M13 11.5v9l8-4.5-8-4.5Z" fill="#FFFFFF" />
    </Svg>
  );
}

export function InstagramMark({ size = 32 }: BrandProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Defs>
        <LinearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor="#FEC053" />
          <Stop offset="0.35" stopColor="#F2203E" />
          <Stop offset="0.7" stopColor="#B729A8" />
          <Stop offset="1" stopColor="#5342D6" />
        </LinearGradient>
      </Defs>
      <Rect x={3} y={3} width={26} height={26} rx={8} fill="url(#ig)" />
      <Rect x={9} y={9} width={14} height={14} rx={5} stroke="#FFFFFF" strokeWidth={2} fill="none" />
      <Circle cx={16} cy={16} r={3.4} stroke="#FFFFFF" strokeWidth={2} fill="none" />
      <Circle cx={20.6} cy={11.4} r={1.1} fill="#FFFFFF" />
    </Svg>
  );
}

export function XMark({ size = 32 }: BrandProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Rect x={3} y={3} width={26} height={26} rx={7} fill="#111111" />
      <Path d="M10 9.5h3.6l9 13h-3.6l-9-13Z" fill="#FFFFFF" />
      <Path d="M21.6 9.5h1.9l-5.9 6.8-1-1.4 5-5.4ZM10.4 22.5l5.6-6.4 1 1.4-4.7 5h-1.9Z" fill="#FFFFFF" />
    </Svg>
  );
}

export function LinkedInMark({ size = 32 }: BrandProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Rect x={3} y={3} width={26} height={26} rx={6} fill="#0A66C2" />
      <Rect x={9} y={13.5} width={3.2} height={9.5} fill="#FFFFFF" />
      <Circle cx={10.6} cy={10} r={1.9} fill="#FFFFFF" />
      <Path d="M15 13.5h3.1v1.4c.5-.9 1.7-1.7 3.3-1.7 3 0 3.6 2 3.6 4.5V23h-3.2v-4.7c0-1.2 0-2.6-1.6-2.6s-1.9 1.2-1.9 2.5V23H15v-9.5Z" fill="#FFFFFF" />
    </Svg>
  );
}

export function GmailMark({ size = 32 }: BrandProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path d="M4 10.5v12A1.5 1.5 0 0 0 5.5 24H9V14.5l-5-4Z" fill="#4285F4" />
      <Path d="M23 24h3.5a1.5 1.5 0 0 0 1.5-1.5v-12l-5 4V24Z" fill="#34A853" />
      <Path d="M23 9v5.5l5-4V9.3c0-1.9-2.1-3-3.6-1.8L23 9Z" fill="#FBBC04" />
      <Path d="M9 14.5V9l7 5.3L23 9v5.5l-7 5.3-7-5.3Z" fill="#EA4335" />
      <Path d="M4 9.3v1.2l5 4V9L7.6 7.5C6.1 6.3 4 7.4 4 9.3Z" fill="#C5221F" />
    </Svg>
  );
}

const MARKS: Record<SocialPlatform, (props: BrandProps) => ReactElement> = {
  youtube: YouTubeMark,
  instagram: InstagramMark,
  x: XMark,
  linkedin: LinkedInMark,
};

/** The platform's mark on a neutral tile, for lists and cards. */
export function PlatformMark({ platform, size = 40, tile = true }: { platform: SocialPlatform | 'gmail'; size?: number; tile?: boolean }) {
  const Mark = platform === 'gmail' ? GmailMark : MARKS[platform];
  if (!tile) return <Mark size={size} />;
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Mark size={size * 0.78} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
