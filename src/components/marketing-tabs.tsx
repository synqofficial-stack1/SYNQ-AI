import { TabStrip, type Tab } from '@/components/tab-strip';

// Calendar and Leads land next. "Analytics" is absent until a channel
// integration exists to measure — reach, CTR and cost-per-lead have no source
// today, and a tab full of invented numbers is worse than no tab.
const TABS: Tab[] = [
  { label: 'Overview', path: '/marketing' },
  { label: 'Campaigns', path: '/campaigns' },
  { label: 'Content', path: '/content' },
];

export function MarketingTabs() {
  return <TabStrip tabs={TABS} />;
}
