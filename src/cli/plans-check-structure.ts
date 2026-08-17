/**
 * Checks that a plan's milestones fit together as a set, not just individually.
 *
 * A milestone can be perfectly written on its own and still be wrong in context: depending on a milestone that does not exist, forming a dependency
 * cycle nothing can start, reusing an id another file already claims, or leaving two milestones active at once.
 *
 * These are the mistakes that cost an author real time, because the plan looks fine until they try to work it and find there is no valid order.
 * Each finding names the milestone file so the author can go straight to the line they need to change.
 */
import type { PlanExportRecord } from "./plans-export.js";

/** States that represent one currently active execution or review boundary. */
const ACTIVE_STATUSES = new Set([
  "in-progress",
  "testing-gate",
  "human-verification-pending",
]);

/** Parsed filename identity used for local dependency validation. */
interface MilestoneIdentity {
  id: string;
  numericId: string;
  record: PlanExportRecord;
  dependencies: string[];
}

/** Extract the exact local milestone ID and its zero-insensitive duplicate key. */
function readMilestoneIdentity(
  record: PlanExportRecord,
): MilestoneIdentity | null {
  const match = record.sourceFile.match(/^m(\d+).*\.md$/iu);
  if (!match?.[1]) return null;
  const id = `M${match[1]}`;
  return {
    id,
    numericId: match[1].replace(/^0+(?=\d)/u, ""),
    record,
    dependencies: [],
  };
}

/** Parse strict dependency metadata while keeping narrative sequencing out of the graph. */
function readDependencies(
  identity: MilestoneIdentity,
  requiresField: boolean,
  errors: string[],
): string[] {
  const rawDependencies = identity.record.dependencies.trim();
  if (rawDependencies.length === 0) {
    if (requiresField) {
      errors.push(
        `${identity.record.sourceFile}: missing dependencies for a multi-milestone plan`,
      );
    }
    return [];
  }
  if (rawDependencies === "none") return [];
  if (!/^M\d+(?:\s*,\s*M\d+)*$/u.test(rawDependencies)) {
    errors.push(
      `${identity.record.sourceFile}: dependencies must be \`none\` or comma-separated local milestone IDs`,
    );
    return [];
  }
  return rawDependencies.split(",").map((dependency) => dependency.trim());
}

