// MeridianGallery round-trip: a GalleryPanel with an image_field renders the
// lightbox (stage img + caption + status + filmstrip + counter), asset URLs are
// host-resolved (resolveAssetSrc), and a GalleryPanel WITHOUT an image_field
// degrades to a card grid.

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CardSpecSchema, GalleryPanelSchema } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { PrincipalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { type ViewDescriptor, ViewDescriptorSchema, ViewKind } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { PanelRenderer, ViewRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";
import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { POPULATED_RESPONSES } from "../../../schemas/conformance/populated.js";

afterEach(cleanup);

it("renders canonical table rows with legacy scalars, declared displays, and safe links", async () => {
  const fixture = FIXTURES.find((candidate) => candidate.shape === "table")!;
  const { container } = render(
    <MeridianMuiProvider invoker={{ invoke: async () => POPULATED_RESPONSES.table }} resolveHref={(kind, id) => kind === "member" && id === "Ada" ? "/members/ada" : undefined}>
      <PanelRenderer descriptor={fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, fixture.descriptor))} />
    </MeridianMuiProvider>,
  );
  expect(await screen.findByText("Ada")).toBeTruthy();
  expect(screen.getByText("Grace")).toBeTruthy();
  expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  for (const text of ["0012.50", "0007.00", "Yes", "No", "javascript:alert(1)"]) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
    "/members/ada",
    "https://example.com/ada",
  ]);
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});

it("routes declared table value links by their raw value and suppresses URL fallback", async () => {
  const created = "2026-03-29";
  const website = "https://example.com/docs";
  const descriptor = create(PanelDescriptorSchema, {
    panelId: "linked-values",
    body: {
      case: "table",
      value: create(TablePanelSchema, {
        populate: { service: "demo.Builds", method: "List" },
        rowsField: "items",
        columns: [
          { header: "Created", fieldPath: "created", valueDisplay: { type: ValueType.DATE, link: { targetKind: "build" } } },
          { header: "Website", fieldPath: "website", valueDisplay: { type: ValueType.URL, link: { targetKind: "document" } } },
        ],
      }),
    },
  });
  const resolved: Array<[string, string]> = [];
  render(
    <MeridianMuiProvider
      invoker={{ invoke: async () => ({ items: [{ created, website }] }) }}
      resolveHref={(targetKind, id) => {
        resolved.push([targetKind, id]);
        return targetKind === "build" ? `/builds/${id}` : undefined;
      }}
    >
      <PanelRenderer descriptor={descriptor} />
    </MeridianMuiProvider>,
  );
  expect((await screen.findByRole("link", { name: "Mar 29, 2026" })).getAttribute("href"))
    .toBe("/builds/2026-03-29");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByText(website)).toBeTruthy();
  expect(resolved).toEqual([["build", created], ["document", website]]);
});

const invoker: RpcInvoker = {
  invoke: async (_service, method) => {
    if (method === "get-run") {
      return {
        slides: [
          { uri: "/evidence/a.png", caption: "open the app root", created: "2026-03-29", owner: "Ada <ada@example.com>", status: true, href: "/runs/a", action: "Review first" },
          { uri: "/evidence/b.png", caption: "assert visible", created: "2026-03-30", owner: "Grace <grace@example.com>", status: false, href: "/runs/b", action: "Review second" },
        ],
      };
    }
    return {};
  },
};

function galleryView(withImage: boolean, declared = true): ViewDescriptor {
  return fromBinary(ViewDescriptorSchema, toBinary(ViewDescriptorSchema, create(ViewDescriptorSchema, {
    id: "run", title: "Run", route: "/run/:name", subjectKind: "TestRun", kind: ViewKind.DETAIL,
    layout: { mode: { case: "list", value: {} } },
    slots: [{
      id: "replay", role: "content", position: 0,
      panel: create(PanelDescriptorSchema, {
        panelId: "replay", title: "Replay",
        body: {
          case: "gallery",
          value: create(GalleryPanelSchema, {
            rowsField: "slides",
            placeholder: "No screenshots.",
            populate: create(RpcCallSchema, { service: "demo.runs.v1.RunService", method: "get-run" }),
            card: create(CardSpecSchema, {
              titleField: "created",
              titleDisplay: declared ? { type: ValueType.DATE } : undefined,
              subtitleField: "owner",
              subtitleDisplay: declared ? { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } : undefined,
              statusField: "status",
              statusDisplay: declared ? { type: ValueType.BOOLEAN } : undefined,
              hrefField: "href",
              actionLabelField: "action",
              ...(withImage ? { imageField: "uri" } : {}),
            }),
          }),
        },
      }),
    }],
  })));
}

