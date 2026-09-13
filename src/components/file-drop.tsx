import { createElement, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Web only, by necessity: React Native has no file-picker primitive, and
// `expo-document-picker` is not an approved dependency. On web the tree is real
// DOM, so a plain <input type="file"> works with nothing installed. On a phone
// this renders nothing and the paste box remains the way in.
//
// Spreadsheets are converted to CSV here and handed on as text, so the existing
// column-alias matching and row limits in `parseLeadsCsv` apply to every format
// without being reimplemented per file type.
//
// SheetJS comes from the vendor's own CDN, not npm. The registry build is
// abandoned at 0.18.5 with two unfixed high-severity advisories (prototype
// pollution, ReDoS); the CDN ships patched releases. That matters here more than
// most places because this code parses files from outside.

const SPREADSHEET_EXTENSIONS = /\.(xlsx|xlsm|xlsb|xls|ods|fods)$/i;
const TEXT_EXTENSIONS = /\.(csv|tsv|txt)$/i;

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
  const [busy, setBusy] = useState(false);

  if (Platform.OS !== 'web') return null;

  const readSpreadsheet = async (file: File) => {
    // Loaded on demand: SheetJS is large, and most sessions never drop a file.
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });

    // Workbooks often lead with a cover or notes tab, so take the first sheet
    // that actually has rows rather than blindly the first one.
    for (const name of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      if (csv.trim()) {
        return { csv, sheet: name, sheetCount: workbook.SheetNames.length };
      }
    }
    return null;
  };

  const read = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);

    const isSpreadsheet = SPREADSHEET_EXTENSIONS.test(file.name);
    const isText = TEXT_EXTENSIONS.test(file.name);

    if (!isSpreadsheet && !isText) {
      setProblem(
        `"${file.name}" isn't a spreadsheet. Excel (.xlsx, .xls), OpenDocument (.ods) and CSV all work — Google Sheets exports to any of them via File → Download.`
      );
      return;
    }

    setBusy(true);
    try {
      if (isSpreadsheet) {
        const result = await readSpreadsheet(file);
        if (!result) {
          setProblem(`"${file.name}" has no rows in any of its sheets.`);
          return;
        }
        onText(result.csv, file.name);
        if (result.sheetCount > 1) {
          setProblem(
            `Read the "${result.sheet}" sheet. ${file.name} has ${result.sheetCount} sheets — if the contacts are on a different one, move it to the front and drop the file again.`
          );
        }
      } else {
        onText(await file.text(), file.name);
      }
    } catch {
      setProblem(`"${file.name}" could not be read. If it's password-protected, remove that first.`);
    } finally {
      setBusy(false);
    }
  };

  const inert = disabled || busy;

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
        cursor: inert ? 'progress' : 'pointer',
        opacity: inert ? 0.6 : 1,
        transition: 'background-color 140ms, border-color 140ms',
        textAlign: 'center',
      },
      onClick: () => !inert && inputRef.current?.click(),
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        if (!inert) setDragging(true);
      },
      onDragLeave: () => setDragging(false),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(false);
        if (!inert) read(event.dataTransfer?.files?.[0]);
      },
    },
    createElement('input', {
      ref: inputRef,
      type: 'file',
      accept: '.csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,.ods,.fods',
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
      busy ? 'Reading…' : dragging ? 'Drop to import' : 'Drop a CRM file here, or click to choose'
    ),
    createElement(
      'span',
      { key: 'sub', style: { color: theme.textSecondary, fontSize: 12 } },
      'Excel, Google Sheets, OpenDocument or CSV'
    ),
    problem
      ? createElement(
          'span',
          { key: 'problem', style: { color: AccentColors.warning, fontSize: 12, marginTop: 4 } },
          problem
        )
      : null
  );
}
