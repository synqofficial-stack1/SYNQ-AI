import { TabStrip, type Tab } from '@/components/tab-strip';

// Deliberately missing: "Analytics", whose only real numbers are the outcome
// counts already shown on Cold Call, and "Overview", which would restate the
// dashboard. Both would have been pages that exist to fill a tab strip.
// CRM is off the strip: Cold Call takes a dropped file directly, so importing
// no longer needs its own destination. The page itself still exists.
const TABS: Tab[] = [
  { label: 'Sales', path: '/sales' },
  { label: 'Cold Call', path: '/cold-call' },
  { label: 'Follow-ups', path: '/follow-ups' },
];

export function SalesTabs() {
  return <TabStrip tabs={TABS} />;
}
