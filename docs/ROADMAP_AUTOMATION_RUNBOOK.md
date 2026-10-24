# Roadmap automation implementation and owner rollout

Status: implementation candidate, **not installed, enabled, or production-verified**.
This runbook does not authorize App registration, installation, permissions,
credentials, workflow activation, live canaries, or a paid plan. Those remain
owner-controlled. Offline tests do not satisfy both-repository auto-add acceptance.

## Scope and credentials

The identical engine and workflows live in both repositories. Only open issues
with the exact `roadmap` label from `meridian-ux/meridian` and
`meridian-ux/meridian-internal` may be added to organization `meridian-ux`,
Project number `1`, named `Meridian roadmap`. The owner must independently confirm
its node ID and store it as `MERIDIAN_ROADMAP_PROJECT_ID`; the engine resolves the
fixed organization/number and rejects any mismatch on every attempt. No Project
or issue creation, field/status updates, removals, label changes, or milestone
changes are implemented. Existing native public auto-add stays enabled until
both-repository App operation is proven. Manual private addition is not an exception.

Proposed App installation: selected access to these two repositories only,
repository **Issues: read**, mandatory **Metadata: read**, organization
**Projects: read/write**. Every job requests one explicitly named repository,
Issues read, Metadata read, and Projects read (dry run) or write (apply). No
implicit installation-wide token, personal-token fallback, issue writes,
contents writes, pull-request writes, Actions writes, or package permission.
The workflow's separate `GITHUB_TOKEN` has only contents read for trusted checkout;
credentials are not persisted by checkout.

Residual privilege: organization Projects permission covers more than Project 1,
and Issues read covers more than labeled issues. Runtime checks are not a
credential-level single-Project or label restriction. Approve these privileges
and the credential custodians explicitly before setup. Public repository workflow
maintainers can modify code that uses its repository secret; restrict trusted
workflow changes and secret availability accordingly. Never expose the key to
PR jobs or paste keys/tokens into code, issues, artifacts, or chat.

## Trusted execution and duplicate handling

Runtime workflow `roadmap-auto-add.yml` handles opened/reopened/labeled/transferred
issue events, hourly reconciliation, and manual dispatch. It checks the owner
enable flag and exact repository allowlist, requires `refs/heads/main`, and checks
out `refs/heads/main`, never a ref or command from an event. PR fixture execution
is a separate workflow with no App secret or API calls.

