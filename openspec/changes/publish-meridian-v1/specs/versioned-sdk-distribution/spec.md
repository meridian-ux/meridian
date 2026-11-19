## ADDED Requirements

### Requirement: Verified public SDK releases

The release process SHALL publish versioned npm and Rust artifacts from an approved immutable source. It SHALL verify public RC bytes and exact-version consumption before stable approval.

#### Scenario: An RC is used to qualify stable

- **WHEN** an approved release candidate is published
- **THEN** all ten exact versions SHALL resolve from their intended public registries and match the retained release archives
- **AND** npm SHALL expose the RC under `next`
- **AND** supported-host results SHALL be recorded before stable publication

#### Scenario: A stable release is published

- **WHEN** the public RC has passed registry and supported-host acceptance and stable publication has separate approval
- **THEN** the stable release SHALL use its own reviewed tag and retained artifacts
- **AND** all ten exact stable versions SHALL resolve from the intended public registries and match those artifacts

