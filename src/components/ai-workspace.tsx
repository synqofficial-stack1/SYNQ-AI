import { View } from 'react-native';
import { ChatPanel } from '@/components/chat-panel';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';

export type AIWorkspaceProps = {
  department: 'general' | 'sales' | 'marketing';
  onClose: () => void;
  onDepartment: (department: string) => void;
  onOpenCalls: () => void;
  initialPrompt?: string;
  onPromptSent?: () => void;
};

export function AIWorkspace({ department, onClose, initialPrompt }: AIWorkspaceProps) {
  return <View style={{ flex: 1, padding: Spacing.three, gap: Spacing.three }}>
    <View style={{ alignSelf: 'flex-end' }}><Button label="Close assistant" size="sm" onPress={onClose} /></View>
    <ChatPanel key={department} kind={department === 'general' ? 'assistant' : department === 'marketing' ? 'content' : 'sales_ai'} context={{ ai_mode: true }} height={400} seedMessage={initialPrompt} />
    <ThemedText type="caption" themeColor="textSecondary">Open Synq in your browser for the full image and poster workspace.</ThemedText>
  </View>;
}
