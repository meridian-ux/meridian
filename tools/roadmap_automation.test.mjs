import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AutomationError, githubClient, main, REPOSITORIES, runAutomation } from "./roadmap_automation.mjs";

const PROJECT = "PVT_fixture", ISSUE = "I_fixture";
const item = (issue = ISSUE, key = "PVTI_fixture") => ({ id: key, content: { __typename: "Issue", id: issue } });
function fixture(repository = REPOSITORIES[0]) {
  const state = { repository, state: "OPEN", labels: ["roadmap"], items: [], issueIds: [ISSUE], size: 100, queries: [], writes: [], pauses: [],
    project: { id: PROJECT, number: 1, title: "Meridian roadmap", closed: false } };
  const page = (nodes, after) => {
    const start = after === null ? 0 : Number(after), end = start + state.size;
    return { nodes: nodes.slice(start, end), totalCount: nodes.length,
      pageInfo: { hasNextPage: end < nodes.length, endCursor: end < nodes.length ? String(end) : null } };
  };
  const api = {
    pause: async (error, attempt) => { state.pauses.push([error.code, attempt]); },
    async query(query, variables) {
      state.queries.push([query, variables]);
      if (state.query) { const override = await state.query(query, variables); if (override !== undefined) return override; }
      if (query.includes("query RoadmapProject")) return { organization: { login: "meridian-ux", projectV2: state.project } };
      if (query.includes("query RoadmapItems")) return { node: { id: PROJECT, items: page(state.items, variables.after) } };
      if (query.includes("query RoadmapIssue(")) return { node: { __typename: "Issue", id: variables.issue, state: state.state,
        repository: { nameWithOwner: state.repository }, labels: page(state.labels.map((name, index) => ({ name, id: `LA_${index}` })), variables.after) } };
      if (query.includes("query RoadmapIssues")) return { repository: { nameWithOwner: repository, issues: page(state.issueIds.map(id => ({ id })), variables.after) } };
      assert.fail("Unexpected operation");
    },
    async mutate(query, variables) {
      state.writes.push([query, variables]);
      assert.match(query, /^mutation RoadmapAdd/); assert.deepEqual(Object.keys(variables).sort(), ["issue", "project"]);
      assert.equal(variables.project, PROJECT);
      if (state.mutate) return state.mutate(variables);
      const value = state.items.find(value => value.content?.id === variables.issue) ?? item(variables.issue, `PVTI_${state.items.length}`);
      if (!state.items.includes(value)) state.items.push(value);
      return { addProjectV2ItemById: { item: value } };
    },
  };
  const run = (options = {}) => runAutomation({ api, repository, projectId: PROJECT, eventName: "issues",
    event: { action: "opened", issue: { node_id: ISSUE, title: "Do not log", labels: [] } }, apply: true, ...options });
  return { state, api, run };
}

