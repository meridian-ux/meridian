import { describe, expect, it } from 'vitest';
import { patchClassName, patchHtml, patchText } from '../src/patch.js';

type StubNode = {
  textContent: string;
  innerHTML: string;
  className: string;
};

function makeRoot(node: StubNode | null): ParentNode {
  return {
    querySelector(selector: string) {
      if (selector === '.missing') return null;
      return node as unknown as Element;
    },
  } as unknown as ParentNode;
}

describe('patchText', () => {
  it('updates textContent and reports a change', () => {
    const node: StubNode = { textContent: 'old', innerHTML: '', className: '' };
    expect(patchText(makeRoot(node), '.label', 'next')).toBe(true);
    expect(node.textContent).toBe('next');
  });

  it('returns false when the value is unchanged', () => {
    const node: StubNode = { textContent: 'same', innerHTML: '', className: '' };
    expect(patchText(makeRoot(node), '.label', 'same')).toBe(false);
  });

  it('returns false when the selector matches nothing', () => {
    expect(patchText(makeRoot(null), '.missing', 'x')).toBe(false);
  });

  it('treats null and undefined as an empty string', () => {
    const node: StubNode = { textContent: 'old', innerHTML: '', className: '' };
    patchText(makeRoot(node), '.label', null);
    expect(node.textContent).toBe('');
    patchText(makeRoot(node), '.label', undefined);
    expect(node.textContent).toBe('');
  });

  it('returns false when the root itself is null', () => {
    expect(patchText(null, '.label', 'x')).toBe(false);
  });
});

describe('patchHtml', () => {
  it('updates innerHTML when changed', () => {
    const node: StubNode = { textContent: '', innerHTML: '', className: '' };
    expect(patchHtml(makeRoot(node), '.label', '<b>x</b>')).toBe(true);
    expect(node.innerHTML).toBe('<b>x</b>');
  });

  it('returns false when innerHTML already matches', () => {
    const node: StubNode = { textContent: '', innerHTML: '<b>x</b>', className: '' };
    expect(patchHtml(makeRoot(node), '.label', '<b>x</b>')).toBe(false);
  });
});

describe('patchClassName', () => {
  it('updates className when changed', () => {
    const node: StubNode = { textContent: '', innerHTML: '', className: 'label' };
    expect(patchClassName(makeRoot(node), '.label', 'label active')).toBe(true);
    expect(node.className).toBe('label active');
  });

  it('returns false when className already matches', () => {
    const node: StubNode = { textContent: '', innerHTML: '', className: 'label' };
    expect(patchClassName(makeRoot(node), '.label', 'label')).toBe(false);
  });
});
