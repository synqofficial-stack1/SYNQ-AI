import { type ReactNode, useEffect } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { XIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { floatingShadow } from './ui/utils';

export function ModalSheet({
  visible,
  onClose,
  title,
  description,
  children,
  align = 'center',
  width = 480,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** `top` suits the command palette, which should not jump to mid-screen. */
  align?: 'center' | 'top';
  width?: number;
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
      <View style={[styles.backdrop, { backgroundColor: theme.overlay }, align === 'top' && styles.backdropTop]}>
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
          accessibilityViewIsModal
          style={[
            styles.panel,
            floatingShadow(theme.shadow),
            { maxWidth: width, backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText type="sectionTitle" accessibilityRole="header">
                {title}
              </ThemedText>
              {description ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {description}
                </ThemedText>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              onPress={onClose}
              hitSlop={8}
              style={({ hovered }) => [styles.close, hovered && { backgroundColor: theme.surfaceRaised }]}
            >
              <XIcon size={17} color={theme.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
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
    padding: Spacing.three,
  },
  backdropTop: { justifyContent: 'flex-start', paddingTop: 88 },
  panel: {
    width: '100%',
    maxHeight: '90%',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.modal,
    borderWidth: 1,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  headerText: { flex: 1, gap: Spacing.one },
  close: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: -4, marginRight: -6 },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { gap: Spacing.three },
});
