## ADDED Requirements

### Requirement: Evidence-backed SwiftUI coverage

The coverage manifest SHALL require passing applicable SwiftUI evidence for a promoted cell and SHALL retain an explicit waiver where evidence is incomplete.

#### Scenario: A preview coverage cell is promoted

- **WHEN** a SwiftUI panel cell changes from unverified to renders
- **THEN** the cell SHALL link to passing native evidence covering its declared behavior and accessibility
- **AND** the coverage and snapshot gates SHALL pass
