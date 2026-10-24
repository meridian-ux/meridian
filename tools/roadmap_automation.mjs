// GitHub already defines the JSON API/event schema. All other values here are
// in-process state; no new serialized manifest, grant, or audit DTO is introduced.
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const OWNER = "meridian-ux";
export const REPOSITORIES = ["meridian-ux/meridian", "meridian-ux/meridian-internal"];
const ISSUE_EVENTS = ["opened", "reopened", "labeled", "transferred"];
const NODE_ID = /^[A-Za-z0-9_=-]{1,200}$/;
const PROJECT_ID = /^PVT_[A-Za-z0-9_-]{1,196}$/;
const LIMIT = 500;

export class AutomationError extends Error {
  constructor(code, transient = false, delay = 1000) {
    super(`Roadmap automation stopped: ${code}.`);
    this.code = code; this.transient = transient; this.delay = delay;
  }
}
function requireValue(condition, code) { if (!condition) throw new AutomationError(code); }
function id(value) { requireValue(typeof value === "string" && NODE_ID.test(value), "invalid-identity"); return value; }

// Never include response bodies, event text, tokens, or thrown fetch errors in
// diagnostics. Retry reads only; an uncertain mutation must be reconciled first.
export function githubClient(token, { fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  requireValue(typeof token === "string" && token.length > 0, "missing-app-token");
  async function once(query, variables) {
    let response;
    try {
      response = await fetcher("https://api.github.com/graphql", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "meridian-roadmap-automation" },
        body: JSON.stringify({ query, variables }),
      });
    } catch { throw new AutomationError("network", true); }
    const retryDelay = () => {
      const retry = Number(response.headers.get("retry-after")), reset = Number(response.headers.get("x-ratelimit-reset"));
      return retry > 0 ? retry * 1000 : reset > 0 ? Math.max(1000, reset * 1000 - now()) : 1000;
    };
    if (!response.ok) {
      const limited = response.status === 429 || response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
      throw new AutomationError(limited ? "rate-limit" : response.status >= 500 ? "unavailable" : "api-denied", limited || response.status >= 500, limited ? retryDelay() : 1000);
    }
    let payload;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        requireValue(size <= 2 * 1024 * 1024, "response-limit"); chunks.push(chunk);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError("invalid-response");
    }
    if (payload.errors !== undefined) {
      // Reject partial data too. Only an explicit all-rate-limit error retries.
      const limited = Array.isArray(payload.errors) && payload.errors.length > 0
        && payload.errors.every(error => error?.type === "RATE_LIMITED");
      throw new AutomationError(limited ? "rate-limit" : "graphql-errors", limited, limited ? retryDelay() : 1000);
    }
    requireValue(payload.data && typeof payload.data === "object", "invalid-response");
    return payload.data;
  }
  async function pause(error, attempt) {
    requireValue(error instanceof AutomationError && error.transient && error.delay <= 10000, "retry-unavailable");
    await sleep(Math.max(error.delay, 1000 * 2 ** attempt));
  }
  return {
    pause,
    async query(query, variables) {
      for (let attempt = 0; ; attempt++) {
        try { return await once(query, variables); }
        catch (error) {
          if (!(error instanceof AutomationError) || !error.transient || attempt >= 2) throw error;
          await pause(error, attempt);
        }
      }
    },
    // Deliberately no transport-level retry for mutations.
    mutate: once,
  };
}

const PAGE = "pageInfo { hasNextPage endCursor } totalCount";
const PROJECT = `query RoadmapProject { organization(login: "meridian-ux") { login projectV2(number: 1) { id number title closed } } }`;
const ITEMS = `query RoadmapItems($project: ID!, $after: String) { node(id: $project) { ... on ProjectV2 { id items(first: 100, after: $after) { ${PAGE} nodes { id content { __typename ... on Issue { id } } } } } } }`;
const ISSUE = `query RoadmapIssue($issue: ID!, $after: String) { node(id: $issue) { __typename ... on Issue { id state repository { nameWithOwner } labels(first: 100, after: $after) { ${PAGE} nodes { id name } } } } }`;
const ISSUES = `query RoadmapIssues($after: String, $name: String!) { repository(owner: "meridian-ux", name: $name) { nameWithOwner issues(first: 100, after: $after, states: OPEN, labels: ["roadmap"]) { ${PAGE} nodes { id } } } }`;
const ADD = `mutation RoadmapAdd($project: ID!, $issue: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $issue }) { item { id content { __typename ... on Issue { id } } } } }`;

// Fail closed if a connection is truncated, inconsistent, duplicated, or loops.
// Count changes during a scan require a fresh run rather than a partial decision.
async function pages(load, identity) {
  const values = [], seen = new Set(), cursors = new Set(); let after = null, total;
  for (let page = 0; page < LIMIT; page++) {
    const connection = await load(after);
    requireValue(connection && Array.isArray(connection.nodes) && connection.nodes.length <= 100
      && Number.isSafeInteger(connection.totalCount) && connection.totalCount >= 0
      && typeof connection.pageInfo?.hasNextPage === "boolean", "incomplete-pagination");
    total ??= connection.totalCount;
    requireValue(total === connection.totalCount && total <= LIMIT * 100, "inconsistent-pagination");
    for (const node of connection.nodes) {
      const key = identity(node); requireValue(!seen.has(key), "duplicate-pagination");
      seen.add(key); values.push(node);
    }
    const { hasNextPage, endCursor } = connection.pageInfo;
    if (!hasNextPage) { requireValue(values.length === total, "incomplete-pagination"); return values; }
    requireValue(connection.nodes.length > 0 && typeof endCursor === "string" && endCursor.length > 0
      && !cursors.has(endCursor), "incomplete-pagination");
    cursors.add(endCursor); after = endCursor;
  }
  throw new AutomationError("pagination-limit");
}