GitHub Actions concurrency is repository-local; the common group serializes all
event/reconciliation work within each repository, not across repositories.
GitHub documents that `addProjectV2ItemById` returns the existing item ID for
already-added content. This server contract, complete membership scans, and
fresh eligibility checks handle cross-repository/native-rule races without
inventing a distributed lock or granting extra credentials. The concurrency
fixture simulates that documented server contract; it is not live proof.
See [GitHub's API documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
and [repository workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Default Actions concurrency may replace pending event runs. Hourly full
reconciliation in each repository repairs missed/replaced deliveries; schedule
timeliness is GitHub-managed, not a real-time guarantee. No webhook server or
cross-repository dispatch permission is required.

Each decision completely paginates Project items and refetches the issue's actual
node, repository, open state, and complete labels immediately before adding.
The event's labels/state/free text are not authoritative. Connections fail closed
on missing pages, cursor loops, duplicate IDs, changing totals, or bounds exceeding
500 pages/50,000 nodes. Inaccessible existing item contents are not logged or
treated as proof of a match. Only `addProjectV2ItemById` is a mutation, and a fresh
complete membership scan verifies its returned item/content identity.

Read retries and mutation retries are each capped at three attempts. Network
requests have a 15-second timeout, redirects are prohibited, response bodies are
bounded to 2 MiB, and partial GraphQL data is rejected. Revoked/missing permissions
fail without broadening access. Uncertain mutation responses trigger another full
membership and eligibility check before any retry. Required retry delays above
10 seconds stop the run rather than hammering the API before a reset. Retry or
the next reconciliation uses the same idempotent path, not deletion/re-addition.

There is no atomic GitHub API transaction for label/state validation plus item
addition. An issue can change immediately after its last eligibility read.
Existing closed/unlabeled items are intentionally retained; do not “repair” this
race by deleting items or writing issue fields. Transfers out of token scope fail
visibly or become ineligible; the destination's approved workflow reconciles its
own allowed repository. Failures never print arbitrary event/API bodies or errors.

## Owner-approved rollout, not executed by this candidate

1. Review both exact implementation revisions, tests, source equality, permissions,
   and action pins. Merge only with explicit merge authority and required checks.
   Do not change the existing native Project rules or reopened-to-Todo workflow.
2. Obtain owner approval for App registration/selected installation, the exact
   grants above, key custodian, secret availability, rotation, and activation.
   No such setup is performed by the implementation PRs.
3. Only after that approval, configure the App client ID as repository variable
   `MERIDIAN_ROADMAP_APP_CLIENT_ID`, the key as restricted repository secret
   `MERIDIAN_ROADMAP_APP_PRIVATE_KEY`, and the independently verified node ID as
   `MERIDIAN_ROADMAP_PROJECT_ID` in both repositories. Do not copy personal tokens.
   Pin/review official action updates rather than following mutable tags.
4. For separately approved read-only rollout, set `MERIDIAN_ROADMAP_AUTO_ADD_MODE`
   to `dry-run`, then `MERIDIAN_ROADMAP_AUTO_ADD_ENABLED` to `true` in each approved
   repository. The default absent enable flag skips the entire job, including
   token creation. Dispatch with `apply: false`; it scans existing open labeled
   issues, logs only fixed outcome names, and cannot call the mutation. The token
   requests Projects read. Keep private run logs private.
5. Review all `would-add`/failure outcomes and the exact candidate membership.
   Obtain explicit approval for live additions and any owner-provided canaries;
   never manufacture issues or change issue labels/state just to prove automation.
   For approved application, change mode to `apply`. Event/schedule runs can then
   add eligible missing issues; a manual dispatch still defaults to dry run and
   requires `apply: true` for writes. These are activation operations, not part
   of this candidate's implementation authority.
6. Prove actual automatic addition from both repositories, safe duplicate/native
   replays, transfer behavior, reconciliation of missed deliveries, visible
   permission failures, and unchanged unrelated items/fields/views. Only then
   evaluate retiring the redundant public native rule with owner approval.

Pinned actions reviewed for this candidate:

- `actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803` (v6, Node 24).
- `actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510`
  (v3, Node 24). Explicit permission inputs and default post-job revocation were
  verified in that revision's `action.yml`; `skip-token-revoke: false` is explicit.
  See the [official token action](https://github.com/actions/create-github-app-token/blob/64ab729a6294000f5aa4a4bc0b73d1f32bc45510/README.md).

## Verification, operations, and rollback

Run `node --test tools/roadmap_automation.test.mjs` with Node 20 or later. It uses
only offline API fixtures and requires no dependencies, credentials, or network.
Both repositories must retain identical engine, test, runtime workflow, and fixture
workflow bytes; compare their SHA-256 digests before coordinated updates. Local
fixture validation is independent of the unrelated SDK migration stack.

Owner operators should inspect failed run status and fixed outcome messages;
do not upload private payloads or full API responses to public logs. A green
skipped workflow is not successful auto-add evidence. GitHub may disable inactive
scheduled workflows; monitor enabled workflow/run state as an operational duty.

Rollback: set `MERIDIAN_ROADMAP_AUTO_ADD_ENABLED` to `false` in both repositories
and cancel any active apply jobs, then revoke the App installation/key as approved.
Already issued tokens expire within an hour and the action revokes them in its
normal post-job path; cancellation or runner failure is not guaranteed immediate
revocation. Removing secrets alone does not revoke an already issued token.
Preserve Project items and the existing public native rule. Incident response
must revoke the installation/token, not print credentials for diagnosis.

Rotate by creating an owner-approved replacement key, updating restricted secrets,
verifying a read-only run in each repository, then revoking the old key. Review
installation grants and trusted default-branch changes at the same time. No key
generation, secret update, grant, rotation, activation, or live API mutation was
performed by preparing this candidate.
