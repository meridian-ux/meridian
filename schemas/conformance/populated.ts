// Populated responses for the canonical conformance descriptors.
//
// The descriptor is the cross-language protobuf contract; these responses are
// test-only transport values supplied to each renderer's local invoker. Keeping
// the scenario data here makes every browser realization exercise the same
// rows instead of quietly growing kit-specific examples.

export const POPULATED_RESPONSES = {
  resource_cards: {
    services: [
      {
        name: "GitHub",
        description: "Source control",
      },
      {
        name: "PagerDuty",
        description: "Incident response",
      },
    ],
  },
  gallery: {
    items: [
      {
        name: "GitHub",
        description: "Source control",
        status: "Connected",
        href: "https://github.com",
        action: "Manage",
      },
      {
        name: "PagerDuty",
        description: "Incident response",
        status: "Connected",
        href: "https://pagerduty.com",
        action: "Manage",
      },
    ],
  },
} as const;