/** Find one cycle in a fully local dependency graph. */
function findDependencyCycle(
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): string[] | null {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  /** Walk one dependency chain and return its first cycle, if one is reachable. */
  function visit(id: string): string[] | null {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      return [...path.slice(cycleStart), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    const identity = identitiesById.get(id);
    for (const dependency of identity?.dependencies ?? []) {
      if (!identitiesById.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const id of identitiesById.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/** Canonical lookup tables used to reconcile milestone IDs and numeric aliases. */
interface MilestoneIndexes {
  byId: Map<string, MilestoneIdentity>;
  byNumber: Map<string, MilestoneIdentity>;
}

/** Read either supported title prefix into the canonical local ID shape. */
function readTitleMilestoneId(title: string): string | undefined {
  const compactTitleNumber = title.match(/^M(\d+)\b/iu)?.[1];
  if (compactTitleNumber !== undefined) return `M${compactTitleNumber}`;
  const longTitleNumber = title.match(/^Milestone\s+(\d+)\b/iu)?.[1];
  return longTitleNumber === undefined ? undefined : `M${longTitleNumber}`;
}

/** Report filename and title drift for one local milestone identity. */
function collectMilestoneIdentityErrors(
  identity: MilestoneIdentity,
  requiresTitleId: boolean,
  errors: string[],
): void {
  if (!/^M\d.*\.md$/u.test(identity.record.sourceFile)) {
    errors.push(
      `${identity.record.sourceFile}: milestone filename must begin with an uppercase M and digits`,
    );
  }
  const titleId = readTitleMilestoneId(identity.record.title);
  if (!titleId && requiresTitleId) {
    errors.push(
      `${identity.record.sourceFile}: multi-milestone title must begin with its milestone ID`,
    );
  }
  if (titleId && titleId !== identity.id) {
    errors.push(
      `${identity.record.sourceFile}: title ID ${titleId} does not match filename ID ${identity.id}`,
    );
  }
}

/** Insert one numeric identity while reporting zero-padding aliases. */
function indexMilestoneNumber(
  identity: MilestoneIdentity,
  identitiesByNumber: Map<string, MilestoneIdentity>,
  errors: string[],
): void {
  const duplicate = identitiesByNumber.get(identity.numericId);
  if (duplicate) {
    errors.push(
      `${identity.record.sourceFile}: duplicate milestone ID ${identity.id} conflicts with ${duplicate.id}`,
    );
    return;
  }
  identitiesByNumber.set(identity.numericId, identity);
}

/** Index local IDs while reporting duplicate numeric identities and title drift. */
function indexMilestones(
  identities: MilestoneIdentity[],
  requiresTitleId: boolean,
  errors: string[],
): MilestoneIndexes {
  const identitiesById = new Map<string, MilestoneIdentity>();
  const identitiesByNumber = new Map<string, MilestoneIdentity>();

  for (const identity of identities) {
    collectMilestoneIdentityErrors(identity, requiresTitleId, errors);
    indexMilestoneNumber(identity, identitiesByNumber, errors);
    identitiesById.set(identity.id, identity);
  }
  return { byId: identitiesById, byNumber: identitiesByNumber };
}

/** Parse dependency fields and report unresolved or self-referential edges. */
function collectDependencyReferenceErrors(
  identities: MilestoneIdentity[],
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
  requiresDependencies: boolean,
  errors: string[],
): void {
  for (const identity of identities) {
    identity.dependencies = readDependencies(
      identity,
      requiresDependencies,
      errors,
    );
    for (const dependency of identity.dependencies) {
      if (dependency === identity.id) {
        errors.push(
          `${identity.record.sourceFile}: milestone cannot depend on itself`,
        );
      } else if (!identitiesById.has(dependency)) {
        errors.push(
          `${identity.record.sourceFile}: dependency ${dependency} does not resolve in this plan`,
        );
      }
    }
  }
}

/** Report active or complete milestones whose declared prerequisites remain open. */
function collectDependencyStateErrors(
  identities: MilestoneIdentity[],
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): string[] {
  const errors: string[] = [];
  for (const identity of identities) {
    const status = identity.record.status.trim().toLowerCase();
    if (!ACTIVE_STATUSES.has(status) && status !== "complete") continue;
    for (const dependency of identity.dependencies) {
      const dependencyRecord = identitiesById.get(dependency)?.record;
      if (
        dependencyRecord &&
        dependencyRecord.status.trim().toLowerCase() !== "complete"
      ) {
        errors.push(
          `${identity.record.sourceFile}: active or complete milestone requires dependency ${dependency} to be complete`,
        );
      }
    }
  }
  return errors;
}

/** Enforce one active execution or verification boundary per plan. */
function collectActiveStateErrors(identities: MilestoneIdentity[]): string[] {
  const activeMilestones = identities.filter((identity) =>
    ACTIVE_STATUSES.has(identity.record.status.trim().toLowerCase()),
  );
  if (activeMilestones.length > 1) {
    return [
      `plan: multiple active milestones: ${activeMilestones.map((identity) => identity.id).join(", ")}`,
    ];
  }
  return [];
}

/**
 * Check that a plan's milestones form a workable set, not just valid files.
 * Use in strict mode after each milestone passes on its own, so the author learns about duplicate ids, missing or circular dependencies, and two
 * milestones being active at once.
 *
 * @param records - every milestone parsed from the plan directory; an empty list means there
 *   is no plan to cross-check and nothing is reported
 * @returns one error line per structural problem, each naming its milestone file; empty means
 *   the milestones fit together and the author has a workable order
 */
export function collectPlanStructureErrors(
  records: PlanExportRecord[],
): string[] {
  const errors: string[] = [];
  const identities = records
    .map(readMilestoneIdentity)
    .filter((identity): identity is MilestoneIdentity => identity !== null);
  const indexes = indexMilestones(identities, records.length > 1, errors);
  collectDependencyReferenceErrors(
    identities,
    indexes.byId,
    records.length > 1,
    errors,
  );
  const cycle = findDependencyCycle(indexes.byId);
  if (cycle) {
    errors.push(`plan: dependency cycle detected: ${cycle.join(" -> ")}`);
  }
  errors.push(...collectDependencyStateErrors(identities, indexes.byId));
  errors.push(...collectActiveStateErrors(identities));
  return errors;
}
