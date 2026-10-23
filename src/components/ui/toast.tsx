import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckCircleIcon, InfoIcon, AlertCircleIcon, XIcon } from '@/components/icons';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { floatingShadow, useBreakpoint } from './utils';

// Short confirmations that float over the page: "Settings saved", "Copied".
// A module-level queue, like analytics-events, so any screen can raise one
// without a provider. Errors that need reading stay inline next to their form.

type ToastTone = 'success' | 'info' | 'danger';
type Toast = { id: number; message: string; tone: ToastTone };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showToast(message: string, tone: ToastTone = 'success') {
  toasts = [...toasts.slice(-2), { id: nextId++, message, tone }];
  emit();
}

function dismiss(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => toasts;
const EMPTY: Toast[] = [];

function ToastItem({ toast }: { toast: Toast }) {
  const theme = useTheme();
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), 4500);
    return () => clearTimeout(timer);
  }, [toast.id]);
  const Icon = toast.tone === 'success' ? CheckCircleIcon : toast.tone === 'danger' ? AlertCircleIcon : InfoIcon;
  const color = toast.tone === 'success' ? theme.success : toast.tone === 'danger' ? theme.danger : theme.info;
  return (
    <View
      accessibilityRole={toast.tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.toast, floatingShadow(theme.shadow), { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Icon size={18} color={color} />
      <Text style={[styles.text, { color: theme.text }]}>{toast.message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => dismiss(toast.id)} hitSlop={8}>
        <XIcon size={15} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

/** Rendered once, by the app shell. */
export function ToastHost() {
  const items = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const { isCompact } = useBreakpoint();
  if (!items.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, isCompact ? styles.hostCompact : styles.hostWide]}>
      {items.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', gap: 8, zIndex: 100 },
  hostWide: { right: 24, bottom: 24, width: 360 },
  hostCompact: { left: 16, right: 16, bottom: 16 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.control + 2,
    borderWidth: 1,
  },
  text: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
});
