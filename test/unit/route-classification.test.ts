/**
 * Route classification consistency test (M31).
 *
 * Every POST/DELETE entry in DASHBOARD_ROUTE_INVENTORY whose class is
 * "side-effectful" must also appear in SIDE_EFFECTFUL_EXACT_API_ROUTES. This
 * catches drift where a new mutating route is added to the inventory but the
 * Origin/CSRF check never fires because the exact-match set was not updated.
 *
 * Routes marked "privileged-websocket" or with parameter segments (`:id`) are
 * intentionally exempt — they have their own enforcement paths.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  DASHBOARD_ROUTE_INVENTORY,
  SIDE_EFFECTFUL_EXACT_API_ROUTES,
} from "../../src/cli/server/dashboard.js";

describe("dashboard route classification", () => {
  it("registers every side-effectful POST/DELETE in the exact-match set", () => {
    const missing: string[] = [];
    for (const entry of DASHBOARD_ROUTE_INVENTORY) {
      if (entry.class !== "side-effectful") continue;
      if (entry.path.includes(":")) continue; // param routes have regex matching
      const key = `${entry.method} ${entry.path}`;
      if (!SIDE_EFFECTFUL_EXACT_API_ROUTES.has(key)) {
        missing.push(key);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `These routes are class:"side-effectful" but missing from SIDE_EFFECTFUL_EXACT_API_ROUTES: ${missing.join(", ")}`,
    );
  });

  it("only lists keys whose route exists in the inventory", () => {
    const inventoryKeys = new Set(
      DASHBOARD_ROUTE_INVENTORY.filter((e) => !e.path.includes(":")).map(
        (e) => `${e.method} ${e.path}`,
      ),
    );
    const orphans: string[] = [];
    for (const key of SIDE_EFFECTFUL_EXACT_API_ROUTES) {
      if (!inventoryKeys.has(key)) orphans.push(key);
    }
    assert.deepEqual(
      orphans,
      [],
      `These keys are in SIDE_EFFECTFUL_EXACT_API_ROUTES but not in DASHBOARD_ROUTE_INVENTORY: ${orphans.join(", ")}`,
    );
  });

  it("uses upper-case HTTP methods in inventory entries", () => {
    for (const entry of DASHBOARD_ROUTE_INVENTORY) {
      assert.equal(
        entry.method,
        entry.method.toUpperCase(),
        `${entry.method} ${entry.path} uses non-uppercase method`,
      );
    }
  });
});
