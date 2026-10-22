import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { floatingShadow } from './utils';

type Anchor = { x: number; y: number; width: number; height: number };

/**
 * A floating panel pinned under a trigger: dropdowns, the account menu, the
 * notification list. It renders in a transparent Modal and positions itself
 * from the trigger's window coordinates, so a card's `overflow` or a sibling's
 * stacking order can never clip it — which an absolutely-positioned child would
 * suffer from on both web and native.
 */
export function Popover({
  anchorRef,
  visible,
  onClose,
  children,
  align = 'left',
  width = 240,
  label,
}: {
  anchorRef: RefObject<View | null>;
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: number;
  /** Names the panel for screen readers. */
  label: string;
}) {
  const theme = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    if (!visible) return;
    anchorRef.current?.measureInWindow((x, y, w, h) => setAnchor({ x, y, width: w, height: h }));
  }, [anchorRef, visible, screenWidth, screenHeight]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;
  const panelWidth = Math.min(width, screenWidth - 24);
  const left = anchor
    ? Math.max(12, Math.min(align === 'right' ? anchor.x + anchor.width - panelWidth : anchor.x, screenWidth - panelWidth - 12))
    : 12;
  const top = anchor ? anchor.y + anchor.height + 6 : 72;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      {/* The dismiss target is a sibling of the panel, never its parent, so
          the panel's own buttons are not nested inside a <button> on web. */}
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={StyleSheet.absoluteFill} />
      {anchor ? (
        <View
          accessibilityLabel={label}
          style={[
            styles.panel,
            floatingShadow(theme.shadow),
            {
              top,
              left,
              width: panelWidth,
              maxHeight: Math.max(200, screenHeight - top - 16),
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          {children}
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    padding: 6,
    borderRadius: Radius.card - 4,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
