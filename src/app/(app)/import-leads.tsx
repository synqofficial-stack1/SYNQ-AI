import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  CsvImportError,
  importLeads,
  parseLeadsCsv,
  type CsvImportPreview,
} from '@/lib/leads';

const SAMPLE = `name,phone,email,company,notes
Ada Chen,555-0142,ada@acme.com,Acme Co,"Budget approved, wants a demo in Q3"`;

/**
 * Bulk import leads from a CRM export.
 *
 * Deliberately two steps: paste, check, then import. A mis-mapped column is far
 * cheaper to spot in the preview than to unpick after a few hundred rows have
 * landed in the table.
 */
export default function ImportLeadsScreen() {
  const theme = useTheme();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  function handleCheck() {
    setError(null);
    setImported(null);
    try {
      setPreview(parseLeadsCsv(csv));
    } catch (e) {
      setPreview(null);
      setError(e instanceof CsvImportError ? e.message : 'Could not read that file.');
    }
  }

  async function handleImport() {
    if (!preview) return;
    setError(null);
    setLoading(true);
    try {
      const result = await importLeads(preview.leads, preview.problems);
      setImported(result.inserted);
      setPreview(null);
      setCsv('');
    } catch (e) {
      setError(
        e instanceof CsvImportError
          ? e.message
          : 'Could not reach the server. Check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Import leads</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Open your CRM export in a spreadsheet, copy everything including the
            top row of column names, and paste it below. Columns understood:
            name, phone, email, company, notes. Anything else is ignored.
          </ThemedText>

          <TextField
            placeholder={SAMPLE}
            value={csv}
            onChangeText={(text) => {
              setCsv(text);
              setPreview(null);
              setImported(null);
            }}
            multiline
            numberOfLines={10}
            style={styles.csvInput}
          />

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          {imported !== null ? (
            <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.success}>
                Imported {imported} {imported === 1 ? 'lead' : 'leads'}.
              </ThemedText>
            </View>
          ) : null}

          {preview ? (
            <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">
                {preview.leads.length} {preview.leads.length === 1 ? 'lead' : 'leads'} ready
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Using: {preview.matchedColumns.join(', ')}
              </ThemedText>
              {preview.ignoredColumns.length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Ignoring: {preview.ignoredColumns.join(', ')}
                </ThemedText>
              ) : null}
              {preview.problems.map((problem) => (
                <ThemedText key={problem} type="small" style={styles.problem}>
                  {problem}
                </ThemedText>
              ))}
            </View>
          ) : null}

          {preview && preview.leads.length > 0 ? (
            <PrimaryButton
              title={`Import ${preview.leads.length} ${preview.leads.length === 1 ? 'lead' : 'leads'}`}
              onPress={handleImport}
              loading={loading}
            />
          ) : (
            <PrimaryButton title="Check file" onPress={handleCheck} />
          )}

          <PrimaryButton
            title="Back"
            // Opened directly by URL there is no history to pop, so fall back to
            // the home screen rather than doing nothing.
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)'))}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  csvInput: {
    minHeight: 180,
    textAlignVertical: 'top',
    fontSize: 13,
  },
  panel: { gap: Spacing.two, padding: Spacing.three, borderRadius: 12 },
  error: { color: '#e5484d' },
  problem: { color: '#d97706' },
  success: { color: '#16a34a' },
});
