/** Verify version skew is classified by direction, so an older CLI never prescribes a downgrade. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareVersions,
  isReleaseVersion,
  projectIsAheadOfCli,
} from "../../src/cli/version-compare.js";

describe("isReleaseVersion", () => {
  it("accepts only three numeric release segments", () => {
    assert.equal(isReleaseVersion("1.15.0"), true);
    assert.equal(isReleaseVersion("999.invalid"), false);
    assert.equal(isReleaseVersion("1.15"), false);
    assert.equal(isReleaseVersion("1.15.0-beta.1"), false);
    assert.equal(isReleaseVersion(" 1.15.0 "), false);
  });
});

describe("compareVersions", () => {
  it("orders releases by numeric segment, not string order", () => {
    assert.equal(compareVersions("1.15.0", "1.14.0"), 1);
    assert.equal(compareVersions("1.14.0", "1.15.0"), -1);
    // Lexicographic comparison would call "1.9.0" newer than "1.10.0".
    assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
    assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  });

  it("reports equality for identical versions", () => {
    assert.equal(compareVersions("1.15.0", "1.15.0"), 0);
  });

  it("rejects malformed and shortened versions", () => {
    assert.throws(() => compareVersions("1.x.0", "1.0.0"), /X\.Y\.Z/u);
    assert.throws(() => compareVersions("1.15", "1.15.0"), /X\.Y\.Z/u);
    assert.throws(() => compareVersions("", "0.0.0"), /X\.Y\.Z/u);
  });
});

describe("projectIsAheadOfCli", () => {
  it("flags the CLI as the stale side when the project is newer", () => {
    // The reported incident: global CLI 1.14.0 auditing a 1.15.0 checkout.
    assert.equal(projectIsAheadOfCli("1.15.0", "1.14.0"), true);
  });

  it("does not flag a matched or older install", () => {
    assert.equal(projectIsAheadOfCli("1.15.0", "1.15.0"), false);
    assert.equal(projectIsAheadOfCli("1.14.0", "1.15.0"), false);
  });

  it("does not classify malformed input as newer", () => {
    assert.equal(projectIsAheadOfCli("999.invalid", "1.15.0"), false);
    assert.equal(projectIsAheadOfCli("1.15.0", "invalid"), false);
  });
});