describe("MeridianGallery", () => {
  it("realizes card icon keys through the host glyph seam", async () => {
    const descriptor = create(PanelDescriptorSchema, {
      body: { case: "gallery", value: create(GalleryPanelSchema, {
        populate: { service: "demo.Catalog", method: "List" },
        rowsField: "items",
        card: { titleField: "name", iconField: "icon" },
      }) },
    });
    const { container } = render(
      <MeridianMuiProvider
        invoker={{ invoke: async () => ({ items: [{ name: "GitHub", icon: "github" }] }) }}
        renderIcon={(key) => <i data-testid={`glyph-${key}`} />}
      >
        <PanelRenderer descriptor={descriptor} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("GitHub");
    expect(screen.getByTestId("glyph-github")).toBeTruthy();
    expect(container.querySelector(".mer-gallery-card-icon")?.getAttribute("data-icon")).toBe("github");
  });

  it("renders the canonical populated gallery descriptor", async () => {
    const fixture = FIXTURES.find((candidate) => candidate.shape === "gallery")!;
    render(
      <MeridianMuiProvider invoker={{ invoke: async () => POPULATED_RESPONSES.gallery }}>
        <PanelRenderer descriptor={fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, fixture.descriptor))} />
      </MeridianMuiProvider>,
    );
    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(screen.getByText("PagerDuty")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("renders the image lightbox with host-resolved asset URLs", async () => {
    const { container } = render(
      <MeridianMuiProvider invoker={invoker} resolveAssetSrc={(s) => `/tools/e2e${s}`}>
        <ViewRenderer view={galleryView(true)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("Mar 29, 2026"); // wait for the fetch → render
    // stage (alt=caption) + filmstrip thumbs (alt="") all use the resolved src.
    const srcs = Array.from(container.querySelectorAll("img")).map((el) => el.getAttribute("src"));
    expect(srcs).toContain("/tools/e2e/evidence/a.png");
    expect(srcs).toContain("/tools/e2e/evidence/b.png"); // filmstrip thumb
    await screen.findByText("Mar 29, 2026"); // caption/status
    await screen.findByText("Ada"); // subtitle
    expect(screen.getByText("Ada").getAttribute("title")).toBe("ada@example.com");
    expect(screen.getByRole("img", { name: "Mar 29, 2026" }).getAttribute("src")).toBe("/tools/e2e/evidence/a.png");
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review first" }).getAttribute("href")).toBe("/runs/a");
    await screen.findByText("1 / 2"); // counter
    await screen.findByText("Next ›"); // control
    fireEvent.click(screen.getByText("Next ›"));
    expect(screen.getByRole("img", { name: "Mar 30, 2026" })).toBeTruthy();
    expect(screen.getByText("Grace").getAttribute("title")).toBe("grace@example.com");
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review second" }).getAttribute("href")).toBe("/runs/b");
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("admits image sources before invoking the host asset resolver", async () => {
    const resolved: string[] = [];
    const { container } = render(
      <MeridianMuiProvider
        invoker={{ invoke: async () => ({ slides: [
          { created: "Safe", uri: "/evidence/safe.png" },
          { created: "Unsafe", uri: "data:image/png;base64,unsafe" },
        ] }) }}
        resolveAssetSrc={(source) => {
          resolved.push(source);
          return `/mounted${source}`;
        }}
      >
        <ViewRenderer view={galleryView(true, false)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("Safe");
    expect(Array.from(container.querySelectorAll("img"), image => image.getAttribute("src"))).toEqual([
      "/mounted/evidence/safe.png",
      "/mounted/evidence/safe.png",
    ]);
    expect(resolved.length).toBeGreaterThan(0);
    expect(new Set(resolved)).toEqual(new Set(["/evidence/safe.png"]));
    fireEvent.click(screen.getByText("Next ›"));
    expect(await screen.findByText("Unsafe")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Unsafe" })).toBeNull();
  });

  it("degrades to a card grid when there is no image_field", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={galleryView(false)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("Mar 29, 2026");
    await screen.findByText("Mar 30, 2026");
    expect(screen.queryAllByRole("img")).toHaveLength(0); // no images without image_field
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/runs/a", "/runs/b"]);
    expect(screen.getByText("Ada").getAttribute("title")).toBe("ada@example.com");
  });

  it("admits gallery deep links and degrades unsafe destinations to inert cards", async () => {
    const resolvedAssets: string[] = [];
    render(
      <MeridianMuiProvider invoker={{ invoke: async () => ({ slides: [
        { created: "Workspace", href: "vscode://file/project", action: "Open workspace" },
        { created: "Unsafe", href: "javascript:alert(1)", action: "Blocked action" },
      ] }) }} resolveAssetSrc={(source) => {
        resolvedAssets.push(source);
        return `/mounted${source}`;
      }}>
        <ViewRenderer view={galleryView(false, false)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("Workspace");
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["vscode://file/project"]);
    expect(screen.getByText("Open workspace").closest("a")?.getAttribute("href")).toBe("vscode://file/project");
    expect(screen.getByText("Blocked action").closest("a")).toBeNull();
    expect(screen.getByText("Blocked action").classList.contains("mer-gallery-card-action")).toBe(true);
    expect(screen.getByText("Unsafe").closest("a")).toBeNull();
    expect(resolvedAssets).toEqual([]);
  });

  it.each([false, true])("preserves legacy output without displays (images=%s)", async (withImage) => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={galleryView(withImage, false)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("2026-03-29");
    expect(screen.getByText("true")).toBeTruthy();
    expect(screen.queryByText("Ada <ada@example.com>")).toBeNull();
    expect(screen.queryByText("Mar 29, 2026")).toBeNull();
    if (withImage) expect(screen.getByRole("img", { name: "2026-03-29" })).toBeTruthy();
  });
});
