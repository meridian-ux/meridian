// @vitest-environment jsdom
import { expect, it } from "vitest";
import { normalizeMarkup } from "../../../schemas/conformance/normalize_dom.js";

it("discards skinning and layout wrappers but preserves controls and content", () => {
  expect(normalizeMarkup('<style>.x{color:red}</style><div class="x"><span>Hello</span><button disabled>Run</button></div>'))
    .toBe('"Hello"\nbutton disabled\n  "Run"');
  expect(normalizeMarkup('<section><span>Hello</span><button disabled class="other">Run</button></section>'))
    .toBe('"Hello"\nbutton disabled\n  "Run"');
});

it("makes an empty body, changed content, action target, or state observable", () => {
  const original = normalizeMarkup('<a href="/account">Account</a><button aria-pressed="false">Select</button>');
  for (const changed of [
    '<div></div>',
    '<a href="/account">Gone</a><button aria-pressed="false">Select</button>',
    '<a href="/wrong">Account</a><button aria-pressed="false">Select</button>',
    '<a href="/account">Account</a><button aria-pressed="true">Select</button>',
  ]) expect(normalizeMarkup(changed)).not.toBe(original);
});

it("resolves generated accessible-name IDs and flags dangling references", () => {
  const make = (id: string) => `<span id="${id}">Agent</span><input aria-labelledby="${id}"/>`;
  expect(normalizeMarkup(make("first"))).toBe(normalizeMarkup(make("second")));
  expect(normalizeMarkup('<input aria-labelledby="missing"/>')).toContain('aria-labelledby="<missing>"');
});

it("retains preformatted whitespace and media alternatives while ignoring hidden content", () => {
  expect(normalizeMarkup('<pre>one\n  two</pre><img src="/diagram.png" alt="Flow"/><div hidden>hidden</div><span aria-hidden="true">icon</span>'))
    .toBe('pre\n  "one\\n  two"\nimg alt="Flow" src="/diagram.png"');
});
