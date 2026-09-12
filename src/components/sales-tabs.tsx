import { TabStrip, type Tab } from '@/components/tab-strip';

// Deliberately missing: "Analytics", whose only real numbers are the outcome
// counts already shown on Cold Call, and "Overview", which would restate the
// dashboard. Both would have been pages that exist to fill a tab strip.
const TABS: Tab[] = [
  { label: 'Sales AI', path: '/sales' },
  { label: 'CRM', path: '/import-leads' },
  { label: 'Cold Call', path: '/cold-call' },
  { label: 'Follow-ups', path: '/follow-ups' },
];

export function SalesTabs() {
  return <TabStrip tabs={TABS} />;
}
