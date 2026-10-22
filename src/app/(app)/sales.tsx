import { SalesWorkspace } from '@/components/sales-workspace';
import { View } from 'react-native';

export default function SalesScreen() {
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <SalesWorkspace />
    </View>
  );
}
