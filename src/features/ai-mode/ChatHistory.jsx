import React, { useMemo, useRef, useState, useEffect } from 'react';
import { DEPARTMENTS, DEPT_KEYS } from './departments.js';

const deptOf = (c) => c.dept || 'sales';
const dayMs = 86400000;
function timeGroup(ts) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t = start.getTime();
  if (ts >= t) return 'Today';
  if (ts >= t - dayMs) return 'Yesterday';
  if (ts >= t - 7 * dayMs) return 'Previous 7 days';
  if (ts >= t - 30 * dayMs) return 'Previous 30 days';
  return 'Older';
}
const fmtDate = (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lastText = (c) => {
  const m = [...(c.messages || [])].reverse().find((x) => x.content && !x.content.startsWith('['));
  return m ? m.content.replace(/[*#`>_-]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
};

// ---- Export a chat as a Markdown file ----
export function exportChats(list) {
  const md = list.map((c) => {
    const lines = [`# ${c.title}`, `_${DEPARTMENTS[deptOf(c)].label} · ${fmtDate(c.updatedAt)}_`, ''];
    for (const m of c.messages || []) {
      const who = m.role === 'user' ? '**You**' : '**Synq AI**';
      const body = m.image ? `![image](${m.image})` : m.content || '';
      lines.push(`${who}: ${body}`, '');
    }
    return lines.join('\n');
  }).join('\n---\n\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = list.length === 1 ? `${list[0].title.replace(/[^\w\- ]+/g, '').slice(0, 40) || 'chat'}.md` : `synq-chats-${list.length}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const Ico = {
  search: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  filter: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>,
  panel: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>,
  plus: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  pin: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4h6l-1 6 4 3v2H6v-2l4-3zM12 15v6" /></svg>,
  edit: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></svg>,
  download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
  back: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>,
  dots: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>,
};
export { Ico as HistoryIcons };

// =====================================================================
// 1) Chats panel — sits next to the dashboard sidebar, can be closed
// =====================================================================
export function ChatPanel({ chats, activeId, currentDept, onOpen, onNew, onClose, onTogglePin }) {
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [groupBy, setGroupBy] = useState(() => { try { return localStorage.getItem('sa_panel_group') || 'dept'; } catch { return 'dept'; } });
  const [onlyDept, setOnlyDept] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => { try { localStorage.setItem('sa_panel_group', groupBy); } catch { /* ignore */ } }, [groupBy]);
  useEffect(() => {
    if (!menu) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const list = useMemo(() => chats
    .filter((c) => c.messages?.length)
    .filter((c) => !onlyDept || currentDept === 'general' || deptOf(c) === currentDept)
    .filter((c) => !q || (c.title + ' ' + lastText(c)).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt), [chats, q, onlyDept, currentDept]);

  const groups = useMemo(() => {
    const out = [];
    const pinned = list.filter((c) => c.pinned);
    if (pinned.length) out.push(['Pinned', pinned]);
    const rest = list.filter((c) => !c.pinned);
    const map = new Map();
    for (const c of rest) {
      const k = groupBy === 'dept' ? DEPARTMENTS[deptOf(c)].label : timeGroup(c.updatedAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
    if (groupBy === 'dept') {
      for (const d of DEPT_KEYS) { const k = DEPARTMENTS[d].label; if (map.has(k)) out.push([k, map.get(k), d]); }
    } else out.push(...map.entries());
    return out;
  }, [list, groupBy]);

  return (
    <aside className="sa-chatpanel" aria-label="Chats">
      <div className="sa-cp-head">
        <span>Chats</span>
        <div className="sa-cp-tools" ref={menuRef}>
          <button className={`sa-icon-btn ${searching ? 'on' : ''}`} onClick={() => { setSearching((v) => !v); setQ(''); }} title="Search chats" aria-label="Search chats">{Ico.search}</button>
          <button className={`sa-icon-btn ${menu ? 'on' : ''}`} onClick={() => setMenu((v) => !v)} title="Sort and filter" aria-label="Sort and filter">{Ico.filter}</button>
          <button className="sa-icon-btn" onClick={onClose} title="Close panel" aria-label="Close chats panel">{Ico.panel}</button>
          {menu && (
            <div className="sa-cp-menu" role="menu">
              <div className="sa-ask-title">Group by</div>
              <button className={groupBy === 'dept' ? 'on' : ''} onClick={() => setGroupBy('dept')}>Department</button>
              <button className={groupBy === 'time' ? 'on' : ''} onClick={() => setGroupBy('time')}>Date</button>
              <div className="sa-ask-title">Show</div>
              <button className={!onlyDept ? 'on' : ''} onClick={() => setOnlyDept(false)}>All departments</button>
              <button className={onlyDept ? 'on' : ''} onClick={() => setOnlyDept(true)}>Only {DEPARTMENTS[currentDept].label}</button>
            </div>
          )}
        </div>
      </div>
      {searching && <input className="sa-cp-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats…" />}
      <button className="sa-cp-new" onClick={onNew}>{Ico.plus}<span>New chat</span></button>
      <div className="sa-cp-list">
        {list.length === 0 && <p className="sa-empty-recents">{q ? 'No chats match your search.' : 'Your chats will show up here.'}</p>}
        {groups.map(([label, items, d]) => (
          <div key={label} className="sa-cp-group">
            <div className="sa-cp-label">{d && <i className="sa-dept-dot" style={{ background: DEPARTMENTS[d].color }} />}{label}</div>
            {items.map((c) => (
              <div key={c.id} className={`sa-cp-item ${c.id === activeId ? 'active' : ''}`} role="button" tabIndex={0}
                onClick={() => onOpen(c.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.id)} title={c.title}>
                <i className="sa-cp-ring" style={groupBy === 'time' || label === 'Pinned' ? { borderColor: DEPARTMENTS[deptOf(c)].color } : undefined} />
                <span>{c.title}</span>
                <button className={`sa-cp-pin ${c.pinned ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onTogglePin(c.id); }} title={c.pinned ? 'Unpin' : 'Pin'} aria-label={c.pinned ? 'Unpin chat' : 'Pin chat'}>{Ico.pin}</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

// =====================================================================
// 2) Full-screen chat history (opened from the clock button)
// =====================================================================
export function HistoryView({ chats, activeId, onOpen, onBack, onNew, onDelete, onRename, onTogglePin, onMove }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState(() => new Set());
  const [renaming, setRenaming] = useState(null);
  const [renameText, setRenameText] = useState('');
  const [confirm, setConfirm] = useState(null); // array of ids waiting for delete confirmation
  const [menuFor, setMenuFor] = useState(null);

  useEffect(() => {
    if (!menuFor) return;
    const h = (e) => { if (!e.target.closest('.sa-hv-more')) setMenuFor(null); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [menuFor]);

  const [openedAt] = useState(() => Date.now());
  const all = useMemo(() => chats.filter((c) => c.messages?.length), [chats]);
  const counts = useMemo(() => {
    const m = { all: all.length };
    for (const c of all) m[deptOf(c)] = (m[deptOf(c)] || 0) + 1;
    return m;
  }, [all]);
  const list = useMemo(() => {
    let l = all.filter((c) => dept === 'all' || deptOf(c) === dept)
      .filter((c) => !q || (c.title + ' ' + (c.messages || []).map((m) => m.content || '').join(' ')).toLowerCase().includes(q.toLowerCase()));
    if (sort === 'recent') l.sort((a, b) => b.updatedAt - a.updatedAt);
    if (sort === 'oldest') l.sort((a, b) => a.updatedAt - b.updatedAt);
    if (sort === 'az') l.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'longest') l.sort((a, b) => (b.messages?.length || 0) - (a.messages?.length || 0));
    return [...l.filter((c) => c.pinned), ...l.filter((c) => !c.pinned)];
  }, [all, q, dept, sort]);

  const allSelected = list.length > 0 && list.every((c) => selected.has(c.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedChats = chats.filter((c) => selected.has(c.id));
  const stats = { total: all.length, msgs: all.reduce((n, c) => n + (c.messages?.length || 0), 0), week: all.filter((c) => c.updatedAt > openedAt - 7 * dayMs).length };

  function saveRename(id) { if (renameText.trim()) onRename(id, renameText.trim()); setRenaming(null); }

  return (
    <div className="sa-hv">
      <div className="sa-hv-top">
        <button className="sa-btn-secondary sa-hv-back" onClick={onBack}>{Ico.back}<span>Back to chat</span></button>
        <h2>Chat history</h2>
        <button className="sa-upgrade-btn sa-hv-newbtn" onClick={onNew}>{Ico.plus}<span>New chat</span></button>
      </div>

      <div className="sa-hv-stats">
        <div><b>{stats.total}</b><span>chats</span></div>
        <div><b>{stats.msgs}</b><span>messages</span></div>
        <div><b>{stats.week}</b><span>active this week</span></div>
      </div>

      <div className="sa-hv-controls">
        <div className="sa-hv-search">{Ico.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and messages…" aria-label="Search chats" /></div>
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department" className={dept !== 'all' ? 'on' : ''}>
          <option value="all">All departments ({counts.all || 0})</option>
          {DEPT_KEYS.map((d) => <option key={d} value={d}>{DEPARTMENTS[d].label} ({counts[d] || 0})</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort chats">
          <option value="recent">Most recent</option>
          <option value="oldest">Oldest first</option>
          <option value="az">A → Z</option>
          <option value="longest">Most messages</option>
        </select>
      </div>

      <div className="sa-hv-chips">
        <button className={dept === 'all' ? 'on' : ''} onClick={() => setDept('all')}>All <small>{counts.all || 0}</small></button>
        {DEPT_KEYS.filter((d) => counts[d] || dept === d).map((d) => (
          <button key={d} className={dept === d ? 'on' : ''} onClick={() => setDept(d)}>
            <i className="sa-dept-dot" style={{ background: DEPARTMENTS[d].color }} />{DEPARTMENTS[d].label} <small>{counts[d] || 0}</small>
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="sa-hv-bulk">
          <span>{selected.size} selected</span>
          <button onClick={() => exportChats(selectedChats)}>{Ico.download}Export</button>
          <button className="danger" onClick={() => setConfirm([...selected])}>{Ico.trash}Delete</button>
          <button onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {confirm && (
        <div className="sa-hv-confirm" role="alertdialog">
          <span>Delete {confirm.length} chat{confirm.length === 1 ? '' : 's'}? This can’t be undone.</span>
          <button className="danger" onClick={() => { Promise.resolve(onDelete(confirm)).then(() => { setSelected(new Set()); setConfirm(null); }); }}>Delete</button>
          <button onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      )}

      <div className="sa-hv-list">
        {list.length > 0 && (
          <label className="sa-hv-selectall">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((c) => c.id)))} />
            <span>Select all ({list.length})</span>
          </label>
        )}
        {list.length === 0 && <div className="sa-hv-empty">{!all.length ? 'No chats yet. Start one and it will appear here.' : dept !== 'all' && !counts[dept] ? `No ${DEPARTMENTS[dept].label} chats yet.` : 'No chats match these filters.'}{(dept !== 'all' || q) && all.length > 0 && <button className="sa-link-btn" onClick={() => { setDept('all'); setQ(''); }}>Clear filters</button>}</div>}
        {list.map((c) => {
          const d = DEPARTMENTS[deptOf(c)];
          return (
            <div key={c.id} className={`sa-hv-row ${c.id === activeId ? 'active' : ''} ${selected.has(c.id) ? 'sel' : ''}`}>
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.title}`} />
              <div className="sa-hv-main" role="button" tabIndex={0} onClick={() => renaming !== c.id && onOpen(c.id)} onKeyDown={(e) => e.key === 'Enter' && renaming !== c.id && onOpen(c.id)}>
                {renaming === c.id ? (
                  <input className="sa-hv-rename" autoFocus value={renameText} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameText(e.target.value)} onBlur={() => saveRename(c.id)}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveRename(c.id); if (e.key === 'Escape') setRenaming(null); }} />
                ) : (
                  <div className="sa-hv-title">{c.pinned && <span className="sa-hv-pinned">{Ico.pin}</span>}{c.title}</div>
                )}
                <div className="sa-hv-preview">{lastText(c) || '—'}</div>
                <div className="sa-hv-meta">
                  <span className="sa-hv-dept" style={{ '--c': d.color }}><i className="sa-dept-dot" style={{ background: d.color }} />{d.label}</span>
                  <span>{c.messages.length} messages</span>
                  <span>{fmtDate(c.updatedAt)}</span>
                </div>
              </div>
              <div className="sa-hv-actions">
                <button onClick={() => onTogglePin(c.id)} title={c.pinned ? 'Unpin' : 'Pin'} aria-label={c.pinned ? 'Unpin' : 'Pin'} className={c.pinned ? 'on' : ''}>{Ico.pin}</button>
                <button onClick={() => { setRenaming(c.id); setRenameText(c.title); }} title="Rename" aria-label="Rename">{Ico.edit}</button>
                <button onClick={() => exportChats([c])} title="Export as file" aria-label="Export">{Ico.download}</button>
                <div className="sa-hv-more">
                  <button onClick={() => setMenuFor(menuFor === c.id ? null : c.id)} title="More" aria-label="More actions">{Ico.dots}</button>
                  {menuFor === c.id && (
                    <div className="sa-hv-menu">
                      <div className="sa-ask-title">Move to department</div>
                      {DEPT_KEYS.filter((k) => k !== deptOf(c)).map((k) => (
                        <button key={k} onClick={() => { onMove(c.id, k); setMenuFor(null); }}><i className="sa-dept-dot" style={{ background: DEPARTMENTS[k].color }} />{DEPARTMENTS[k].label}</button>
                      ))}
                      <button className="danger" onClick={() => { setConfirm([c.id]); setMenuFor(null); }}>{Ico.trash}Delete chat</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
