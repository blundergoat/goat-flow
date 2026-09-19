/**
 * Describe policy choices shared by the Hooks page, CLI and portable launcher.
 *
 * Missing saved choices retain enabled protection; migration reviews compare explicit before/after choices.
 * A null review permits installation without asking the user to accept a policy ownership change.
 */
export type PolicyHookId = "deny-dangerous" | "deny-git-mutations";
export type PolicyChoices = Partial<Record<PolicyHookId, boolean>>;
export function isPolicyHook(hookId: string): hookId is PolicyHookId;
export function parsePolicyChoices(text: string): PolicyChoices;
export function readPolicyChoices(projectRoot: string): PolicyChoices;
export type EffectivePolicyChoices = Record<PolicyHookId, boolean>;
export interface PolicyOwnershipIdentity {
  path: string;
  originalIdentity: string | null;
  incomingIdentity: string | null;
}
export interface PolicyUpgradeReview {
  original: EffectivePolicyChoices;
  requested: EffectivePolicyChoices;
  paths: string[];
}
export const POLICY_OWNERSHIP_FILES: readonly string[];
/**
 * Resolve the switches shown in an upgrade review using the current runtime defaults.
 *
 * @param choices - saved or prepared choices; missing entries keep protection enabled
 * @returns explicit choices for both switches, including defaults for an empty config
 */
export function effectivePolicyChoices(choices: PolicyChoices): EffectivePolicyChoices;
/**
 * Identify a change in GitHub protection that needs the user's separate policy consent.
 *
 * @param original - saved choices; missing entries mean protection was enabled
 * @param requested - prepared choices; missing entries use enabled defaults
 *
 * @param hasPolicyInstallation - false means a fresh install has no prior ownership to migrate
 * @param files - ownership identities; empty means no files need review, and null identities mean missing files
 *
 * @returns before/after choices and affected paths, or null when no policy decision is pending
 */
export function policyUpgradeReview(original: PolicyChoices, requested: PolicyChoices, hasPolicyInstallation: boolean, files: PolicyOwnershipIdentity[]): PolicyUpgradeReview | null;
/**
 * Check existing hooks before a public installer writes to the selected project.
 *
 * @param projectRoot - selected project whose saved protection choices must survive the upgrade
 * @param bundledHooksRoot - incoming package hooks used to compare ownership
 *
 * @returns required review, or null when installation needs no migration consent
 * @throws when config or ownership files cannot be inspected safely; installation must stop
 */
export function inspectPolicyUpgrade(projectRoot: string, bundledHooksRoot: string): PolicyUpgradeReview | null;
