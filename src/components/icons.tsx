import Svg, { Circle, Path, Rect } from 'react-native-svg';

// The workspace icon set: thin outlines at a single stroke weight, drawn here
// rather than pulled from an icon package so the weight matches the type and
// nothing new has to be installed.
//
// Auth has its own set (`auth-icons.tsx`) because those are sized and coloured
// for the sign-in screen; these take the colour of whatever row they sit in.

type IconProps = { size?: number; color?: string };

const DEFAULT = 'rgba(255, 255, 255, 0.62)';

function stroke(color?: string) {
  return { stroke: color ?? DEFAULT, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
}

export function HomeIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z" {...stroke(color)} />
      <Path d="M9.5 20.5v-6h5v6" {...stroke(color)} />
    </Svg>
  );
}

export function ChartIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 19.5V11M12 19.5V5M19 19.5v-5.5" {...stroke(color)} />
    </Svg>
  );
}

export function MegaphoneIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 10.5v3a1.5 1.5 0 0 0 1.5 1.5H8l8 4.5V6L8 10.5H5.5A1.5 1.5 0 0 0 4 12Z" {...stroke(color)} />
      <Path d="M18.5 9.5a3.5 3.5 0 0 1 0 5" {...stroke(color)} />
    </Svg>
  );
}

export function PlusIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5.5v13M5.5 12h13" {...stroke(color)} />
    </Svg>
  );
}

export function BoltIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12L13 3Z" {...stroke(color)} />
    </Svg>
  );
}

export function PlugIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={8} cy={12} r={3.2} {...stroke(color)} />
      <Circle cx={16} cy={12} r={3.2} {...stroke(color)} />
      <Path d="M11.2 12h1.6" {...stroke(color)} />
    </Svg>
  );
}

export function GearIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3} {...stroke(color)} />
      <Path
        d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6 6.2 6.2"
        {...stroke(color)}
      />
    </Svg>
  );
}

export function SearchIcon({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={6.2} {...stroke(color)} />
      <Path d="m16 16 4 4" {...stroke(color)} />
    </Svg>
  );
}

export function BellIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.4.8 5 1.5 6H5c.7-1 1.5-2.6 1.5-6Z" {...stroke(color)} />
      <Path d="M10 19a2 2 0 0 0 4 0" {...stroke(color)} />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m7 10 5 5 5-5" {...stroke(color)} />
    </Svg>
  );
}

export function MenuIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7h16M4 12h16M4 17h16" {...stroke(color)} />
    </Svg>
  );
}

export function ArrowIcon({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h13m0 0-4.5-4.5M18 12l-4.5 4.5" {...stroke(color)} />
    </Svg>
  );
}

export function LayersIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m12 4 8 4.5-8 4.5-8-4.5L12 4Z" {...stroke(color)} />
      <Path d="m4.5 13 7.5 4.2 7.5-4.2" {...stroke(color)} />
    </Svg>
  );
}

export function CheckCircleIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.2} {...stroke(color)} />
      <Path d="m8.5 12.2 2.4 2.4 4.6-5" {...stroke(color)} />
    </Svg>
  );
}

export function UsersIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9.5} cy={9} r={3.2} {...stroke(color)} />
      <Path d="M4 19c0-2.8 2.5-4.5 5.5-4.5S15 16.2 15 19" {...stroke(color)} />
      <Path d="M16 6.4a3 3 0 0 1 0 5.2M17.5 14.8c1.7.6 2.9 1.9 2.9 4.2" {...stroke(color)} />
    </Svg>
  );
}

export function SparkIcon({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4.5 13.6 9 18 10.6 13.6 12.2 12 16.7 10.4 12.2 6 10.6 10.4 9 12 4.5Z" {...stroke(color)} />
    </Svg>
  );
}

export function CrownIcon({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8.5 7.5 12 12 5.5 16.5 12 20 8.5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17V8.5Z" {...stroke(color)} />
    </Svg>
  );
}

export function ClockIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.2} {...stroke(color)} />
      <Path d="M12 7.6V12l3 1.8" {...stroke(color)} />
    </Svg>
  );
}

export function InboxIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.8} y={5} width={16.4} height={14} rx={3} {...stroke(color)} />
      <Path d="M3.8 13.5h4l1.4 2h5.6l1.4-2h4" {...stroke(color)} />
    </Svg>
  );
}
