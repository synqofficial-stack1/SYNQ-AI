import { TabStrip, type Tab } from '@/components/tab-strip';

// Follow-ups used to be its own screen. It now redirects to Sales, so a tab
// with that name only bounced people. These two open the pages that exist.
const TABS: Tab[] = [
  { label: 'Sales', path: '/sales' },
  { label: 'Import leads', path: '/import-leads' },
];

export function SalesTabs() {
  return <TabStrip tabs={TABS} />;
}
