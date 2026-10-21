import { TabStrip, type Tab } from '@/components/tab-strip';

// Email outreach owns its campaign analytics and reports. Calling is paused.
const TABS: Tab[] = [
  { label: 'Email outreach', path: '/sales' },
  { label: 'Follow-ups', path: '/follow-ups' },
];

export function SalesTabs() {
  return <TabStrip tabs={TABS} />;
}
