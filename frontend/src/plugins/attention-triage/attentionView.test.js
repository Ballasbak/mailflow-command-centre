import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionCounts, visibleAttentionItems, attentionStateLabel } from './attentionView.js';

const important = { id: 'a', attention: 'YES', priority: 'HIGH', jobStatus: 'DONE' };
const medium = { id: 'b', attention: 'YES', priority: 'MEDIUM', jobStatus: 'DONE' };
const pending = { id: 'c', attention: 'REVIEW', priority: 'UNASSESSED', jobStatus: 'QUEUED' };
const failed = { id: 'd', attention: 'REVIEW', priority: 'UNASSESSED', jobStatus: 'NEEDS_REVIEW' };
const items = [important, medium, pending, failed];

test('counts urgent items separately from undecided mail', () => {
  assert.deepEqual(attentionCounts(items), { all: 4, high: 1, review: 2 });
});
test('shows all actionable and pending items in the default view', () => {
  assert.deepEqual(visibleAttentionItems(items).map(item => item.id), ['a','b','c','d']);
});
test('filters the high priority view without hiding uncertain items from the review view', () => {
  assert.deepEqual(visibleAttentionItems(items, 'HIGH'), [important]);
  assert.deepEqual(visibleAttentionItems(items, 'REVIEW'), [pending, failed]);
});
test('uses friendly, unambiguous status labels for pending and failed jobs', () => {
  assert.equal(attentionStateLabel(pending), 'Awaiting AI review');
  assert.equal(attentionStateLabel(failed), 'Manual review needed');
  assert.equal(attentionStateLabel({ attention: 'REVIEW', jobStatus: 'RETRY' }), 'AI retry scheduled');
  assert.equal(attentionStateLabel({ attention: 'REVIEW', jobStatus: 'PROCESSING' }), 'Analysing');
  assert.equal(attentionStateLabel(important), 'Needs attention');
});
test('ignores malformed response shapes rather than crashing the dashboard', () => {
  assert.deepEqual(attentionCounts(null), { all: 0, high: 0, review: 0 });
  assert.deepEqual(visibleAttentionItems(null, 'HIGH'), []);
  assert.deepEqual(visibleAttentionItems([{ attention: 'REVIEW' }, null], 'REVIEW'),
    [{ attention: 'REVIEW' }]);
});
