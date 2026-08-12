import { create } from "@bufbuild/protobuf";

import {
  LaunchpadSchema,
  type Launchpad,
} from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";

/**
 * A representative Launchpad exercising all four action arms:
 *  - open_panel   → "New product" opens a create FormPanel
 *  - navigate     → "Go to settings"
 *  - open_view_id → "Products"
 *  - rpc          → "Export data"
 * plus a default (suggested) command and a keyword-only match.
 */
export function demoLaunchpad(): Launchpad {
  return create(LaunchpadSchema, {
    placeholder: "Search or jump to…",
    defaultCommandIds: ["new-product"],
    groups: [
      {
        id: "create",
        title: "Create",
        commands: [
          {
            id: "new-product",
            title: "New product",
            subtitle: "Create a product",
            keywords: ["add"],
            icon: "plus",
            action: {
              case: "openPanel",
              value: {
                panel: {
                  panelId: "new-product-form",
                  title: "New product",
                  body: {
                    case: "form",
                    value: {
                      fields: [
                        { fieldId: "name", label: "Name", kind: { case: "text", value: {} } },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
      },
      {
        id: "nav",
        title: "Navigate",
        commands: [
          {
            id: "go-settings",
            title: "Go to settings",
            keywords: ["preferences"],
            action: { case: "navigate", value: { route: "/settings" } },
          },
          {
            id: "list-products",
            title: "Products",
            action: { case: "openViewId", value: "products-list" },
          },
        ],
      },
      {
        id: "actions",
        title: "Actions",
        commands: [
          {
            id: "export",
            title: "Export data",
            action: { case: "rpc", value: { service: "acme.v1.Exporter", method: "Export" } },
          },
        ],
      },
    ],
  });
}
