// A declared ValueDisplay reaching the record card, through the real
// MeridianMuiProvider + ViewRenderer + muiKit path.
//
// The pure formatting is covered in value_display.test.ts; what matters here is
// that `FormField.display` is actually THREADED to the renderer and honoured —
// the wiring, not the arithmetic.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import {
  DetailHeaderPanelSchema,
  PanelDescriptorSchema,
  RecordCardPanelSchema,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ColumnFormat, TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  PrincipalDisplay,
  TemporalDisplay,
  ValueDisplaySchema,
  ValueType,
} from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import {
  type ViewDescriptor,
  ViewDescriptorSchema,
  ViewKind,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { PanelRenderer, ViewRenderer } from "@savvifi/meridian-web-react";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

describe.each(["recordCard", "detailHeader"] as const)("%s principal destinations", (shape) => {
  it.each(["principal", "email", "no-resolver", "declined", "empty-href", "no-kind", "disabled"] as const)("handles %s through the host seam", async (scenario) => {
    const raw = "Ruchi Sharma <ruchi@example.com>";
    const display = {
      type: scenario === "email" ? ValueType.EMAIL : ValueType.PRINCIPAL,
      options: { case: "principal" as const, value: {
        display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE,
        linkToRecord: scenario !== "disabled",
        targetKind: scenario === "no-kind" ? "" : "identity.user",
      } },
    };
    const populate = { service: "svc", method: "get" };
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "principal",
      body: shape === "recordCard"
        ? { case: shape, value: { populate, fields: [{ fieldId: "owner", display }] } }
        : { case: shape, value: { populate, descriptorRows: [{ sourcePath: "owner", display }] } },
    });
    const resolveHref = vi.fn(() => scenario === "declined" ? undefined : scenario === "empty-href" ? "" : "/people/host-selected");
    render(
      <MeridianMuiProvider invoker={{ invoke: async () => ({ owner: raw }) }} resolveHref={scenario === "no-resolver" ? undefined : resolveHref}>
        <PanelRenderer descriptor={descriptor} />
      </MeridianMuiProvider>,
    );
    const label = await screen.findByText("Ruchi Sharma");
    expect(label.getAttribute("title")).toBe("ruchi@example.com");
    if (scenario === "principal" || scenario === "email") {
      const link = screen.getByRole("link", { name: "Ruchi Sharma" });
      expect(link.getAttribute("href")).toBe("/people/host-selected");
      expect(link.getAttribute("target")).toBeNull();
    } else expect(screen.queryByRole("link")).toBeNull();
    if (["no-resolver", "no-kind", "disabled"].includes(scenario)) {
      expect(resolveHref).not.toHaveBeenCalled();
    } else expect(resolveHref).toHaveBeenCalledWith("identity.user", raw);
  });
});

describe.each(["recordCard", "detailHeader"] as const)("%s explicit URL ValueLink", (shape) => {
  it.each(["resolved", "no-resolver", "declined", "empty-href", "blank-kind", "absent-link"] as const)("handles %s without an unintended destination", async (scenario) => {
    const raw = "https://example.com/raw";
      const display = {
        type: ValueType.URL,
        link: scenario === "absent-link" ? undefined : { targetKind: scenario === "blank-kind" ? " " : "build" },
      };
      const populate = { service: "acme.Builds", method: "GetBuild" };
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "value-link",
        body: shape === "recordCard"
          ? { case: shape, value: { populate, fields: [{ fieldId: "value", display }] } }
          : { case: shape, value: { populate, descriptorRows: [{ sourcePath: "value", display }] } },
      });
      const resolver = vi.fn(() => scenario === "declined" ? undefined : scenario === "empty-href" ? "" : "/host-selected");
    render(
      <MeridianMuiProvider invoker={{ invoke: async () => ({ value: raw }) }} resolveHref={scenario === "no-resolver" ? undefined : resolver}>
        <PanelRenderer descriptor={descriptor} />
      </MeridianMuiProvider>,
    );
    await screen.findByText(raw);
    const link = screen.queryByRole("link");
    if (scenario === "resolved") {
      expect(link?.getAttribute("href")).toBe("/host-selected");
      expect(link?.getAttribute("target")).toBeNull();
    } else if (scenario === "absent-link") {
      expect(link?.getAttribute("href")).toBe(raw);
      expect(link?.getAttribute("target")).toBe("_blank");
    } else expect(link).toBeNull();
    if (["no-resolver", "blank-kind", "absent-link"].includes(scenario)) {
      expect(resolver).not.toHaveBeenCalled();
    } else expect(resolver).toHaveBeenCalledWith("build", raw);
  });
});

