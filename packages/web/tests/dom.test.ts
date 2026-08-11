import { describe, expect, it } from 'vitest';
import { escHtml, shortName } from '../src/dom.js';

describe('escHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escHtml('<a href="x">&y</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;');
  });

  it('coerces null and undefined to an empty string', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  it('coerces numbers to their string form', () => {
    expect(escHtml(42)).toBe('42');
  });
});

describe('shortName', () => {
  it('returns the segment after the last slash', () => {
    expect(shortName('tenants/foo/projects/bar')).toBe('bar');
  });

  it('returns the input unchanged when there is no slash', () => {
    expect(shortName('bare')).toBe('bare');
  });

  it('returns an empty string for null or undefined', () => {
    expect(shortName(null)).toBe('');
    expect(shortName(undefined)).toBe('');
  });
});
