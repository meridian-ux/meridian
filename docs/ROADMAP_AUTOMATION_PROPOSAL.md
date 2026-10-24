# Proposal: scoped roadmap Project automation

Status: implementation PRs authorized; **not installed or enabled**. Owner-gated
workflow definitions, offline fixtures, and a [rollout runbook](ROADMAP_AUTOMATION_RUNBOOK.md)
are prepared. No App, key, secret, permission grant, paid plan, new issue, or live
activation is created by this candidate.

## Target and permission boundary

Automatically add open issues labeled `roadmap` from only
`meridian-ux/meridian` and `meridian-ux/meridian-internal` to the existing
[Meridian roadmap](https://github.com/orgs/meridian-ux/projects/1). Keep the
existing native public-repository rule until an approved rollout proves both
repositories work. Manual addition is not a substitute for either automation.

Propose one organization-owned GitHub App, installed on those two selected
repositories, with organization **Projects: read/write**, repository **Issues:
read**, and mandatory **Metadata: read**. No issue writes, pull-request access,
contents writes, administration, workflow writes, or package permission is
needed for issue-only item addition. The ordinary repository `GITHUB_TOKEN`
cannot supply organization Project access. See GitHub's
[Actions/Projects permission guidance](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions).

Important limitation: organization Projects access is broader than this one
Project. Selecting two repositories and checking a fixed Project ID at runtime
does **not** create a single-Project permission boundary. Issues read access is
also not restricted to the `roadmap` label. An organization owner must approve
these residual privileges and the credential custodians before installation.

## Proposed execution design

After separate setup approval, add a reviewed default-branch workflow to each
repository for issue opened, reopened, labeled, and transferred events. Use
identical reviewed logic and a pinned official token action; do not check out
or execute code from an issue, PR head, or event-supplied ref. Keep the workflow's
own token minimal; if trusted script checkout is necessary, contents read is
separate from the App token's permissions.

Each run would:

1. Request a short-lived installation token restricted to the current allowed
   repository and the approved permissions. Never inherit every installation
   permission implicitly. Keep normal end-of-job revocation enabled.
2. Refetch the issue by node ID. Verify its actual repository, open state, and
   fully paginated labels, rather than trusting a stale event or its free text.
3. Resolve organization `meridian-ux`, Project number `1`, and its approved node
   ID. Reject a mismatch. Fully paginate item identities before mutation.
4. Serialize within each repository. Across repositories/native rules, rely on
   the documented API contract that adding existing content returns its existing
   item ID, not on a nonexistent cross-repository Actions lock. If already present, succeed without
   mutation. Otherwise use only `addProjectV2ItemById`; after an ambiguous
   timeout, requery before retrying. Use bounded rate-limit/backoff handling and
   fail visibly on GraphQL errors or incomplete pagination.
5. Record only fixed outcome names. Do not log
   tokens, private issue titles/bodies, or complete event payloads. Private
   repository logs remain private.

Do not edit issue fields, labels, milestones, dates, Project status, existing
items, or other workflows. Closed/unlabeled existing items are not deleted.
The intentionally disabled reopened-to-Todo workflow stays disabled. Preserve
the six label-authoritative views and all existing items.

GitHub supports installation-token GraphQL Project mutations, including
[item addition](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).
Installation tokens expire after one hour and can be narrowed to selected
repositories/permissions; see
[installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).
The [official token action](https://github.com/actions/create-github-app-token)
supports explicit permission selection and revokes its token after the job by
default. Review and pin its exact implementation revision before activation.

## Verification and owner-controlled rollout

Before requesting installation approval, prepare tests for allowed events in
both repositories; wrong repository/Project, closed/unlabeled issues, paginated
labels/items, duplicate/concurrent delivery, transfer, revoked token, rate limit,
ambiguous mutation response, and missing permission. Fixtures contain no secrets
or private issue content. A protected reconciliation workflow should eventually
detect missed open `roadmap` issues in both repositories without a manual-add
exception; its schedule and enablement require rollout approval too.

First perform read-only dry runs against existing items. An owner must provide
or approve any live test issues and mutations; do not manufacture canaries or
change real roadmap issue state merely to test the automation. Acceptance needs
actual successful automatic addition from **both** repositories, duplicate-safe
replays, visible failures, and evidence that unrelated items/fields stayed intact.
An offline fixture suite or an inactive implementation is not that production evidence.

The owner must separately approve App registration/installation, exact grants,
key generation and storage, restricted secret availability, pinned workflow PRs,
and activation. Keep key material out of this repository/chat; do not copy a
personal credential into a workflow. Document rotation and incident revocation.
Rollback disables these workflows and revokes the App installation/key without
deleting Project items or broadening access. Both-repo automation remains an
open v1 requirement until the approved setup is enabled and verified.
