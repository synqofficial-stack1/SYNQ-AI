import SalesAgent from '@/features/ai-mode/SalesAgent';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/hooks/use-session';

export type AIWorkspaceProps = {
  department: 'general' | 'sales' | 'marketing';
  onClose: () => void;
  onDepartment: (department: string) => void;
  onOpenCalls: () => void;
  initialPrompt?: string;
  onPromptSent?: () => void;
};

export function AIWorkspace({ department, onClose, onDepartment, onOpenCalls, initialPrompt, onPromptSent }: AIWorkspaceProps) {
  const { session } = useSession();
  const scheme = useColorScheme();
  if (!session) return null;
  return (
    <SalesAgent
      key={session.user.id}
      userId={session.user.id}
      embedded
      theme={scheme === 'dark' ? 'synq' : 'synq-light'}
      dept={department}
      initialPrompt={initialPrompt}
      onPromptSent={onPromptSent}
      onClose={onClose}
      onDeptChange={onDepartment}
      onOpenCalls={onOpenCalls}
    />
  );
}
