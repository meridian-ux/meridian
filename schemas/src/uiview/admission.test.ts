// Guards the RpcCall admission gate.
//
// A gate that has never been shown to refuse is not a gate — the same standard
// mirror_conformance.test.mjs holds itself to. So the cases that matter here are
// the REFUSALS: the default-closed mutation tier, and the AIP tripwire that
// catches a destructive call smuggled into a populate slot.
//
// NOT included in the published package: admission.ts is in the ts_project
// srcs, this file is not. Vitest transpiles this isolated seam test directly;
// its imports stay within this package and do not depend on generated protos.

import { expect, it } from "vitest";
import {
  AdmissionDeniedError,
  aipTier,
  createAdmissionGate,
  type AdmissionDenial,
} from "./admission.js";

it("with no policy: reads are allowed, mutations are denied", () => {
  const gate = createAdmissionGate();

  // Reads default open. Every host's populate already fires today; defaulting
  // this closed would break them all on upgrade without closing the hole.
  expect(gate.admits("read", "acme.v1.Orders", "ListOrders")).toBe(true);

  // Mutations default closed. This is the whole point of the module.
  expect(gate.admits("mutation", "acme.v1.Orders", "ArchiveOrder")).toBe(false);
});

it("a denial names the exact entry to add", () => {
  const gate = createAdmissionGate();
  let thrown: unknown;
  try { gate.check("mutation", "acme.v1.Orders", "ArchiveOrder"); } catch (err) { thrown = err; }
  expect(thrown).toBeInstanceOf(AdmissionDeniedError);
  if (!(thrown instanceof AdmissionDeniedError)) throw thrown;
  expect(thrown.denial.tier).toBe("mutation");
  expect(thrown.denial.service).toBe("acme.v1.Orders");
  expect(thrown.denial.method).toBe("ArchiveOrder");
  // The message has to be actionable or a host will just reach for
  // "unrestricted" to make it go away.
  expect(thrown.denial.reason).toMatch(/admission\.mutations/);
  expect(thrown.denial.reason).toMatch(/acme\.v1\.Orders\/ArchiveOrder/);
});

it('"unrestricted" opts out completely, including the tripwire', () => {
  const gate = createAdmissionGate("unrestricted");
  expect(gate.admits("mutation", "acme.v1.Orders", "DeleteOrder")).toBe(true);
  expect(gate.admits("read", "acme.v1.Orders", "DeleteOrder")).toBe(true);
  gate.check("mutation", "acme.v1.Orders", "DeleteOrder");
});

it("explicit allowlists admit exactly what they name", () => {
  const gate = createAdmissionGate({
    reads: ["acme.v1.Orders/ListOrders"],
    mutations: ["acme.v1.Orders/ArchiveOrder"],
  });

  expect(gate.admits("read", "acme.v1.Orders", "ListOrders")).toBe(true);
  expect(gate.admits("read", "acme.v1.Orders", "ListInvoices")).toBe(false);
  expect(gate.admits("mutation", "acme.v1.Orders", "ArchiveOrder")).toBe(true);
  expect(gate.admits("mutation", "acme.v1.Orders", "DeleteOrder")).toBe(false);

  // The tiers are separate lists: naming a read does not grant the mutation.
  expect(gate.admits("mutation", "acme.v1.Orders", "ListOrders")).toBe(false);
});

it("wildcards cover a service, or everything", () => {
  const svc = createAdmissionGate({ mutations: ["acme.v1.Orders/*"] });
  expect(svc.admits("mutation", "acme.v1.Orders", "ArchiveOrder")).toBe(true);
  expect(svc.admits("mutation", "acme.v1.Invoices", "ArchiveInvoice")).toBe(false);

  const all = createAdmissionGate({ mutations: ["*"] });
  expect(all.admits("mutation", "anything.v1.At", "All")).toBe(true);
});