async function project(api, expected) {
  const { organization } = await api.query(PROJECT, {}), value = organization?.projectV2;
  requireValue(organization?.login === OWNER && value?.id === expected && value.number === 1
    && value.title === "Meridian roadmap" && value.closed === false, "project-mismatch");
}
async function items(api, expected) {
  const result = await pages(async after => {
    const { node } = await api.query(ITEMS, { project: expected, after });
    requireValue(node?.id === expected, "project-mismatch"); return node.items;
  }, node => id(node?.id));
  return result;
}
async function eligible(api, issueId, repository) {
  let eligible = true;
  const labels = await pages(async after => {
    const { node } = await api.query(ISSUE, { issue: issueId, after });
    requireValue(node?.__typename === "Issue" && node.id === issueId && REPOSITORIES.includes(node.repository?.nameWithOwner), "issue-mismatch");
    if (node.state !== "OPEN" || node.repository.nameWithOwner !== repository) eligible = false;
    return node.labels;
  }, node => { requireValue(typeof node?.name === "string", "invalid-label"); return id(node.id); });
  return eligible && labels.some(label => label.name === "roadmap");
}

export async function runAutomation({ api, repository, projectId, eventName, event = {}, apply = false }) {
  requireValue(REPOSITORIES.includes(repository) && PROJECT_ID.test(projectId ?? "") && typeof apply === "boolean", "configuration");
  let issueIds;
  if (eventName === "issues") {
    if (!ISSUE_EVENTS.includes(event.action)) return [];
    // The payload supplies only a locator; its labels, state, and repo are never trusted.
    issueIds = [id(event.issue?.node_id)];
  } else {
    requireValue(eventName === "schedule" || eventName === "workflow_dispatch", "unsupported-event");
    issueIds = null;
  }
  await project(api, projectId);
  if (issueIds === null) {
    issueIds = (await pages(async after => {
      const { repository: actual } = await api.query(ISSUES, { name: repository.split("/")[1], after });
      requireValue(actual?.nameWithOwner === repository, "repository-mismatch"); return actual.issues;
    }, node => id(node?.id))).map(node => node.id);
  }
  const results = [];
  for (const issueId of issueIds) {
    let outcome;
    for (let attempt = 0; ; attempt++) {
      // Validate the fixed Project on every retry and refetch eligibility after
      // the complete item scan, as close to the write as the API permits.
      await project(api, projectId);
      const existing = (await items(api, projectId)).find(item => item.content?.__typename === "Issue" && item.content.id === issueId);
      if (!await eligible(api, issueId, repository)) { outcome = "ineligible"; break; }
      if (existing) { outcome = "already-present"; break; }
      if (!apply) { outcome = "would-add"; break; }
      try {
        const data = await api.mutate(ADD, { project: projectId, issue: issueId });
        const item = data.addProjectV2ItemById?.item;
        requireValue(item?.content?.__typename === "Issue" && item.content.id === issueId, "mutation-mismatch"); id(item.id);
        // Confirm persistence through a fresh complete Project item scan.
        requireValue((await items(api, projectId)).some(value => value.id === item.id && value.content?.id === issueId), "addition-unverified");
        outcome = "present"; break;
      } catch (error) {
        if (!(error instanceof AutomationError) || !error.transient || attempt >= 2) throw error;
        await api.pause(error, attempt);
        // Never replay an uncertain add without first requerying membership.
      }
    }
    results.push({ issueId, outcome });
  }
  return results;
}

export async function main(env = process.env) {
  requireValue(env.GITHUB_REF === "refs/heads/main" && env.MERIDIAN_ROADMAP_AUTO_ADD_ENABLED === "true"
    && ["true", "false"].includes(env.MERIDIAN_ROADMAP_APPLY), "inactive-or-untrusted-ref");
  requireValue(REPOSITORIES.includes(env.GITHUB_REPOSITORY) && PROJECT_ID.test(env.MERIDIAN_ROADMAP_PROJECT_ID ?? ""), "configuration");
  requireValue(env.GITHUB_EVENT_PATH && statSync(env.GITHUB_EVENT_PATH).size <= 8 * 1024 * 1024, "event-limit");
  let event;
  try { event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")); } catch { throw new AutomationError("invalid-event"); }
  const results = await runAutomation({ api: githubClient(env.MERIDIAN_ROADMAP_APP_TOKEN), repository: env.GITHUB_REPOSITORY,
    projectId: env.MERIDIAN_ROADMAP_PROJECT_ID, eventName: env.GITHUB_EVENT_NAME, event,
    apply: env.MERIDIAN_ROADMAP_APPLY === "true" });
  // No private payload or arbitrary event strings, even on a successful run.
  for (const { outcome } of results) console.log(`Roadmap automation: ${outcome}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof AutomationError ? error.message : "Roadmap automation stopped: unexpected-error."); process.exitCode = 1; });
}
