# M18: Go precision

Status: in-progress
Lane: go
Depends on: M17
Effort estimate: ~3 min agent-time (1 product / 1 proof / 1 other)
Plan/admin overhead: 1 min other

## Objective

Exercise a consumer plan with a completed prerequisite and independent active lanes.
This is synthetic test input, not evidence of completed production work.

## What problem are we solving

Plan authors need a way to keep independent work active without bypassing shared prerequisites.

## Who benefits and how

Reviewers can see which work may run together while unfinished prerequisites remain blocking.

## Scope

Validate the scheduling state represented by this fixture.

## Tasks

- [ ] Supply the bounded scheduling input. (est: 1 min product)

## Proof

- [ ] The scheduling snapshot matches the expected CLI result. [automated] (est: 1 min proof)

## Exit

The CLI reports the expected active lanes and dependency state.

## Stop / rescope

Stop if testing this snapshot requires production state or an external project.