it("a mutating verb fired from a READ callsite is refused", () => {
  // The attack this module exists for: a populate auto-fires on mount with no
  // user gesture, so a destructive method in that slot never needs a click.
  // Note reads are wide open here — the tripwire still refuses it.
  const gate = createAdmissionGate();

  for (const m of ["DeleteOrder", "CreateOrder", "UpdateOrder", "PatchOrder"]) {
    expect(gate.admits("read", "acme.v1.Orders", m), m).toBe(false);
  }
  expect(() => gate.check("read", "acme.v1.Orders", "DeleteOrder")).toThrow(/fired from a READ callsite/);
});

it("the tripwire can be switched off, and only then", () => {
  const off = createAdmissionGate({ inferFromAipVerbs: false });
  expect(off.admits("read", "acme.v1.Orders", "DeleteOrder")).toBe(true);

  // It is a tripwire, never a grant: turning it ON does not admit a mutation
  // that the allowlist does not name.
  const on = createAdmissionGate({ inferFromAipVerbs: true });
  expect(on.admits("mutation", "acme.v1.Orders", "DeleteOrder")).toBe(false);
});

it("onDenied observes every refusal", () => {
  const seen: AdmissionDenial[] = [];
  const gate = createAdmissionGate({ onDenied: (d) => seen.push(d) });

  expect(() => gate.check("mutation", "acme.v1.Orders", "ArchiveOrder")).toThrow();
  expect(() => gate.check("read", "acme.v1.Orders", "DeleteOrder")).toThrow();

  expect(seen).toHaveLength(2);
  expect(
    seen.map((d) => `${d.tier} ${d.method}`),
  ).toEqual(["mutation ArchiveOrder", "read DeleteOrder"]);
});

it("an empty service or method is refused at either tier", () => {
  const gate = createAdmissionGate({});
  expect(gate.admits("read", "", "ListOrders")).toBe(false);
  expect(gate.admits("read", "acme.v1.Orders", "")).toBe(false);
  expect(() => gate.check("read", "", "")).toThrow(/empty service/);
});

// ── the AIP classifier ───────────────────────────────────────────────────────

it("aipTier classifies the standard verbs", () => {
  expect(aipTier("ListOrders")).toBe("read");
  expect(aipTier("GetOrder")).toBe("read");
  expect(aipTier("SearchOrders")).toBe("read");
  expect(aipTier("CreateOrder")).toBe("mutation");
  expect(aipTier("UpdateOrder")).toBe("mutation");
  expect(aipTier("PatchOrder")).toBe("mutation");
  expect(aipTier("DeleteOrder")).toBe("mutation");
});

it("aipTier keeps meridian-proto's Getty guard", () => {
  // A prefix only counts at a word boundary. "Getty" is a name, not Get + ty.
  expect(aipTier("Getty")).toBe(null);
  expect(aipTier("Listen")).toBe(null);
  expect(aipTier("Patchwork")).toBe(null);
  expect(aipTier("Deleterious")).toBe(null);
  // A custom method follows no standard verb; we have nothing to say about it.
  expect(aipTier("Exchange")).toBe(null);
  expect(aipTier("ArchiveOrder")).toBe(null);
});

it("aipTier treats Batch as a modifier, not a verb", () => {
  expect(aipTier("BatchGetOrders")).toBe("read");
  expect(aipTier("BatchDeleteOrders")).toBe("mutation");
  expect(aipTier("BatchCreateOrders")).toBe("mutation");
});

it("a bare standard verb still classifies", () => {
  expect(aipTier("Get")).toBe("read");
  expect(aipTier("Delete")).toBe("mutation");
});

it("an unclassifiable method is not refused by the tripwire", () => {
  // ArchiveOrder mutates in fact, but its name follows no standard verb, so
  // inference must stay silent rather than guess. The allowlist is the real
  // control; inference only catches the cases it can prove.
  const gate = createAdmissionGate();
  expect(gate.admits("read", "acme.v1.Orders", "ArchiveOrder")).toBe(true);
});
