import { Pressable, View } from 'react-native';
import { ChatPanel } from '@/components/chat-panel';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export type AIWorkspaceProps = {
  department: 'general' | 'sales' | 'marketing';
  onClose: () => void;
  onDepartment: (department: string) => void;
  onOpenCalls: () => void;
};

export function AIWorkspace({ department, onClose }: AIWorkspaceProps) {
  return <View style={{ flex: 1, padding: Spacing.three, gap: Spacing.three }}>
    <Pressable accessibilityRole="button" onPress={onClose} style={{ alignSelf: 'flex-end' }}><ThemedText>Close AI mode ×</ThemedText></Pressable>
    <ChatPanel key={department} kind={department === 'general' ? 'assistant' : department === 'marketing' ? 'content' : 'sales_ai'} context={{ ai_mode: true }} height={400} />
    <ThemedText type="caption">Open SYNQ in your browser for the full image and poster workspace.</ThemedText>
  </View>;
}
