// Pure view selectors. The API owns authorization and safe projection; UI owns
// presentation and does not classify or mutate email.
export const ATTENTION_FILTERS = Object.freeze(['ALL', 'HIGH', 'REVIEW']);

export function attentionCounts(items = []) {
  const safe = Array.isArray(items) ? items : [];
  return {
    all: safe.length,
    high: safe.filter(item => item?.attention === 'YES' && item?.priority === 'HIGH').length,
    review: safe.filter(item => item?.attention === 'REVIEW').length,
  };
}

export function visibleAttentionItems(items = [], filter = 'ALL') {
  const safe = Array.isArray(items) ? items : [];
  if (filter === 'HIGH') return safe.filter(item => item?.attention === 'YES' && item?.priority === 'HIGH');
  if (filter === 'REVIEW') return safe.filter(item => item?.attention === 'REVIEW');
  return safe;
}

export function attentionStateLabel(item = {}) {
  if (item.attention !== 'REVIEW') return 'Needs attention';
  switch (item.jobStatus) {
    case 'QUEUED': return 'Awaiting AI review';
    case 'RETRY': return 'AI retry scheduled';
    case 'PROCESSING': return 'Analysing';
    case 'NEEDS_REVIEW': return 'Manual review needed';
    default: return 'Review suggested';
  }
}
