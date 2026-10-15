import SalesAgent from '@/features/ai-mode/SalesAgent';
import { useSession } from '@/hooks/use-session';

export type AIWorkspaceProps = {
  department: 'general' | 'sales' | 'marketing';
  onClose: () => void;
  onDepartment: (department: string) => void;
  onOpenCalls: () => void;
};

export function AIWorkspace({ department, onClose, onDepartment, onOpenCalls }: AIWorkspaceProps) {
  const { session } = useSession();
  if (!session) return null;
  return <SalesAgent key={session.user.id} userId={session.user.id} embedded theme="synq" dept={department} onClose={onClose} onDeptChange={onDepartment} onOpenCalls={onOpenCalls} />;
}
