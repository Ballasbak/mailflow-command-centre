import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';

// Account controls are deliberately OFF-ONLY in this development build.
// This panel never connects IMAP, invokes an AI model or enables a mailbox.
export default function AttentionMonitoringControls() {
  const [expanded, setExpanded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!expanded) return undefined;
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const result = await api.get('/attention/accounts');
        if (!mounted) return;
        setAccounts(Array.isArray(result?.accounts) ? result.accounts : []);
        setError('');
      } catch {
        if (mounted) setError('Unable to load mailbox monitoring settings.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [expanded, refreshKey]);

  const disable = async (accountId) => {
    if (busyId) return;
    setBusyId(accountId);
    setNotice('');
    try {
      await api.patch('/attention/accounts/' + encodeURIComponent(accountId) + '/automation',
        { enabled: false });
      setNotice('Automatic triage is OFF for that mailbox; its activation baseline was cleared.');
      setRefreshKey(key => key + 1);
      setError('');
    } catch {
      setError('The disable request could not be confirmed. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '2px 20px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
      <button type="button" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        style={{
          cursor: 'pointer', padding: '8px 4px', border: 'none',
          background: 'transparent', color: 'var(--text-secondary)',
          fontSize: 12, fontWeight: 600, textAlign: 'left',
        }}>
        {expanded ? '▾' : '▸'} Monitoring controls
      </button>
      {expanded && (
        <section aria-label="Mailbox monitoring controls" style={{
          background: 'var(--bg-tertiary)', borderRadius: 9,
          padding: '12px 14px', fontSize: 12,
          color: 'var(--text-secondary)',
        }}>
          <strong style={{ color: 'var(--text-primary)' }}>Automatic triage is locked</strong>
          <p style={{ margin: '6px 0 12px', lineHeight: 1.5 }}>
            No mailbox can be enabled until the remaining safety checks pass.
            You can still disable any previously stored opt-in.
            This does not affect the Needs Attention dashboard.
          </p>
          {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {loading ? (
            <p role="status">Checking mailbox settings…</p>
          ) : accounts.length === 0 ? (
            <p>No mailboxes were found for this user.</p>
          ) : accounts.map(account => (
            <div key={account.id} style={{
              borderTop: '1px solid var(--border)',
              padding: '10px 0', display: 'flex',
              alignItems: 'center', flexWrap: 'wrap',
              gap: 10, justifyContent: 'space-between',
            }}>
              <div style={{ minWidth: 180, flex: 1 }}>
                <strong style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {account.name || account.emailAddress}
                </strong>
                <div style={{ fontSize: 11, overflowWrap: 'anywhere', marginTop: 2 }}>
                  {account.emailAddress}
                </div>
                <div style={{ fontSize: 11, marginTop: 3 }}>
                  Automation: OFF {account.mailboxEnabled === false ? '· Mailbox offline' : ''}
                  {account.storedOptIn === true ? ' · Stale opt-in detected' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {account.storedOptIn === true && (
                  <button type="button"
                    disabled={busyId !== null}
                    onClick={() => { void disable(account.id); }}
                    style={{
                      cursor: 'pointer', border: '1px solid var(--border)',
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                      padding: '7px 9px', borderRadius: 7,
                    }}>
                    {busyId === account.id ? 'Disabling…' : 'Disable'}
                  </button>
                )}
                <span style={{
                  border: '1px solid var(--border)', padding: '7px 9px',
                  borderRadius: 7, fontSize: 11,
                }}>Enable locked</span>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
