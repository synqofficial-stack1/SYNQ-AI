import { useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { CheckIcon, ChevronDownIcon, SearchIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Popover } from './popover';
import { transition } from './utils';

const noWebOutline = Platform.select({
  web: { outlineStyle: 'none' } as unknown as TextStyle,
  default: null,
});

/**
 * A labelled form row: the label above, the control, then either the error or
 * the helper text below. A counter shows on the right when `count` is given.
 */
export function Field({
  label,
  helper,
  error,
  count,
  required,
  children,
  style,
}: {
  label: string;
  helper?: string;
  error?: string | null;
  count?: { value: number; max: number };
  required?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.field, style]}>
      <ThemedText type="label" style={styles.fieldLabel}>
        {label}
        {required ? <Text style={{ color: theme.danger }}> *</Text> : null}
      </ThemedText>
      {children}
      {error || helper || count ? (
        <View style={styles.fieldFoot}>
          <ThemedText
            type="caption"
            accessibilityRole={error ? 'alert' : undefined}
            style={[styles.fieldHelp, { color: error ? theme.danger : theme.textSecondary }]}
          >
            {error || helper || ''}
          </ThemedText>
          {count ? (
            <ThemedText
              type="caption"
              style={{ color: count.value > count.max ? theme.danger : theme.textSecondary }}
            >
              {count.value}/{count.max}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A search box with the magnifier inside it. */
export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search',
  accessibilityLabel,
  style,
  ...rest
}: TextInputProps & { accessibilityLabel?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.search,
        transition,
        { backgroundColor: theme.surface, borderColor: focused ? theme.accentHover : theme.border },
        style,
      ]}
    >
      <SearchIcon size={16} color={theme.textSecondary} />
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        placeholderTextColor={theme.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.searchInput, noWebOutline, { color: theme.text }]}
      />
    </View>
  );
}

/** An on/off switch. The state is announced, and shown by position as well as colour. */
export function Switch({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** The accessible name; usually the row's visible label. */
  label: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      hitSlop={8}
      style={[
        styles.switch,
        transition,
        { backgroundColor: value ? theme.accent : theme.borderStrong, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <View style={[styles.knob, { transform: [{ translateX: value ? 18 : 0 }] }]} />
    </Pressable>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[styles.checkRow, { opacity: disabled ? 0.5 : 1 }]}
    >
      <View
        style={[
          styles.checkbox,
          transition,
          { borderColor: checked ? theme.accentHover : theme.borderStrong, backgroundColor: checked ? theme.accent : theme.surface },
        ]}
      >
        {checked ? <CheckIcon size={14} color={theme.onAccent} strokeWidth={2.5} /> : null}
      </View>
      <View style={styles.checkText}>
        <ThemedText type="small">{label}</ThemedText>
        {description ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {description}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

export type SelectOption<V extends string> = { value: V; label: string; description?: string };

/** A dropdown. Opens a list under the trigger; Escape or a tap outside closes it. */
export function Select<V extends string>({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose…',
  size = 'md',
  leading,
  width,
}: {
  value: V | null;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  /** The accessible name, e.g. "Date range". */
  label: string;
  placeholder?: string;
  size?: 'sm' | 'md';
  leading?: ReactNode;
  width?: number;
}) {
  const theme = useTheme();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <>
      <View ref={anchor} collapsable={false} style={width ? { width } : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={({ hovered }) => [
            styles.select,
            transition,
            size === 'sm' && styles.selectSmall,
            {
              backgroundColor: theme.surface,
              borderColor: open ? theme.accentHover : hovered ? theme.borderStrong : theme.border,
            },
          ]}
        >
          {leading}
          <Text numberOfLines={1} style={[styles.selectText, { color: current ? theme.text : theme.textTertiary }]}>
            {current?.label ?? placeholder}
          </Text>
          <ChevronDownIcon size={15} color={theme.textSecondary} />
        </Pressable>
      </View>
      <Popover anchorRef={anchor} visible={open} onClose={() => setOpen(false)} label={label} width={Math.max(width ?? 0, 220)}>
        <ScrollView style={styles.options}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({ hovered }) => [
                  styles.option,
                  { backgroundColor: selected ? theme.accentSoft : hovered ? theme.surfaceRaised : 'transparent' },
                ]}
              >
                <View style={styles.optionText}>
                  <ThemedText type="small" style={selected ? { fontWeight: '600' } : undefined}>
                    {option.label}
                  </ThemedText>
                  {option.description ? (
                    <ThemedText type="caption" themeColor="textSecondary">
                      {option.description}
                    </ThemedText>
                  ) : null}
                </View>
                {selected ? <CheckIcon size={15} color={theme.accentText} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Popover>
    </>
  );
}

/** Mutually exclusive options shown side by side (tone, visibility, stage). */
export function ChoiceGroup<V extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: V | null;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
  label: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ hovered }) => [
              styles.choice,
              transition,
              {
                backgroundColor: active ? theme.accentSoft : hovered ? theme.surfaceRaised : theme.surface,
                borderColor: active ? theme.accentHover : theme.border,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[styles.choiceText, { color: theme.text, fontWeight: active ? '600' : '500' }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, minWidth: 0 },
  fieldLabel: { fontWeight: '600' },
  fieldFoot: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  fieldHelp: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  searchInput: { flex: 1, height: '100%', fontSize: 14, minWidth: 0 },
  switch: { width: 42, height: 24, borderRadius: 12, padding: 3, justifyContent: 'center' },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    marginTop: 1,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { flex: 1, gap: 2 },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 12,
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  selectSmall: { height: 34, paddingHorizontal: 10 },
  selectText: { flex: 1, fontSize: 14, fontWeight: '500' },
  options: { maxHeight: 320 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
  },
  optionText: { flex: 1, gap: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { paddingHorizontal: 14, height: 36, justifyContent: 'center', borderRadius: Radius.control, borderWidth: 1 },
  choiceText: { fontSize: 13 },
});
