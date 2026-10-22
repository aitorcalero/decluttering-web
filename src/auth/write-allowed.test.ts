import { describe, expect, it } from 'vitest';
import { parseOrgIds, writeAllowed } from './write-allowed';

const A = 'AbCdEfGh12345678';
const B = 'ZyXwVuTs87654321';

describe('writeAllowed (default deny)', () => {
  it('denies everywhere when the list is empty, blank or missing', () => {
    for (const list of [undefined, null, '', ' ', ',', [], ['']]) expect(writeAllowed(A, list)).toBe(false);
  });
  it('denies an empty or missing org id, even if the list has blanks', () => {
    for (const id of [undefined, null, '', '  ']) expect(writeAllowed(id, `${A}, ,`)).toBe(false);
  });
  it('allows only listed org ids', () => {
    expect(writeAllowed(A, A)).toBe(true);
    expect(writeAllowed(A, ` ${B} , ${A} `)).toBe(true);
    expect(writeAllowed(B, A)).toBe(false);
    expect(writeAllowed(A, [B])).toBe(false);
  });
  it('is exact: no prefixes, substrings or case folding', () => {
    expect(writeAllowed(A.slice(0, 8), A)).toBe(false);
    expect(writeAllowed(A, `${A}x`)).toBe(false);
    expect(writeAllowed(A.toLowerCase(), A)).toBe(false);
  });
  it('parses a comma list', () => {
    expect(parseOrgIds(` ${A},,${B} `)).toEqual([A, B]);
  });
});
