import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { DataColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// The two charts on the dashboard. Both draw the user's own rows — there is no
// sample series anywhere in this file, and an empty dataset renders as empty
// rather than as a flat pretend line.
//
// Grid, axes and labels are deliberately quiet enough to read through; the
// data carries the colour. Series colours come from DataColors so Sales is
// always gold and Marketing always violet, wherever they appear.

const GOLD = DataColors.sales;

/** Distinct hues for donut slices and bar rows; each slice also has a text label. */
export const SERIES_COLORS = [DataColors.sales, DataColors.marketing, DataColors.company, '#16A34A', DataColors.neutral];

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
  color = GOLD,
}: {
  days: Day[];
  height?: number;
  unit?: string;
  color?: string;
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
                <Stop offset="0" stopColor={color} stopOpacity={0.32} />
                <Stop offset="0.55" stopColor={color} stopOpacity={0.09} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
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
                stroke={color}
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
                fill={index === active ? color : theme.background}
                stroke={color}
                strokeWidth={2}
              />
            ))}

            {activePoint ? (
              <Line
                x1={activePoint.x}
                y1={padding.top}
                x2={activePoint.x}
                y2={padding.top + plotHeight}
                stroke={color}
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
                  backgroundColor: '#171717',
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
    backgroundColor: '#171717',
  },
  tooltipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
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

export type ChartSeries = { key: string; label: string; color: string; values: number[]; fill?: boolean };

/**
 * Several daily series on one set of axes — Sales, Marketing and the total on
 * the dashboard. Hover or tap a day to read every series for it at once.
 */
export function MultiLineChart({
  dates,
  series,
  height = 240,
  unit = 'actions',
}: {
  /** One `YYYY-MM-DD` key per point, oldest first. */
  dates: string[];
  series: ChartSeries[];
  height?: number;
  unit?: string;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const padding = { top: 16, right: 12, bottom: 26, left: 34 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = Math.max(0, height - padding.top - padding.bottom);
  const peak = Math.max(1, ...series.flatMap((line) => line.values));
  const { max, lines } = niceScale(peak);
  const xFor = (index: number) => padding.left + (dates.length === 1 ? plotWidth / 2 : (index / (dates.length - 1)) * plotWidth);
  const yFor = (value: number) => padding.top + plotHeight - (value / max) * plotHeight;

  const labelEvery = dates.length > 20 ? 5 : dates.length > 10 ? 3 : 1;
  const labelIndices = dates.map((_, index) => index).filter((index) => index % labelEvery === 0);
  const summary = dates
    .map((key, index) => `${monthDay(key)}: ${series.map((line) => `${line.label} ${line.values[index] ?? 0}`).join(', ')}`)
    .join('; ');

  return (
    <View onLayout={onLayout} style={{ height }} accessibilityRole="image" accessibilityLabel={`Activity per day. ${summary}`}>
      {width > 0 ? (
        <>
          <Svg width={width} height={height}>
            <Defs>
              {series.map((line) => (
                <LinearGradient key={line.key} id={`fill-${line.key}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={line.color} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={line.color} stopOpacity={0} />
                </LinearGradient>
              ))}
            </Defs>
            {lines.map((value) => (
              <Line
                key={value}
                x1={padding.left}
                y1={yFor(value)}
                x2={width - padding.right}
                y2={yFor(value)}
                stroke={theme.border}
                strokeWidth={1}
                strokeDasharray="3 6"
              />
            ))}
            {series.map((line) => {
              const points = line.values.map((value, index) => ({ x: xFor(index), y: yFor(value) }));
              const path = smoothPath(points);
              const area =
                points.length > 1
                  ? `${path} L ${points[points.length - 1].x} ${padding.top + plotHeight} L ${points[0].x} ${padding.top + plotHeight} Z`
                  : '';
              return (
                <G key={line.key}>
                  {line.fill && area ? <Path d={area} fill={`url(#fill-${line.key})`} /> : null}
                  <Path d={path} stroke={line.color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  {points.map((point, index) => (
                    <Circle
                      key={index}
                      cx={point.x}
                      cy={point.y}
                      r={index === active ? 4.5 : 2.5}
                      fill={index === active ? line.color : theme.surface}
                      stroke={line.color}
                      strokeWidth={1.75}
                    />
                  ))}
                </G>
              );
            })}
            {active !== null ? (
              <Line
                x1={xFor(active)}
                y1={padding.top}
                x2={xFor(active)}
                y2={padding.top + plotHeight}
                stroke={theme.borderStrong}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            ) : null}
          </Svg>

          {lines.map((value) => (
            <Text
              key={`y-${value}`}
              style={[styles.axisLabel, { color: theme.textSecondary, top: yFor(value) - 8, left: 0, width: padding.left - 8, textAlign: 'right' }]}
            >
              {Math.round(value)}
            </Text>
          ))}
          {labelIndices.map((index) => (
            <Text
              key={`x-${dates[index]}`}
              numberOfLines={1}
              style={[styles.axisLabel, { color: theme.textSecondary, top: height - 18, left: xFor(index) - 26, width: 52, textAlign: 'center' }]}
            >
              {monthDay(dates[index])}
            </Text>
          ))}

          {active !== null ? (
            <View
              pointerEvents="none"
              style={[
                multiStyles.multiTooltip,
                {
                  left: Math.min(Math.max(xFor(active) - 70, 0), Math.max(width - 140, 0)),
                  top: 4,
                },
              ]}
            >
              <Text style={multiStyles.multiTooltipTitle}>{monthDay(dates[active])}</Text>
              {series.map((line) => (
                <View key={line.key} style={multiStyles.multiTooltipRow}>
                  <View style={[multiStyles.multiTooltipDot, { backgroundColor: line.color }]} />
                  <Text style={multiStyles.multiTooltipText}>
                    {line.label}: {line.values[active] ?? 0}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.hitRow, { left: padding.left - plotWidth / Math.max(dates.length - 1, 1) / 2, width: plotWidth + plotWidth / Math.max(dates.length - 1, 1), top: padding.top, height: plotHeight }]}>
            {dates.map((key, index) => (
              <Pressable
                key={`hit-${key}`}
                accessibilityRole="button"
                accessibilityLabel={`${monthDay(key)}: ${series.map((line) => `${line.label} ${line.values[index] ?? 0} ${unit}`).join(', ')}`}
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

const multiStyles = StyleSheet.create({
  multiTooltip: {
    position: 'absolute',
    width: 140,
    padding: 8,
    gap: 3,
    borderRadius: 8,
    backgroundColor: '#171717',
  },
  multiTooltipTitle: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  multiTooltipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  multiTooltipDot: { width: 7, height: 7, borderRadius: 4 },
  multiTooltipText: { color: '#E8E4DC', fontSize: 12 },
});
