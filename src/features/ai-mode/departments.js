// Departments ("AI employees") and the helpers that give the AI context about ongoing work.
export const DEPARTMENTS = {
  general: {
    suggestions: [{ title: 'Catch me up', text: 'Catch me up on everything happening across my business and tell me the top 3 priorities today.' }, { title: 'Weekly plan', text: 'Make a simple weekly plan across sales, marketing and operations for my business.' }, { title: 'Grow revenue', text: 'What are the 3 fastest ways to grow revenue for a small business like mine?' }, { title: 'Cut costs', text: 'Where could a small business like mine be wasting money?' }],
    label: 'General', role: 'Chief of Staff', color: '#E8B931',
    hello: 'What should we focus on today?',
    sub: 'Priorities across every department, in one place.',
    keywords: /(?!)/, // never auto-detected; used on Dashboard / Control Center
  },
  sales: {
    suggestions: [{ title: 'Plan my week', text: 'What should my sales team focus on this week? Ask me for any numbers you need.' }, { title: 'Cold email', text: 'Write a short cold email to a small business owner for our product.' }, { title: 'Fix my pipeline', text: 'We get leads but few convert to sales. Diagnose what could be wrong.' }, { title: 'Follow-up script', text: 'Write a WhatsApp follow-up for a customer who asked for a price but went quiet.' }],
    label: 'Sales', role: 'Sales Manager', color: '#2f6b5a',
    hello: 'What should we sell today?',
    sub: 'Next steps, market trends, call campaigns and pipeline fixes.',
    keywords: /\b(sales?|sell|lead|leads|deal|deals|pipeline|prospect|client|closing|close|quota|target|call|calls|cold email|follow[- ]?up|pricing|quote|demo|crm|conversion)\b/i,
  },
  marketing: {
    suggestions: [{ title: 'Create a poster', text: 'Make a festive poster for my shop' }, { title: 'Reel ideas', text: 'Give me 5 Instagram reel ideas for my business this week.' }, { title: 'Content calendar', text: 'Make a 7-day Instagram content calendar for my business.' }, { title: 'Festival offer', text: 'Plan a festival offer campaign for my shop.' }],
    label: 'Marketing', role: 'Marketing Manager', color: '#b3541e',
    hello: 'What are we promoting today?',
    sub: 'Posters, reels, campaigns, content calendars and ad copy.',
    keywords: /\b(market(ing)?|poster|reel|reels|instagram|insta|facebook|youtube|social|post|posts|content|ad|ads|campaign|brand|branding|seo|followers|caption|hashtag|influencer|banner|flyer|whatsapp status)\b/i,
  },

};
export const DEPT_KEYS = Object.keys(DEPARTMENTS);
export const WORK_DEPTS = DEPT_KEYS.filter((k) => k !== 'general');

// Pick the department whose keywords match the message most; null if nothing matches.
export function detectDept(text) {
  let best = null; let bestScore = 0;
  for (const key of WORK_DEPTS) {
    const re = new RegExp(DEPARTMENTS[key].keywords.source, 'gi');
    const score = (String(text).match(re) || []).length;
    if (score > bestScore) { best = key; bestScore = score; }
  }
  return best;
}

// Summarise the user's other recent chats in this department so the AI can continue from them.
export function buildWorkContext(chats, dept, excludeId) {
  const recent = chats
    .filter((c) => (dept === 'general' || (c.dept || 'sales') === dept) && c.id !== excludeId && c.messages?.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
  if (!recent.length) return '';
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  return recent.map((c) => {
    const when = new Date(c.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const lastUser = [...c.messages].reverse().find((m) => m.role === 'user')?.content || '';
    const lastAi = [...c.messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content || '';
    const tag = dept === 'general' ? ` [${DEPARTMENTS[c.dept || 'sales']?.label || 'Sales'}]` : '';
    return `- "${clip(c.title, 60)}"${tag} (${when}): user last asked: "${clip(lastUser, 200)}" → AI last replied: "${clip(lastAi.replace(/\s+/g, ' '), 300)}"`;
  }).join('\n');
}
