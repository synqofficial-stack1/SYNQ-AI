import { type ReactNode, useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ModalSheet({
  visible,
  onClose,
  title,
  description,
  children,
  align = 'center',
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** `top` suits the command palette, which should not jump to mid-screen. */
  align?: 'center' | 'top';
}) {
  const theme = useTheme();

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, align === 'top' && styles.backdropTop]}>
        {/* The click-to-dismiss target is a sibling of the panel, not its
            parent. Wrapping the panel in a Pressable would put every button
            inside the modal inside a <button> on web, which is invalid markup
            and breaks clicks on the controls it contains. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <View style={styles.header}>
            <ThemedText type="sectionTitle">{title}</ThemedText>
            {description ? (
              <ThemedText type="caption" themeColor="textSecondary">
                {description}
              </ThemedText>
            ) : null}
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  backdropTop: { justifyContent: 'flex-start', paddingTop: 96 },
  panel: {
    width: '100%',
    maxWidth: 460,
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.modal,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 40,
    elevation: 16,
  },
  header: { gap: Spacing.one },
});
