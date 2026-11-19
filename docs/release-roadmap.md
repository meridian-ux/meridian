# Meridian release roadmap

Baseline captured November 19, 2026. GitHub tracks execution and owners. OpenSpec tasks and scenarios define closure evidence. [GitHub Project](https://github.com/orgs/meridian-ux/projects/1)

## Release gates and independent follow-ups

| Work | Entry condition | Closure evidence |
| --- | --- | --- |
| Public 1.0 distribution | Confirm exact RC source, registry names, bootstrap access and protected approval | Publish and independently verify all ten RC artifacts, qualify supported hosts, then publish and verify all ten stable artifacts. [#16](https://github.com/meridian-ux/meridian/issues/16), [#63](https://github.com/meridian-ux/meridian/issues/63), [OpenSpec](../openspec/changes/publish-meridian-v1/) |
| SwiftUI native proof | Preview evidence can be collected independently of the release | Disposition all 23 cells and promote only cells with passing native proof. [#235](https://github.com/meridian-ux/meridian/issues/235), [OpenSpec](../openspec/changes/qualify-swiftui-parity/) |
| Website social cards | Reproduce against the current site | Representative generated images and metadata use Meridian branding. [Site #7](https://github.com/meridian-ux/meridian-ux.github.io/issues/7), [OpenSpec](../openspec/changes/correct-site-social-card-branding/) |

The proposed public tag source is `080b5863`, which produced the staged archives. The later staging workflow and private source integration have their own provenance. Follow the [distribution runbook](../DISTRIBUTION.md) for release preflight, exact-byte verification, and partial-upload recovery.

Supported-host inventory and fixture selection can start before RC publication. Acceptance requires exact-version installs from the public registries and precedes stable publication. Production deployment and public FILE/schema selection retain independent decisions. The private repository maintains its host qualification, rollout, and backlog ledger.

## Completion baseline

| Measure | Result | How to count |
| --- | ---: | --- |
| Original roadmap issue closure | 79/81 (97.5%) | GitHub issues labeled `roadmap` in the public and private maintained repositories before this refresh (66/68 public, 13/13 private). Includes parent issues and their tasks. The frozen cohort ends at public issue #72 and private issue #21. |
| Original roadmap epic closure | 16/17 (94.1%) | Epic rows in the four milestone lists in [ROADMAP.md](../ROADMAP.md). Distribution is the remaining epic. |
| RC staging distribution | 10/10 | Seven npm packages and three Rust crates installed from temporary registries with matching archive bytes. [Run](https://github.com/meridian-ux/meridian/actions/runs/43298167778) |
| Public delivery gates | 0/5 evidenced | Current approved preflight, RC publication, public registry verification, supported-host RC acceptance, and stable publication with verification. Count one point per recorded pass. |
| Panel coverage | 129/161 render | 23 panel arms × 7 renderers. Nine cells have declared exclusions or degradation, and 23 are unverified SwiftUI preview cells. [Coverage manifest](../schemas/conformance/coverage.json) |
| Conversation and Launchpad | 24/27 and 7/7 render | Count the separate modality cells in the generated roadmap matrix. Three conversation cells have declared alternative entry points or exclusions. |

Each measure has a different denominator. Issue closure measures tracker progress, staging measures candidate distribution, and panel cells measure declared coverage. Avoid aggregating them into a single project percentage. Keep the original issue baseline fixed and report new scope through the workstream ledger. Update each measure when an issue closes or new acceptance evidence lands.

