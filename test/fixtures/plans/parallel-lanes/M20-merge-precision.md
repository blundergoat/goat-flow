# M20: Merge precision

Status: not-started
Depends on: M18, M19
Effort estimate: ~3 min agent-time (1 product / 1 proof / 1 other)
Plan/admin overhead: 1 min other

## Objective

Exercise a consumer plan whose independent active lanes meet in one final milestone.
This is synthetic test input, not evidence of completed production work.

## What problem are we solving

Two lanes that finish separately leave no single point where the combined result is checked.

## Who benefits and how

Reviewers get one milestone that confirms both lanes landed before the plan is called done.

## Scope

Validate the final join represented by this fixture.

## Tasks

- [ ] Supply the bounded join input. (est: 1 min product)

## Proof

- [ ] The joined plan passes the expected CLI check. [automated] (est: 1 min proof)

## Exit

The CLI accepts the plan with both lanes joined.

## Stop / rescope

Stop if testing this snapshot requires production state or an external project.
