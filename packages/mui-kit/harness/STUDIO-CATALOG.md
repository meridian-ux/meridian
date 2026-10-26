# Studio catalog provenance

`studio-viewdescriptors.json` is generated from actual installed module
compositions, not translated from the old Action-shaped descriptor JSON.
The October 26, 2026 removal-candidate refresh retains all 22 maintained catalog
entry names and uses the canonical Affordance contract.

## Exact inputs

- Studio API `ALL_BUNDLES` fixture: `savvifi/studio`
  `dc1dbd15b95043d2a66c1f71e1ebe6700dad24bb`,
  `repos/api/integration-tests/fixtures/module-bundles.ts`.
- Studio DSL archive: `38957589c2aed19b614dba62a7a13770a777625a`.
- Studio's existing compiler artifact: `aion-module-toolchain-0.7.4.tar.gz`,
  release asset `500395210`; SHA-256
  `03bdc9d1d11526edcaaf091212c96a03da20cb61b96fee17bf35e757c51ca756`.
- Aion loader, SQL migrations, generated bindings, PostgreSQL backend, DI-free
  installer, and canonical producer source: `4c4eb1e6e61244839a259f19cefd7f42a1bfdd9d`.
- Installed Meridian SDK source: `df899525684ea7809ac0e9332bb05524f59b3a39`.
  Actual proto-ts package SHA-256:
  `81de45088e48c5edf7c6ec026fe1931037baad3e8d107fc7d9ef3e53a2c076a8`.

## Export path

1. Compile the real 13 Studio bundles and copy the pinned 20 core bundles.
   Validate their identities and complete module dependency closure. Aion's
   `prepare_studio_catalog_inputs.mjs` records each bundle hash.
2. Use Aion's canonical database codegen driver over the actual SQL migrations;
   generate bindings and declarations rather than substituting a graph mock.
3. Bootstrap an isolated PostgreSQL 16 test database with the canonical role graph
   and migrations. Install all 33 manifests with the real DI-free installer and
   PostgreSQL backend. Establish the explicit system-install session as the
   canonical installer does; do not alter SQL authorization gates.
4. Generate the core module package from those same bundle objects using Aion's
   artifact generator/aggregate tool. The UI's composition-kind discovery reads
   the real module bundles, not hand-authored namespace constants.
5. In an identity-checked `BEGIN READ ONLY` transaction, use the actual resource-query
   boundary and installed list/detail/dialog loaders. Project with the canonical
   producer and actual installed SDK. The exporter rejects a missing/extra entry
   and strictly decodes every emitted descriptor. Repeat on unchanged data and
   require identical output.

The reusable installed-graph exporter is in Aion's coordinated draft #97:
`ui/packages/meridian-projection/tools/export_installed_studio_catalog.mjs`.
Exporter implementation commit: `498ad7cd`.
It accepts a GraphClient plus the maintained inventory; connection identity and
read-only transaction enforcement remain the test harness's responsibility.
See that draft's preparation instructions for the exact private-source workflow.

## Verified scope and limits

The actual graph contains 31 entity-view resources and loads 11 list plus 11
detail compositions. This bundle set yields **zero dialog compositions**. Existing
field-less module/organization detail slots remain explicit adhoc placeholders;
the exporter does not fabricate their implementation or suppress loader warnings.
The catalog harness synthesizes display rows where no sample rows are provided,
as before. Descriptor structure is real; displayed sample cell values are not
customer data or evidence of live operation execution.
Bare legacy action keys without a declared canonical target stay visibly
unavailable; this refresh does not claim that every Studio operation is adopted.
The final JSON SHA-256 is
`2e4a1a26c995169abecd807198c4dc0fa4caad2400760527eec53ef636080f54`.

The initial local gate is `bazel build //packages/mui-kit:studio_catalog_figures`,
the exact capture target that failed on retired `actions`. Passing it is a
catalog rendering check, not full application integration or release approval.
No schema/FILE baseline, admission policy, compatibility selector, or publication
gate changes as part of regenerating this fixture.
