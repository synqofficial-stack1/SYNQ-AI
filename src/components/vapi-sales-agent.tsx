import { ThemedText } from '@/components/themed-text';

/** Native platforms do not support Vapi's browser Web SDK. */
export function VapiSalesAgent() {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Vapi voice testing is available in Synq for web browsers.
    </ThemedText>
  );
}
