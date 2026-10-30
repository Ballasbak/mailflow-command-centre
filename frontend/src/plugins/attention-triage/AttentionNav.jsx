import { useState } from 'react';
import { createPortal } from 'react-dom';
import AttentionDashboard from './AttentionDashboard.jsx';

// Visible only when the owner activates the plugin in MailFlow.
// Opening this dialog neither starts AI processing nor changes mailbox state.
export default function AttentionNav({ collapsed = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button"
        aria-haspopup="dialog"
        aria-label="Open Needs Attention dashboard"
        title="Needs Attention"
        onClick={() => setOpen(true)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 8, padding: collapsed ? '9px' : '8px 10px',
          background: open ? 'var(--bg-hover)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--text-primary)',
          border: 'none', borderRadius: 7, cursor: 'pointer',
          textAlign: 'left', fontSize: 13, fontWeight: 600,
          margin: '1px 0 6px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24"
          stroke="currentColor" strokeWidth="1.8" fill="none" aria-hidden="true">
          <path d="M12 3a5 5 0 0 0-5 5v4c0 2-1 3-2 4h14c-1-1-2-2-2-4V8a5 5 0 0 0-5-5Z"/>
          <path d="M10 20h4"/>
          <circle cx="18.5" cy="5.5" r="2" fill="var(--accent)" stroke="none"/>
        </svg>
        {!collapsed && <span>Needs Attention</span>}
      </button>
      {open && createPortal(
        <AttentionDashboard onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}
