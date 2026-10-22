import type { ComponentType } from 'react';
declare const SalesAgent: ComponentType<{
  userId: string;
  dept: 'general' | 'sales' | 'marketing';
  embedded?: boolean;
  /** `synq` (dark) or `synq-light`, to match the app's theme. */
  theme?: string;
  initialPrompt?: string;
  onPromptSent?: () => void;
  onClose: () => void;
  onDeptChange: (department: string) => void;
  onOpenCalls: () => void;
}>;
export default SalesAgent;