for (const repository of REPOSITORIES) {
  for (const action of ["opened", "reopened", "labeled", "transferred"]) test(`${repository}: refetched ${action} adds once and replays safely`, async () => {
    const host = fixture(repository);
    assert.deepEqual(await host.run({ event: { action, issue: { node_id: ISSUE } } }), [{ issueId: ISSUE, outcome: "present" }]);
    assert.equal(host.state.writes.length, 1); assert.equal(host.state.items.length, 1);
    assert.deepEqual(await host.run(), [{ issueId: ISSUE, outcome: "already-present" }]); assert.equal(host.state.writes.length, 1);
    assert(host.state.queries.filter(([query]) => query.includes("query RoadmapItems")).length >= 3);
  });
  test(`${repository}: read-only reconciliation discovers all pages`, async () => {
    const host = fixture(repository); host.state.size = 1; host.state.labels = ["other", "roadmap"];
    host.state.items = [item("I_other", "PVTI_other"), { id: "PVTI_inaccessible", content: null }];
    host.state.issueIds = [ISSUE, "I_second"];
    assert.deepEqual((await host.run({ eventName: "schedule", apply: false })).map(value => value.outcome), ["would-add", "would-add"]);
    assert.equal(host.state.writes.length, 0);
    assert(host.state.queries.some(([query, variables]) => query.includes("RoadmapIssues") && variables.after === "1"));
    assert(host.state.queries.some(([query, variables]) => query.includes("RoadmapIssue(") && variables.after === "1"));
  });
}
test("event eligibility is untrusted; closed and unlabeled issues never mutate", async () => {
  for (const reason of ["closed", "unlabeled"]) {
    const host = fixture(); if (reason === "closed") host.state.state = "CLOSED"; else host.state.labels = [];
    assert.equal((await host.run({ event: { action: "labeled", issue: { node_id: ISSUE, state: "open", labels: [{ name: "roadmap" }] } } }))[0].outcome, "ineligible");
    assert.equal(host.state.writes.length, 0);
  }
});
test("wrong repository, Project configuration, event, or locator fails closed", async () => {
  for (const options of [{ repository: "other/repo" }, { projectId: "other" }, { eventName: "pull_request" },
    { event: { action: "opened", issue: { node_id: "bad\n::error::" } } }, { apply: "true" }]) {
    const host = fixture(); await assert.rejects(host.run(options), AutomationError); assert.equal(host.state.writes.length, 0);
  }
  const host = fixture(); assert.deepEqual(await host.run({ event: { action: "edited" } }), []); assert.equal(host.state.queries.length, 0);
});
test("fixed Project identity, number, name, and closed state are enforced", async () => {
  for (const wrong of [{ id: "PVT_other" }, { number: 2 }, { title: "Other" }, { closed: true }]) {
    const host = fixture(); Object.assign(host.state.project, wrong);
    await assert.rejects(host.run(), error => error.code === "project-mismatch"); assert.equal(host.state.writes.length, 0);
  }
});
test("a transferred issue is skipped in its old repo and eligible in its destination", async () => {
  const host = fixture(); host.state.repository = REPOSITORIES[1];
  assert.equal((await host.run())[0].outcome, "ineligible"); assert.equal(host.state.writes.length, 0);
  assert.equal((await host.run({ repository: REPOSITORIES[1] }))[0].outcome, "present");
});
test("a transfer outside the allowlist, missing issue, or PR locator never adds", async () => {
  for (const node of [null, { __typename: "PullRequest", id: ISSUE }, { __typename: "Issue", id: ISSUE, repository: { nameWithOwner: "other/repo" } }]) {
    const host = fixture(); host.state.query = async query => query.includes("query RoadmapIssue(") ? { node } : undefined;
    await assert.rejects(host.run(), error => error.code === "issue-mismatch"); assert.equal(host.state.writes.length, 0);
  }
});
for (const target of ["RoadmapItems", "RoadmapIssue(", "RoadmapIssues"]) {
  for (const defect of ["missing", "truncated", "cursor", "duplicate", "count-change"]) test(`${target} rejects ${defect} pagination without mutation`, async () => {
    const host = fixture(); let count = 0;
    host.state.query = async query => {
      if (!query.includes(`query ${target}`)) return;
      count++;
      const node = target === "RoadmapItems" ? item() : target === "RoadmapIssues" ? { id: ISSUE } : { id: "LA_one", name: "roadmap" };
      const connection = defect === "missing" ? null : { nodes: [node], totalCount: defect === "truncated" ? 2 : defect === "count-change" && count > 1 ? 3 : 2,
        pageInfo: { hasNextPage: defect !== "truncated", endCursor: defect === "cursor" ? null : "same" } };
      if (target === "RoadmapItems") return { node: { id: PROJECT, items: connection } };
      if (target === "RoadmapIssues") return { repository: { nameWithOwner: REPOSITORIES[0], issues: connection } };
      return { node: { __typename: "Issue", id: ISSUE, state: "OPEN", repository: { nameWithOwner: REPOSITORIES[0] }, labels: connection } };
    };
    await assert.rejects(host.run({ eventName: target === "RoadmapIssues" ? "schedule" : "issues" }), AutomationError);
    assert.equal(host.state.writes.length, 0);
  });
}
test("eligibility is refetched after the full item scan immediately before writing", async () => {
  const host = fixture(); host.state.query = async query => { if (query.includes("query RoadmapItems")) host.state.labels = []; };
  assert.equal((await host.run())[0].outcome, "ineligible"); assert.equal(host.state.writes.length, 0);
});
test("timeout after commit requeries membership and does not replay the mutation", async () => {
  const host = fixture(); host.state.mutate = async () => { host.state.items.push(item()); throw new AutomationError("network", true); };
  assert.equal((await host.run())[0].outcome, "already-present"); assert.equal(host.state.writes.length, 1); assert.equal(host.state.pauses.length, 1);
});
test("timeout before commit retries only after another item scan and eligibility check", async () => {
  const host = fixture(); host.state.mutate = async () => {
    if (host.state.writes.length < 2) throw new AutomationError("network", true);
    host.state.items.push(item()); return { addProjectV2ItemById: { item: item() } };
  };
  assert.equal((await host.run())[0].outcome, "present"); assert.equal(host.state.writes.length, 2);
  assert.equal(host.state.queries.filter(([query]) => query.includes("query RoadmapIssue(")).length, 2);
});
test("concurrent deliveries rely on the documented server-side existing-item ID contract", async () => {
  const host = fixture(); let release; const barrier = new Promise(resolve => { release = resolve; });
  host.state.mutate = async () => {
    if (host.state.writes.length === 2) release(); await barrier;
    const value = host.state.items[0] ?? item(); if (!host.state.items.length) host.state.items.push(value);
    return { addProjectV2ItemById: { item: value } };
  };
  assert.deepEqual((await Promise.all([host.run(), host.run()])).map(values => values[0].outcome), ["present", "present"]);
  assert.equal(host.state.writes.length, 2); assert.equal(host.state.items.length, 1);
});
test("persistent mutation outages stop after three attempts, never grant broader access", async () => {
  const host = fixture(); host.state.mutate = async () => { throw new AutomationError("unavailable", true); };
  await assert.rejects(host.run(), AutomationError); assert.equal(host.state.writes.length, 3); assert.equal(host.state.pauses.length, 2);
});
test("mutation mismatch or absent persistence is a visible failure, not success", async () => {
  for (const response of [{ addProjectV2ItemById: { item: item("I_wrong") } }, { addProjectV2ItemById: { item: item() } }, {}]) {
    const host = fixture(); host.state.mutate = async () => response;
    await assert.rejects(host.run(), AutomationError); assert.equal(host.state.writes.length, 1);
  }
});
const json = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
test("HTTP client has one fixed origin, rejects redirects, and redacts denied credentials/errors", async () => {
  for (const status of [401, 403, 404, 422]) {
    let calls = 0;
    const api = githubClient("private-token", { fetcher: async (url, options) => {
      calls++; assert.equal(url, "https://api.github.com/graphql"); assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer private-token"); return new Response("private-body", { status });
    } });
    await assert.rejects(api.query("query X {}", {}), error => error.code === "api-denied" && !/private/.test(error.message)); assert.equal(calls, 1);
  }
});
test("HTTP read retries bounded rate limits, but honors a retry delay outside its budget by stopping", async () => {
  const waits = []; let calls = 0;
  const api = githubClient("token", { sleep: async ms => waits.push(ms), fetcher: async () => ++calls === 1
    ? new Response("", { status: 429, headers: { "retry-after": "2" } }) : json({ data: { ok: true } }) });
  assert.deepEqual(await api.query("query X {}", {}), { ok: true }); assert.deepEqual(waits, [2000]);
  const blocked = githubClient("token", { fetcher: async () => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0", "retry-after": "60" } }), sleep: async () => assert.fail("Must not retry before reset") });
  await assert.rejects(blocked.query("query X {}", {}), error => error.code === "retry-unavailable");
});
test("partial GraphQL data and missing permissions fail closed without mutation/read retries", async () => {
  for (const errors of [[{ type: "FORBIDDEN", message: "private details" }], [], [{ type: "RATE_LIMITED" }, { type: "FORBIDDEN" }]]) {
    let calls = 0; const api = githubClient("token", { fetcher: async () => { calls++; return json({ data: { ok: true }, errors }); } });
    await assert.rejects(api.query("query X {}", {}), error => error.code === "graphql-errors" && !error.message.includes("private")); assert.equal(calls, 1);
  }
});
test("explicit GraphQL rate errors and service outages have bounded read retries", async () => {
  for (const response of [() => json({ errors: [{ type: "RATE_LIMITED" }] }), () => new Response("", { status: 503 })]) {
    const waits = []; let calls = 0;
    const api = githubClient("token", { fetcher: async () => { calls++; return response(); }, sleep: async ms => waits.push(ms) });
    await assert.rejects(api.query("query X {}", {}), AutomationError); assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
  }
});
test("GraphQL rate-limit reset headers are honored even with HTTP 200", async () => {
  const api = githubClient("token", { now: () => 1000, sleep: async () => assert.fail("Must not retry before reset"),
    fetcher: async () => new Response(JSON.stringify({ errors: [{ type: "RATE_LIMITED" }] }), { headers: { "x-ratelimit-reset": "61" } }) });
  await assert.rejects(api.query("query X {}", {}), error => error.code === "retry-unavailable");
});
test("revoked token or permission denial during a write does not retry the mutation", async () => {
  const host = fixture(); host.state.mutate = async () => { throw new AutomationError("api-denied"); };
  await assert.rejects(host.run(), error => error.code === "api-denied"); assert.equal(host.state.writes.length, 1); assert.equal(host.state.pauses.length, 0);
});
test("an issue that becomes ineligible after an uncertain mutation is not retried", async () => {
  const host = fixture(); host.state.mutate = async () => { host.state.state = "CLOSED"; throw new AutomationError("network", true); };
  assert.equal((await host.run())[0].outcome, "ineligible"); assert.equal(host.state.writes.length, 1);
});
test("a Project mismatch on retry stops an uncertain write without replay", async () => {
  const host = fixture(); host.state.mutate = async () => { host.state.project.id = "PVT_changed"; throw new AutomationError("network", true); };
  await assert.rejects(host.run(), error => error.code === "project-mismatch"); assert.equal(host.state.writes.length, 1);
});
test("scheduled enumeration cannot substitute a different repository", async () => {
  const host = fixture(); host.state.query = async query => query.includes("query RoadmapIssues")
    ? { repository: { nameWithOwner: "other/repo" } } : undefined;
  await assert.rejects(host.run({ eventName: "schedule" }), error => error.code === "repository-mismatch"); assert.equal(host.state.writes.length, 0);
});
test("manual dry run never mutates while apply reconciles missing issues", async () => {
  const host = fixture(); host.state.items = [item()]; host.state.issueIds = [ISSUE, "I_new"];
  assert.deepEqual((await host.run({ eventName: "workflow_dispatch", apply: false })).map(value => value.outcome), ["already-present", "would-add"]);
  assert.equal(host.state.writes.length, 0);
  assert.deepEqual((await host.run({ eventName: "schedule" })).map(value => value.outcome), ["already-present", "present"]);
  assert.equal(host.state.writes.length, 1); assert.equal(host.state.items.length, 2);
});
test("reconciliation enumerates all open issues without trusting a private label filter", async () => {
  const host = fixture(REPOSITORIES[1]); host.state.issueIds = [ISSUE, "I_unlabeled"];
  host.state.query = async (query, variables) => {
    if (query.includes("query RoadmapIssues")) assert(!query.includes("labels:"));
    if (query.includes("query RoadmapIssue(") && variables.issue === "I_unlabeled") return { node: {
      __typename: "Issue", id: "I_unlabeled", state: "OPEN", repository: { nameWithOwner: REPOSITORIES[1] },
      labels: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } },
    } };
  };
  assert.deepEqual((await host.run({ eventName: "schedule" })).map(value => value.outcome), ["present", "ineligible"]);
  assert.equal(host.state.writes.length, 1); assert.equal(host.state.writes[0][1].issue, ISSUE);
});
test("transport never retries mutations; arbitrary network errors are sanitized", async () => {
  let calls = 0; const api = githubClient("private-token", { fetcher: async () => { calls++; throw Error("private network payload"); } });
  await assert.rejects(api.mutate("mutation X {}", {}), error => error.code === "network" && !error.message.includes("private")); assert.equal(calls, 1);
});
test("invalid, missing, or oversized JSON is rejected without exposing the body", async () => {
  for (const response of [() => new Response("private body"), () => json({}), () => new Response("x".repeat(2 * 1024 * 1024 + 1))]) {
    const api = githubClient("token", { fetcher: async () => response() });
    await assert.rejects(api.query("query X {}", {}), error => error instanceof AutomationError && !error.message.includes("private"));
  }
});
test("CLI is inactive by default and cannot execute a PR/event-supplied ref", async () => {
  for (const env of [{}, { GITHUB_REF: "refs/pull/1/head", MERIDIAN_ROADMAP_AUTO_ADD_ENABLED: "true", MERIDIAN_ROADMAP_APPLY: "true" }]) {
    await assert.rejects(main(env), error => error.code === "inactive-or-untrusted-ref");
  }
});
test("runtime workflow keeps credentials/activation gated and has no PR execution path", () => {
  const source = readFileSync(new URL("../.github/workflows/roadmap-auto-add.yml", import.meta.url), "utf8");
  assert(!source.includes("pull_request")); assert.match(source, /AUTO_ADD_ENABLED == 'true'/); assert.match(source, /github.ref == 'refs\/heads\/main'/);
  assert.match(source, /ref: refs\/heads\/main/); assert.match(source, /persist-credentials: false/);
  assert.match(source, /repositories: \$\{\{ github.event.repository.name \}\}/);
  assert.match(source, /permission-issues: read/); assert.match(source, /permission-metadata: read/);
  assert.match(source, /permission-organization-projects:/); assert.match(source, /skip-token-revoke: false/);
  for (const match of source.matchAll(/uses: ([^\s]+)/g)) assert.match(match[1], /@[0-9a-f]{40}$/);
  assert(!/permission-(?:contents|pull-requests|actions): write/.test(source));
  assert.match(source, /cancel-in-progress: false/); assert.match(source, /schedule:/); assert.match(source, /default: false/);
});