it("uses a general ValueLink for non-principal identifiers", async () => {
  const descriptor = create(PanelDescriptorSchema, {
    panelId: "build-link",
    body: {
      case: "recordCard",
      value: {
        populate: { service: "svc", method: "get" },
        fields: [{
          fieldId: "buildId",
          label: "Build",
          display: { type: ValueType.IDENTIFIER, link: { targetKind: "build" } },
        }],
      },
    },
  });
  render(
    <MeridianMuiProvider invoker={{ invoke: async () => ({ buildId: "build_123" }) }} resolveHref={(kind, id) => `/builds/${kind}/${id}`}>
      <PanelRenderer descriptor={descriptor} />
    </MeridianMuiProvider>,
  );
  const link = await screen.findByRole("link", { name: "build_123" });
  expect(link.getAttribute("href")).toBe("/builds/build/build_123");
});

const COMMENT = {
  authorName: "Ruchi Sharma <ruchi@example.com>",
  text: "Carrier confirmed the 2026 rates.",
  createdAt: "2026-07-25T09:18:00.000Z",
  dueDate: "2026-03-29T00:00:00.000Z",
  profileUrl: "https://example.com/docs",
  ownerId: "user_123",
};

const invoker: RpcInvoker = { invoke: async () => COMMENT as never };

/** A record card whose fields declare how they read. */
function cardView(): ViewDescriptor {
  const field = (fieldId: string, label: string, display?: ReturnType<typeof create<typeof ValueDisplaySchema>>) =>
    create(FormFieldSchema, { fieldId, label, ...(display ? { display } : {}) });

  return create(ViewDescriptorSchema, {
    id: "comment-card",
    kind: ViewKind.DETAIL,
    subjectId: "1",
    layout: { mode: { case: "stacked", value: {} } },
    slots: [
      {
        id: "main",
        role: "content",
        position: 0,
        panel: create(PanelDescriptorSchema, {
          panelId: "comment",
          body: {
            case: "recordCard",
            value: create(RecordCardPanelSchema, {
              populate: create(RpcCallSchema, { service: "svc", method: "get" }),
              idField: "id",
              fields: [
                field(
                  "authorName",
                  "Author",
                  create(ValueDisplaySchema, {
                    type: ValueType.PRINCIPAL,
                    options: {
                      case: "principal",
                      value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE },
                    },
                  }),
                ),
                field("text", "Comment"),
                // Posted: relative, with the absolute available on hover.
                field(
                  "createdAt",
                  "Posted",
                  create(ValueDisplaySchema, {
                    type: ValueType.DATE_TIME,
                    options: {
                      case: "temporal",
                      value: { display: TemporalDisplay.RELATIVE_WITH_ABSOLUTE_TITLE },
                    },
                  }),
                ),
                // Due: absolute, and a day — the decided rule, per field.
                field(
                  "dueDate",
                  "Due Date",
                  create(ValueDisplaySchema, {
                    type: ValueType.DATE,
                    options: { case: "temporal", value: { display: TemporalDisplay.ABSOLUTE } },
                  }),
                ),
                field("profileUrl", "Profile", create(ValueDisplaySchema, { type: ValueType.URL })),
                field(
                  "ownerId",
                  "Owner",
                  create(ValueDisplaySchema, {
                    type: ValueType.PRINCIPAL,
                    options: {
                      case: "principal",
                      value: { linkToRecord: true, targetKind: "identity.user" },
                    },
                  }),
                ),
              ],
            }),
          },
        }),
      },
    ],
  });
}

