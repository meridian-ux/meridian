// A bound submit: an EDIT FormPanel whose `submit` RpcCall carries FieldBindings.
//
// The scope a record-attached write needs (post a comment on THIS task →
// `resourceId`) is CONTEXT, not input: there is no form control for it and there
// should not be one. It rides the call's bindings, exactly as a `populate`'s scope
// does. Before this, submit sent the typed values alone, so such an op could never
// be satisfied.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FormFieldSchema, TextInputSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { FormMode, FormPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FieldBindingSchema, RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { type ViewDescriptor, ViewDescriptorSchema, ViewKind } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { ViewRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

function makeInvoker(onPost: (req: unknown) => void): RpcInvoker {
  return {
    invoke: async (_service, method, req) => {
      if (method === "post-comment") onPost(req);
      return {};
    },
  };
}

/** The composer as the projection emits it: one text field, a bound submit. */
function composerPanel(bindings: ReturnType<typeof create<typeof FieldBindingSchema>>[]) {
  return create(PanelDescriptorSchema, {
    panelId: "discussion-composer",
    title: "Add a comment",
    body: {
      case: "form",
      value: create(FormPanelSchema, {
        mode: FormMode.EDIT,
        itemNoun: "comment",
        submit: create(RpcCallSchema, {
          service: "savvi.studio.discussion",
          method: "post-comment",
          bindings,
        }),
        fields: [
          create(FormFieldSchema, {
            fieldId: "text",
            label: "Comment",
            kind: { case: "text", value: create(TextInputSchema, { defaultValue: "" }) },
          }),
        ],
      }),
    },
  });
}

function view(panel: ReturnType<typeof create<typeof PanelDescriptorSchema>>): ViewDescriptor {
  return create(ViewDescriptorSchema, {
    id: "task-detail",
    kind: ViewKind.DETAIL,
    layout: { mode: { case: "stacked", value: {} } },
    slots: [{ id: "composer", role: "content", position: 0, panel }],
  });
}

function submitWith(panel: ReturnType<typeof create<typeof PanelDescriptorSchema>>, text: string) {
  let request: unknown;
  render(
    <MeridianMuiProvider invoker={makeInvoker((req) => { request = req; })}>
      <ViewRenderer view={view(panel)} />
    </MeridianMuiProvider>,
  );
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  return () => request;
}

describe("FormPanel(EDIT) submit — RpcCall bindings", () => {
  it("sends the bound scope field alongside the typed values", () => {
    const read = submitWith(
      composerPanel([
        create(FieldBindingSchema, {
          requestField: "resourceId",
          source: { case: "literal", value: "1524732455892819535" },
        }),
      ]),
      "looks good to me",
    );
    expect(read()).toEqual({
      resourceId: "1524732455892819535",
      text: "looks good to me",
    });
  });

  it("lets a typed value win over a binding on the same field", () => {
    const read = submitWith(
      composerPanel([
        create(FieldBindingSchema, {
          requestField: "text",
          source: { case: "literal", value: "from-the-binding" },
        }),
      ]),
      "from-the-user",
    );
    expect((read() as { text: string }).text).toBe("from-the-user");
  });

  it("sends only the typed values when the call binds nothing", () => {
    const read = submitWith(composerPanel([]), "no bindings here");
    expect(read()).toEqual({ text: "no bindings here" });
  });
});

describe("FormPanel(EDIT) submit — clearing a composer", () => {
  it("clears the box once the post RESOLVES", async () => {
    render(
      <MeridianMuiProvider invoker={makeInvoker(() => {})}>
        <ViewRenderer view={view(composerPanel([]))} />
      </MeridianMuiProvider>,
    );
    const box = screen.getByLabelText("Comment") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "posted" } });
    expect(box.value).toBe("posted");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect((screen.getByLabelText("Comment") as HTMLInputElement).value).toBe(""));
  });

  it("KEEPS the text when the post rejects, so it can be retried", async () => {
    const failing: RpcInvoker = { invoke: async () => { throw new Error("boom"); } };
    render(
      <MeridianMuiProvider invoker={failing}>
        <ViewRenderer view={view(composerPanel([]))} />
      </MeridianMuiProvider>,
    );
    const box = screen.getByLabelText("Comment") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await new Promise((r) => setTimeout(r, 10));
    expect((screen.getByLabelText("Comment") as HTMLInputElement).value).toBe("keep me");
  });

  it("does NOT clear a form that opened with values (an edit, not a compose)", async () => {
    const prefilled = create(PanelDescriptorSchema, {
      panelId: "edit-form",
      body: {
        case: "form",
        value: create(FormPanelSchema, {
          mode: FormMode.EDIT,
          submit: create(RpcCallSchema, { service: "svc", method: "post-comment" }),
          fields: [
            create(FormFieldSchema, {
              fieldId: "text",
              label: "Comment",
              kind: { case: "text", value: create(TextInputSchema, { defaultValue: "existing value" }) },
            }),
          ],
        }),
      },
    });
    render(
      <MeridianMuiProvider invoker={makeInvoker(() => {})}>
        <ViewRenderer view={view(prefilled)} />
      </MeridianMuiProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await new Promise((r) => setTimeout(r, 10));
    expect((screen.getByLabelText("Comment") as HTMLInputElement).value).toBe("existing value");
  });
});
