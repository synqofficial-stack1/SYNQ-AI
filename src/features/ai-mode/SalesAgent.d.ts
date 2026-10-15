import type { ComponentType } from 'react';
declare const SalesAgent: ComponentType<{
  userId: string;
  dept: 'general' | 'sales' | 'marketing';
  embedded?: boolean;
  theme?: string;
  onClose: () => void;
  onDeptChange: (department: string) => void;
  onOpenCalls: () => void;
}>;
export default SalesAgent;
