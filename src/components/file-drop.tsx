import { createElement, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Web only, by necessity: React Native has no file-picker primitive, and
// `expo-document-picker` is not an approved dependency. On web the tree is real
// DOM, so a plain <input type="file"> works with nothing installed. On a phone
// this renders nothing and the paste box remains the way in.
//
// CSV only. Excel support would mean SheetJS, whose npm build carries two
// unfixed high-severity advisories (prototype pollution, ReDoS) and would be
// parsing exactly this: files from outside. Exporting to CSV is one click.

export function FileDrop({
  onText,
  disabled,
}: {
  onText: (text: string, filename: string) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (Platform.OS !== 'web') return null;

  const read = (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setProblem(
        `"${file.name}" isn't a CSV. In Excel or Sheets choose File → Save as / Export → CSV, then drop that file here.`
      );
      return;
    }
    setProblem(null);
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result ?? ''), file.name);
    reader.onerror = () => setProblem('That file could not be read.');
    reader.readAsText(file);
  };

  return createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: Spacing.five,
        borderRadius: Radius.card,
        border: `1px dashed ${dragging ? AccentColors.primary : theme.borderStrong}`,
        backgroundColor: dragging ? theme.surfaceRaised : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 140ms, border-color 140ms',
        textAlign: 'center',
      },
      onClick: () => !disabled && inputRef.current?.click(),
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      },
      onDragLeave: () => setDragging(false),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) read(event.dataTransfer?.files?.[0]);
      },
    },
    createElement('input', {
      ref: inputRef,
      type: 'file',
      accept: '.csv,text/csv',
      style: { display: 'none' },
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        read(event.target.files?.[0]);
        // Cleared so picking the same file twice still fires onChange.
        event.target.value = '';
      },
    }),
    createElement(
      'span',
      { key: 'title', style: { color: theme.text, fontSize: 14, fontWeight: 500 } },
      dragging ? 'Drop to import' : 'Drop a CRM file here, or click to choose'
    ),
    createElement(
      'span',
      { key: 'sub', style: { color: theme.textSecondary, fontSize: 12 } },
      'CSV only — export from Excel or Sheets with File → Save as → CSV'
    ),
    problem
      ? createElement(
          'span',
          { key: 'problem', style: { color: AccentColors.error, fontSize: 12, marginTop: 4 } },
          problem
        )
      : null
  );
}
