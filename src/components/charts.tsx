import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { AccentColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// The two charts on the dashboard. Both draw the user's own rows — there is no
// sample series anywhere in this file, and an empty dataset renders as empty
// rather than as a flat pretend line.
//
// One series, one hue: the gold is the data, everything else (grid, axes,
// labels) is deliberately quiet enough to read through.

const GOLD = AccentColors.primaryLight;

/** Gold shades for the donut, light to dark, so slices stay distinguishable. */
export const SERIES_COLORS = ['#F0CE5A', '#D4AF37', '#A8862A', '#7A6220', '#524116'];

type Day = { key: string; label: string; count: number };

/** Round axis numbers: three or four gridlines with values people can read. */
function niceScale(peak: number): { max: number; lines: number[] } {
  const target = Math.max(peak, 1);
  const rough = target / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const max = Math.ceil(target / step) * step;
  const lines: number[] = [];
  for (let value = 0; value <= max + step / 100; value += step) lines.push(value);
  return { max, lines };
}

/**
 * A curve through the points, using a control point either side of each
 * midpoint. It never overshoots the values it joins, which matters when the
 * series is counts and a dip below zero would be a lie.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const midX = (from.x + to.x) / 2;
    d += ` C ${midX} ${from.y} ${midX} ${to.y} ${to.x} ${to.y}`;
  }
  return d;
}

function monthDay(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ActivityLineChart({
  days,
  height = 210,
  unit = 'runs',
}: {
  days: Day[];
  height?: number;
  unit?: string;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const padding = { top: 18, right: 10, bottom: 26, left: 34 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = Math.max(0, height - padding.top - padding.bottom);

  const peak = Math.max(1, ...days.map((day) => day.count));
  const { max, lines } = niceScale(peak);

  const points = days.map((day, index) => ({
    x: padding.left + (days.length === 1 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth),
    y: padding.top + plotHeight - (day.count / max) * plotHeight,
  }));

  const linePath = smoothPath(points);
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${padding.top + plotHeight} L ${points[0].x} ${
          padding.top + plotHeight
        } Z`
      : '';

  // Every third day, so labels never collide on a phone. The last day is worth
  // naming too, but only when there is room for it beside the one before.
  const labelEvery = days.length > 10 ? 3 : 2;
  const labelIndices = days.map((_, index) => index).filter((index) => index % labelEvery === 0);
  const lastIndex = days.length - 1;
  const lastLabelled = labelIndices[labelIndices.length - 1];
  if (
    lastLabelled !== undefined &&
    lastLabelled !== lastIndex &&
    points[lastIndex].x - points[lastLabelled].x > 48
  ) {
    labelIndices.push(lastIndex);
  }

  const activePoint = active !== null ? points[active] : null;

  return (
    <View
      onLayout={onLayout}
      style={{ height }}
      accessibilityRole="image"
      accessibilityLabel={`Activity per day: ${days
        .map((day) => `${monthDay(day.key)} ${day.count}`)
        .join(', ')}`}
    >
      {width > 0 ? (
        <>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={GOLD} stopOpacity={0.32} />
                <Stop offset="0.55" stopColor={GOLD} stopOpacity={0.09} />
                <Stop offset="1" stopColor={GOLD} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* Grid first, so the series always sits on top of it. */}
            <G>
              {lines.map((value) => {
                const y = padding.top + plotHeight - (value / max) * plotHeight;
                return (
                  <G key={value}>
                    <Line
                      x1={padding.left}
                      y1={y}
                      x2={width - padding.right}
                      y2={y}
                      stroke={theme.border}
                      strokeWidth={1}
                      strokeDasharray="3 6"
                    />
                  </G>
                );
              })}
            </G>

            {areaPath ? <Path d={areaPath} fill="url(#activityFill)" /> : null}
            {linePath ? (
              <Path
                d={linePath}
                stroke={GOLD}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null}

            {points.map((point, index) => (
              <Circle
                key={days[index].key}
                cx={point.x}
                cy={point.y}
                r={index === active ? 5 : 3}
                fill={index === active ? GOLD : theme.background}
                stroke={GOLD}
                strokeWidth={2}
              />
            ))}

            {activePoint ? (
              <Line
                x1={activePoint.x}
                y1={padding.top}
                x2={activePoint.x}
                y2={padding.top + plotHeight}
                stroke={GOLD}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.6}
              />
            ) : null}
          </Svg>

          {/* Axis labels are real text rather than SVG glyphs, so they inherit
              the app's font and scale with the system text size. */}
          {lines.map((value) => {
            const y = padding.top + plotHeight - (value / max) * plotHeight;
            return (
              <Text
                key={`y-${value}`}
                style={[styles.axisLabel, { color: theme.textSecondary, top: y - 8, left: 0, width: padding.left - 8, textAlign: 'right' }]}
              >
                {Math.round(value)}
              </Text>
            );
          })}

          {days.map((day, index) =>
            labelIndices.includes(index) ? (
              <Text
                key={`x-${day.key}`}
                style={[
                  styles.axisLabel,
                  {
                    color: theme.textSecondary,
                    top: height - 18,
                    left: points[index].x - 24,
                    width: 48,
                    textAlign: 'center',
                  },
                ]}
                numberOfLines={1}
              >
                {monthDay(day.key)}
              </Text>
            ) : null
          )}

          {activePoint ? (
            <View
              style={[
                styles.tooltip,
                {
                  left: Math.min(Math.max(activePoint.x - 38, 0), Math.max(width - 76, 0)),
                  top: Math.max(activePoint.y - 34, 0),
                },
              ]}
              pointerEvents="none"
            >
              <Text style={styles.tooltipText}>
                {days[active!].count} {unit}
              </Text>
            </View>
          ) : null}

          {/* One hit target per day, laid over the plot. Hover on a desktop,
              tap on a phone — the same tooltip either way. */}
          <View style={[styles.hitRow, { left: padding.left, width: plotWidth, top: padding.top, height: plotHeight }]}>
            {days.map((day, index) => (
              <Pressable
                key={`hit-${day.key}`}
                accessibilityRole="button"
                accessibilityLabel={`${monthDay(day.key)}: ${day.count} ${unit}`}
                style={styles.hit}
                onHoverIn={() => setActive(index)}
                onHoverOut={() => setActive(null)}
                onPress={() => setActive((current) => (current === index ? null : index))}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

export type DonutSegment = { label: string; count: number };

export function DonutChart({
  segments,
  size = 150,
  centerLabel,
}: {
  segments: DonutSegment[];
  size?: number;
  centerLabel: string;
}) {
  const theme = useTheme();
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* A plain SVG transform: react-native-svg's `rotation`/`origin` props
            emit a hyphenated DOM attribute on web, which React rejects. */}
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.backgroundSelected}
            strokeWidth={stroke}
            fill="none"
          />
          {total > 0
            ? segments.map((segment, index) => {
                const length = (segment.count / total) * circumference;
                // A 2px gap of page colour, so two neighbouring golds never
                // read as one slice.
                const dash = Math.max(length - 2, 0.5);
                const element = (
                  <Circle
                    key={segment.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                    strokeWidth={stroke}
                    strokeLinecap="butt"
                    fill="none"
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += length;
                return element;
              })
            : null}
        </G>
      </Svg>

      <View style={styles.donutCenter} pointerEvents="none">
        <Text style={[styles.donutTotal, { color: theme.text }]}>{total}</Text>
        <Text style={[styles.donutCaption, { color: theme.textSecondary }]}>{centerLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axisLabel: { position: 'absolute', fontSize: 11, lineHeight: 16 },
  tooltip: {
    position: 'absolute',
    width: 76,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: GOLD,
  },
  tooltipText: { color: '#0D0D0D', fontSize: 12, fontWeight: '700' },
  hitRow: { position: 'absolute', flexDirection: 'row' },
  hit: { flex: 1, height: '100%' },
  donutCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutTotal: { fontSize: 26, lineHeight: 30, fontWeight: '700' },
  donutCaption: { fontSize: 11, lineHeight: 14 },
});
