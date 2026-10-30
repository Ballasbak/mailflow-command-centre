// Opt-in dashboard navigation. Backend activation is independent of any mailbox
// processing toggle; this read-only view never silently switches a mailbox on.
import { registerSlot } from '../registry.js';
import AttentionNav from './AttentionNav.jsx';

registerSlot('sidebar-nav', {
  pluginId: 'attention-triage',
  render: (ctx) => <AttentionNav collapsed={ctx.collapsed} />,
});