describe("record card honours a declared ValueDisplay", () => {
  it("renders a relative Posted and an absolute Due Date on the same card", async () => {
    render(
      <MeridianMuiProvider
        invoker={invoker}
        resolveHref={(kind, id) => `/directory/${kind}/${id}`}
      >
        <ViewRenderer view={cardView()} />
      </MeridianMuiProvider>,
    );

    // The author's label passes through untouched.
    expect(await screen.findByText("Ruchi Sharma")).toBeTruthy();

    // Due Date is absolute and day-precision — no "12:00 AM" on a midnight-Z date.
    expect(screen.getByText("Mar 29, 2026")).toBeTruthy();
    expect(screen.queryByText(/12:00 AM/)).toBeNull();

    // Posted asked to read relatively. After mount `useDisplayNow` supplies an
    // instant, so it must NOT still be the raw ISO string.
    expect(screen.queryByText("2026-07-25T09:18:00.000Z")).toBeNull();
    const posted = screen.getByText(/ago|just now|Jul 25, 2026/);
    expect(posted).toBeTruthy();
    expect(screen.getByText("Ruchi Sharma").getAttribute("title")).toBe("ruchi@example.com");
    expect(screen.getByRole("link", { name: "https://example.com/docs" }).getAttribute("href"))
      .toBe("https://example.com/docs");
    expect(screen.getByRole("link", { name: "user_123" }).getAttribute("href"))
      .toBe("/directory/identity.user/user_123");
  });

  it("leaves an undeclared field on the existing inference", async () => {
    // `text` declares no display; it must render as plain typography, unchanged.
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={cardView()} />
      </MeridianMuiProvider>,
    );
    expect(await screen.findByText("Carrier confirmed the 2026 rates.")).toBeTruthy();
  });
});

// The two surfaces that had no say until schemas 0.23.0 / this release: a table
// cell (TableColumn.value_display, which existed but was unread) and a
// detail-header row (DescriptorRow.display, newly added).

describe("table cell and header row honour a declared ValueDisplay", () => {
  const relative = create(ValueDisplaySchema, {
    type: ValueType.DATE_TIME,
    options: { case: "temporal", value: { display: TemporalDisplay.RELATIVE } },
  });
  const dayAbsolute = create(ValueDisplaySchema, {
    type: ValueType.DATE,
    options: { case: "temporal", value: { display: TemporalDisplay.ABSOLUTE } },
  });

  it("a table column's value_display WINS over ColumnFormat", async () => {
    const rowsInvoker: RpcInvoker = {
      invoke: async () => ({ items: [{ createdAt: "2026-07-25T09:18:00.000Z" }] }) as never,
    };
    const view = create(ViewDescriptorSchema, {
      id: "t",
      kind: ViewKind.LIST,
      layout: { mode: { case: "list", value: {} } },
      slots: [
        {
          id: "content",
          role: "content",
          position: 0,
          panel: create(PanelDescriptorSchema, {
            panelId: "t",
            body: {
              case: "table",
              value: create(TablePanelSchema, {
                rowsField: "items",
                populate: create(RpcCallSchema, { service: "s", method: "list" }),
                // format says TIMESTAMP (the old vocabulary); value_display says
                // "read this relatively". The declaration must win.
                columns: [
                  {
                    header: "Posted",
                    fieldPath: "createdAt",
                    format: ColumnFormat.TIMESTAMP,
                    valueDisplay: relative,
                  },
                ],
              }),
            },
          }),
        },
      ],
    });
    render(
      <MeridianMuiProvider invoker={rowsInvoker}>
        <ViewRenderer view={view} />
      </MeridianMuiProvider>,
    );
    // Not the raw ISO that ColumnFormat.TIMESTAMP would have produced.
    expect(await screen.findByText(/ago|just now/)).toBeTruthy();
    expect(screen.queryByText("2026-07-25T09:18:00.000Z")).toBeNull();
  });

  it("a header descriptor row reads by declaration, per row", async () => {
    const view = create(ViewDescriptorSchema, {
      id: "h",
      kind: ViewKind.DETAIL,
      subjectId: "1",
      layout: { mode: { case: "stacked", value: {} } },
      slots: [
        {
          id: "header",
          role: "header",
          position: 0,
          panel: create(PanelDescriptorSchema, {
            panelId: "h",
            body: {
              case: "detailHeader",
              value: create(DetailHeaderPanelSchema, {
                titleSourcePath: "text",
                populate: create(RpcCallSchema, { service: "s", method: "get" }),
                idField: "id",
                descriptorRows: [
                  // The exact pairing from studio's task page: a due date that must
                  // stay absolute beside a posted stamp that should read relatively.
                  { label: "Due Date", sourcePath: "dueDate", display: dayAbsolute },
                  { label: "Posted", sourcePath: "createdAt", display: relative },
                ],
              }),
            },
          }),
        },
      ],
    });
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={view} />
      </MeridianMuiProvider>,
    );
    // Due Date: absolute, day precision — the raw ISO is what shipped before.
    expect(await screen.findByText("Mar 29, 2026")).toBeTruthy();
    expect(screen.queryByText("2026-03-29T00:00:00.000Z")).toBeNull();
    // Posted: relative, on the same card.
    expect(screen.getByText(/ago|just now/)).toBeTruthy();
  });
});
