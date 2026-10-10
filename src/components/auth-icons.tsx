import Svg, { Circle, Path, Rect } from 'react-native-svg';

// The handful of marks the sign-in screens need, drawn here rather than pulled
// from an icon set: five outlines and a logo weigh less than a dependency, and
// the stroke weight can match the thin type the page is built on.

const LINE = 'rgba(255, 255, 255, 0.55)';

type IconProps = { size?: number; color?: string };

export function MailIcon({ size = 20, color = LINE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.75} y={5} width={18.5} height={14} rx={3.5} stroke={color} strokeWidth={1.5} />
      <Path
        d="M4.5 8.25 12 13.2l7.5-4.95"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function LockIcon({ size = 20, color = LINE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4.25} y={10} width={15.5} height={10.5} rx={3} stroke={color} strokeWidth={1.5} />
      <Path
        d="M8 10V7.6a4 4 0 0 1 8 0V10"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function EyeIcon({ size = 20, color = LINE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2.5 12S6 5.75 12 5.75 21.5 12 21.5 12 18 18.25 12 18.25 2.5 12 2.5 12Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3.1} stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

export function EyeOffIcon({ size = 20, color = LINE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9.9 5.98A9.9 9.9 0 0 1 12 5.75c6 0 9.5 6.25 9.5 6.25a17 17 0 0 1-3.2 3.88M6.6 7.9A17.3 17.3 0 0 0 2.5 12S6 18.25 12 18.25c1.6 0 3-.45 4.2-1.1"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8M3.5 3.5l17 17"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ArrowRightIcon({ size = 18, color = '#0D0D0D' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 12h15m0 0-5.5-5.5M19.5 12 14 17.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 18, color = 'rgba(255, 255, 255, 0.45)' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m9.5 5.5 6.5 6.5-6.5 6.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Google's own mark, as their sign-in branding requires. */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
    </Svg>
  );
}
