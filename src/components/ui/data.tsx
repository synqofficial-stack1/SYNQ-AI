import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModalSheet } from '@/components/modal-sheet';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Button, ButtonRow } from './button';
import { transition, useBreakpoint } from './utils';

export type Column<T> = {
  key: string;
  title: string;
  /** Relative width on desktop. */
  flex?: number;
  render: (row: T) => ReactNode;
  /** Hidden from the stacked card layout on phones, e.g. a secondary date. */
  hideOnCompact?: boolean;
  align?: 'left' | 'right';
};

/**
 * A readable table on desktop that turns into one card per row on a phone,
 * so nothing ever needs a sideways scroll to read.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowPress,
  rowLabel,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowPress?: (row: T) => void;
  rowLabel?: (row: T) => string;
  empty?: ReactNode;
}) {
  const theme = useTheme();
  const { width } = useBreakpoint();
  const stacked = width < 760;
  if (!rows.length) return <>{empty ?? null}</>;

  if (stacked) {
    return (
      <View style={styles.cards}>
        {rows.map((row) => {
          const body = (
            <>
              {columns
                .filter((column) => !column.hideOnCompact)
                .map((column, index) => (
                  <View key={column.key} style={index === 0 ? styles.cardHead : styles.cardLine}>
                    {index > 0 ? (
                      <ThemedText type="caption" themeColor="textSecondary" style={styles.cardLabel}>
                        {column.title}
                      </ThemedText>
                    ) : null}
                    <View style={styles.cardValue}>{column.render(row)}</View>
                  </View>
                ))}
            </>
          );
          const style = [styles.card, { borderColor: theme.border, backgroundColor: theme.surface }];
          return onRowPress ? (
            <Pressable
              key={rowKey(row)}
              accessibilityRole="button"
              accessibilityLabel={rowLabel?.(row)}
              onPress={() => onRowPress(row)}
              style={({ hovered }) => [style, transition, hovered && { backgroundColor: theme.surfaceRaised }]}
            >
              {body}
            </Pressable>
          ) : (
            <View key={rowKey(row)} style={style}>
              {body}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View accessibilityRole="list" style={[styles.table, { borderColor: theme.border }]}>
      <View style={[styles.headRow, { backgroundColor: theme.surfaceRaised, borderBottomColor: theme.border }]}>
        {columns.map((column) => (
          <ThemedText
            key={column.key}
            type="caption"
            themeColor="textSecondary"
            style={[styles.headCell, { flex: column.flex ?? 1, textAlign: column.align ?? 'left' }]}
          >
            {column.title}
          </ThemedText>
        ))}
      </View>
      {rows.map((row, index) => {
        const cells = columns.map((column) => (
          <View key={column.key} style={[styles.cell, { flex: column.flex ?? 1, alignItems: column.align === 'right' ? 'flex-end' : 'flex-start' }]}>
            {column.render(row)}
          </View>
        ));
        const style = [styles.row, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }];
        return onRowPress ? (
          <Pressable
            key={rowKey(row)}
            accessibilityRole="button"
            accessibilityLabel={rowLabel?.(row)}
            onPress={() => onRowPress(row)}
            style={({ hovered }) => [style, transition, hovered && { backgroundColor: theme.surfaceRaised }]}
          >
            {cells}
          </Pressable>
        ) : (
          <View key={rowKey(row)} accessibilityRole="none" style={style}>
            {cells}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Asks before something that cannot be undone. The confirm button is red for
 * destructive actions and is the only way through; closing changes nothing.
 */
export function ConfirmDialog({
  visible,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  busy,
  destructive = true,
  children,
}: {
  visible: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  destructive?: boolean;
  children?: ReactNode;
}) {
  return (
    <ModalSheet visible={visible} onClose={busy ? () => {} : onClose} title={title} description={description}>
      {children}
      <ButtonRow style={styles.confirmRow}>
        <Button label="Cancel" onPress={onClose} disabled={busy} />
        <Button label={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={onConfirm} loading={busy} />
      </ButtonRow>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  table: { borderWidth: 1, borderRadius: Radius.control + 2, overflow: 'hidden' },
  headRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, gap: 12 },
  headCell: { fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  cell: { minWidth: 0, justifyContent: 'center' },
  cards: { gap: 10 },
  card: { borderWidth: 1, borderRadius: Radius.control + 2, padding: 14, gap: 8 },
  cardHead: { marginBottom: 2 },
  cardLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardLabel: { width: 96 },
  cardValue: { flex: 1, minWidth: 0 },
  confirmRow: { justifyContent: 'flex-end' },
});
