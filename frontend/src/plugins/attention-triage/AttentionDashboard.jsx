import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../utils/api.js';
import { useStore } from '../../store/index.js';
import { openDeepLinkMessage } from '../../utils/gtd.js';
import {
  ATTENTION_FILTERS, attentionCounts, attentionStateLabel, canAcknowledgeAttentionItem, visibleAttentionItems,
} from './attentionView.js';

// Safe action list: explicit owner acknowledgements only update plugin metadata.
// Server handles authorization; email bodies and mailbox flags are not exposed.
const surface = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
};
const buttonBase = {
  cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 7,
  background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
  padding: '7px 11px', fontSize: 12,
};

function priorityPresentation(item) {
  if (item.attention === 'REVIEW') {
    return { text: 'REVIEW', color: 'var(--text-secondary)' };
  }
  if (item.priority === 'HIGH') return { text: 'HIGH', color: 'var(--red, #e05858)' };
  if (item.priority === 'MEDIUM') return { text: 'MEDIUM', color: 'var(--accent)' };
  return { text: 'LOW', color: 'var(--text-secondary)' };
}

function readableTime(raw) {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function AttentionDashboard({ onClose }) {
  const accounts = useStore(s => s.accounts);
  const focusRef = useRef(null);
  const [accountId, setAccountId] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [refresh, setRefresh] = useState(0);
  const [response, setResponse] = useState({ items: [], hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState(null);
  const [acknowledgingId, setAcknowledgingId] = useState(null);
  const [lastAck, setLastAck] = useState(null);

  useEffect(() => {
    focusRef.current?.focus();
    const esc = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  useEffect(() => {
    let mounted = true;
    const reload = async (foreground = false) => {
      if (foreground) setLoading(true);
      try {
        const scope = accountId ? '&accountId=' + encodeURIComponent(accountId) : '';
        const data = await api.get('/attention/items?limit=50' + scope);
        if (!mounted) return;
        setResponse({
          items: Array.isArray(data?.items) ? data.items : [],
          hasMore: data?.hasMore === true,
        });
        setError('');
      } catch {
        if (mounted) setError('Could not load the attention list. Please try refreshing.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void reload(true);
    // Poll only while this dialog is open, never constantly across inbox screens.
    const interval = setInterval(() => { void reload(); }, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, [accountId, refresh]);

  const items = response.items;
  const counts = useMemo(() => attentionCounts(items), [items]);
  const shown = useMemo(() => visibleAttentionItems(items, filter), [items, filter]);

  const openMessage = async (item) => {
    if (openingId) return;
    setOpeningId(item.id);
    try {
      const store = useStore.getState();
      const msg = await openDeepLinkMessage(item.id, {
        getMessage: api.getMessage,
        getThread: api.getThread,
        setThreadMessages: store.setThreadMessages,
        setSelectedMessage: store.setSelectedMessage,
      });
      if (!msg) {
        setError('The email could not be opened. It may have been moved or deleted.');
        return;
      }
      store.setMobileSidebarOpen?.(false);
      onClose();
    } catch {
      setError('The email could not be opened. Please refresh the list and try again.');
    } finally {
      setOpeningId(null);
    }
  };

  // No optimistic dismissal until the server confirms the owner's action.
  const acknowledge = async (item, status) => {
    if (acknowledgingId || openingId || !canAcknowledgeAttentionItem(item)) return;
    setAcknowledgingId(item.id);
    try {
      await api.patch('/attention/items/' + encodeURIComponent(item.id) + '/status', { status });
      setResponse(prev => ({
        ...prev, items: prev.items.filter(existing => existing.id !== item.id),
      }));
      setLastAck({ item, previousStatus: item.ownerStatus || 'OPEN', status });
      setError('');
    } catch {
      setError('The acknowledgement could not be saved. Please try again.');
    } finally {
      setAcknowledgingId(null);
    }
  };

  const undoAcknowledgement = async () => {
    if (!lastAck || acknowledgingId) return;
    const { item, previousStatus } = lastAck;
    setAcknowledgingId(item.id);
    try {
      await api.patch('/attention/items/' + encodeURIComponent(item.id) + '/status',
        { status: previousStatus });
      setLastAck(null);
      setError('');
      setRefresh(value => value + 1);
    } catch {
      setError('Could not undo the acknowledgement. Please try again.');
    } finally {
      setAcknowledgingId(null);
    }
  };

  const filterLabels = { ALL: 'All', HIGH: 'High priority', REVIEW: 'Needs review' };
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 6000,
        background: 'rgba(0,0,0,0.65)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 12,
      }}
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <section
        ref={focusRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attention-dashboard-title"
        style={{
          ...surface, outline: 'none', borderRadius: 14,
          width: 'min(880px, 100%)', maxHeight: 'min(88vh, 900px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <header style={{
          padding: '18px 20px 14px', flexShrink: 0,
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 700, letterSpacing: '0.09em' }}>
              MAIL COMMAND CENTRE
            </div>
            <h2 id="attention-dashboard-title" style={{ margin: '5px 0 3px', fontSize: 23 }}>
              Needs Attention
            </h2>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              Important email and messages awaiting review · Owner-controlled actions
            </div>
          </div>
          <button type="button" aria-label="Close Needs Attention" onClick={onClose}
            style={{ ...buttonBase, fontSize: 18, padding: '4px 11px' }}>
            ×
          </button>
        </header>

        <div style={{
          padding: '13px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          gap: 10, borderBottom: '1px solid var(--border-subtle)',
        }}>
          <select
            aria-label="Filter by mailbox"
            value={accountId}
            onChange={e => { setFilter('ALL'); setAccountId(e.target.value); }}
            style={{ ...buttonBase, flex: '1 1 190px', minWidth: 0 }}
          >
            <option value="">All mailboxes</option>
            {accounts.filter(a => a.enabled).map(a => (
              <option key={a.id} value={a.id}>{a.name || a.email_address}</option>
            ))}
          </select>
          <button type="button" style={buttonBase}
            aria-label="Refresh attention list" onClick={() => setRefresh(v => v + 1)}>
            Refresh
          </button>
        </div>

        <div style={{ padding: '11px 20px 10px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ATTENTION_FILTERS.map(name => {
            const selected = filter === name;
            const number = name === 'ALL' ? counts.all : name === 'HIGH' ? counts.high : counts.review;
            return (
              <button key={name} type="button" aria-pressed={selected}
                onClick={() => setFilter(name)}
                style={{
                  ...buttonBase,
                  borderColor: selected ? 'var(--accent)' : 'var(--border)',
                  color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                  background: selected ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
                  fontWeight: selected ? 700 : 500,
                }}>
                {filterLabels[name]} · {number}
              </button>
            );
          })}
        </div>

        {lastAck && (
          <div role="status" style={{
            padding: '9px 20px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
            fontSize: 12, borderBottom: '1px solid var(--border-subtle)',
          }}>
            <span>
              Marked as {lastAck.status === 'EXPECTED' ? 'Expected' : 'Resolved'}.
              The email itself was not changed.
            </span>
            <button type="button" disabled={acknowledgingId !== null}
              style={buttonBase} onClick={() => { void undoAcknowledgement(); }}>
              Undo
            </button>
          </div>
        )}

        {error && (
          <div role="alert" style={{
            padding: '9px 20px', color: 'var(--red, #e05858)',
            background: 'var(--bg-tertiary)', fontSize: 12,
          }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: '7px 20px 20px', minHeight: 80 }}>
          {loading && !items.length ? (
            <div role="status" style={{ padding: 24, color: 'var(--text-secondary)', textAlign: 'center' }}>
              Loading attention items…
            </div>
          ) : shown.length === 0 ? (
            <div style={{
              padding: '30px 16px', border: '1px dashed var(--border)',
              borderRadius: 10, textAlign: 'center', color: 'var(--text-secondary)',
              fontSize: 13,
            }}>
              {error ? 'No attention results are available right now.'
                : filter === 'ALL'
                  ? 'No items have been classified as needing attention yet.'
                  : 'No items match this filter.'}
            </div>
          ) : shown.map(item => {
            const priority = priorityPresentation(item);
            const awaiting = item.attention === 'REVIEW';
            return (
              <article key={item.accountId + ':' + item.id} style={{
                ...surface, marginBottom: 10, borderRadius: 9, padding: '14px 15px',
                borderLeft: '3px solid ' + (item.priority === 'HIGH' && !awaiting ?
                  'var(--red, #e05858)' : 'var(--accent)'),
              }}>
                <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                    color: priority.color, background: 'var(--bg-tertiary)',
                    padding: '4px 7px', borderRadius: 5,
                  }}>
                    {priority.text}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {awaiting ? attentionStateLabel(item) : (item.category || 'Attention')}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {readableTime(item.receivedAt)}
                  </span>
                </div>

                <div style={{
                  fontWeight: 700, fontSize: 14, color: 'var(--text-primary)',
                  marginTop: 9, overflowWrap: 'anywhere',
                }}>
                  {item.subject || '(no subject)'}
                </div>
                <div style={{
                  marginTop: 3, fontSize: 11, color: 'var(--text-secondary)',
                  overflowWrap: 'anywhere',
                }}>
                  {item.from || item.fromEmail || '(unknown sender)'} · {item.mailbox}
                </div>
                {item.why && (
                  <p style={{ fontSize: 12, lineHeight: 1.55, margin: '10px 0 4px',
                    color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                    {item.why}
                  </p>
                )}
                {item.action && item.action !== 'NONE' && (
                  <p style={{ fontSize: 12, lineHeight: 1.55, margin: '5px 0',
                    color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                    <strong>Suggested action: </strong>{item.action}
                  </p>
                )}
                {item.deadline && item.deadline !== 'NONE' && (
                  <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text-secondary)' }}>
                    Deadline: {item.deadline}
                  </div>
                )}
                <div style={{
                  display: 'flex', justifyContent: 'flex-end',
                  alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12,
                }}>
                  {canAcknowledgeAttentionItem(item) && (
                    <>
                      <button type="button" style={buttonBase}
                        title="I expected this event; no action is needed"
                        disabled={acknowledgingId !== null || openingId !== null}
                        onClick={() => { void acknowledge(item, 'EXPECTED'); }}>
                        {acknowledgingId === item.id ? 'Saving…' : 'Expected'}
                      </button>
                      <button type="button" style={buttonBase}
                        title="I have handled this email"
                        disabled={acknowledgingId !== null || openingId !== null}
                        onClick={() => { void acknowledge(item, 'RESOLVED'); }}>
                        {acknowledgingId === item.id ? 'Saving…' : 'Resolved'}
                      </button>
                    </>
                  )}
                  <button type="button" style={buttonBase}
                    disabled={openingId !== null || acknowledgingId !== null}
                    onClick={() => { void openMessage(item); }}>
                    {openingId === item.id ? 'Opening…' : 'Open email'}
                  </button>
                </div>
              </article>
            );
          })}
          {response.hasMore && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 10 }}>
              Showing the first 50 results. Select a mailbox to narrow the list.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
