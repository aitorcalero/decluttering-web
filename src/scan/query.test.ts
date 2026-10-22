import { describe, expect, it } from 'vitest';
import { SERVICE_QUERY } from './pipeline';

// DC-065: the scan must only see hosted feature services. Parquet feature layers (beta) are their own item type, billed as
// file storage (1.2 credits per GB a month), so counting them at the feature-storage rate would overstate credits.
describe('SERVICE_QUERY', () => {
  const q = SERVICE_QUERY('abc123');

  it('is scoped to the org, Feature Service items and the Hosted Service keyword', () => {
    expect(q).toBe('orgid:abc123 AND type:"Feature Service" AND typekeywords:"Hosted Service"');
  });

  it('never widens to Parquet layers or other item types', () => {
    expect(q).not.toMatch(/parquet/i);
    expect(q).not.toMatch(/\bOR\b/);
  });
});
