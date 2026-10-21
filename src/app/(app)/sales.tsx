import { SalesWorkspace } from '@/components/sales-workspace';
import { VapiSalesAgent } from '@/components/vapi-sales-agent';
import { View } from 'react-native';

export default function SalesScreen() {
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <VapiSalesAgent />
      <SalesWorkspace />
    </View>
  );
}
