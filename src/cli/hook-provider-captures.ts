/**
 * Reviewed Windows and WSL observations of each provider delivering hook results to the model, for the 1.19.0 runtime.
 *
 * The hooks registry attaches each row to its provider's evidence; support gates are still decided separately.
 * Digests point back to the reviewed receipts without publishing transcripts or raw payload values.
 */
import type { HookProviderHostEvidence } from "./hook-contracts.js";

/**
 * SHA256 of the runtime files behind every verified row below, keyed by path relative to workflow/hooks.
 *
 * Changing one of these files invalidates the captures, so recapture the rows instead of editing a value here.
 * A row captured on different bytes needs its own constant.
 */
const VERIFIED_RUNTIME_SHA256: Readonly<Record<string, string>> = {
  "antigravity-hook-bootstrap.cjs":
    "0e21ac9851c8b3ae0e6230ae2945415655333b9cde1644777dfd97c64084edb1",
  "deny-dangerous.mjs":
    "b9850695cfb2452819cc7297187b40672626c70af1021f32ab1c2f4933906300",
  "deny-dangerous/corpus.json":
    "df94a44ef1e348ccbc7e075acc938b97fec14241dcb074e555c932d69a440f8b",
  "deny-dangerous/git-command.mjs":
    "37716efd4c5e3da806862d195bfb581b989f664351fbe91aa244f27839c2bbaf",
  "deny-dangerous/github-command.mjs":
    "9eb3c60c1080d05284f700e6c5096b92a73d07ce6daf8c9b901ed9e76b6df12c",
  "deny-dangerous/patterns-paths.mjs":
    "62b186f72be1670534f3c7ed5573bf380ce68aa046a40adb8dcb10926fb99d70",
  "deny-dangerous/patterns-shell.mjs":
    "5a804affd0823bb8dfed986831e9283f46323bece0f66675a8e409a8b8127a56",
  "deny-dangerous/patterns-writes.mjs":
    "a934238c065dc558377b9ca429393fd1908cc3ec1336a8746cfbd62bb75c19c4",
  "deny-git-mutations.mjs":
    "806524a09fd0dd8ac63526b64ac7f469f129226a56f7a807f038736aa399bc04",
  "gh-graphql-read.cjs":
    "b0d4e01b1b13fba8a66c11fe5f0f13f996fec26deb7404efc7cd75337e5d13e6",
  "gruff-code-quality.mjs":
    "5956911b7d37ecc6def477011013760337c385df52d5f2481e2ae3e69119affe",
  "gruff/analyzer.mjs":
    "e936203fd20070779f5465435da2c8165e8bbaec7f80c404b276db0c62363af3",
  "gruff/feedback.mjs":
    "22017c552c66f9b548f6c170ff480af1e1df91ee6157fbbefd86dbee0e5aa6ec",
  "gruff/ranges.mjs":
    "8a8b88b9ebf9648886293513aefb6a0a27d90042ae42d88f2cb62e3cbe4c5355",
  "gruff/scope.mjs":
    "c5664c9db200f24d15dfff68b6ac7975ee0abf46367f7ce413dd5905605f88cd",
  "hook-launch-runtime.mjs":
    "da6d030dbfa13339759be909dab85b19eca8cc08da5ecd4065c66fe22f475666",
  "hook-launch.mjs":
    "4d5c1194e26402dec5958bfbea30b1c9bdf316d60af524561ee5625e00f0c2eb",
  "hook-output.mjs":
    "8fc7b94c560aab8c31222d1082374ad7b90a3477df955ec284e8916f95d72e63",
  "hook-policy-state.cjs":
    "e2cc779a13fead674083a4bcc9267d842d24f16aafcaceeddb0f2a88e2fcfc95",
  "hook-provider-adapters.mjs":
    "bad6c9a600f361cbe770e2fb6ea8b08a661a40b721a0b9d140c87ea62b5a81fb",
  "hook-supervisor.mjs":
    "9ece8d082ecc4f53540b6da919ef97a973649f3718e038996c1c46f40ed46bb2",
  "policy-corpus.mjs":
    "fedb14ab9f49f3ed526ed30ea80bf975e42a192043bdd977a47061b749a89fcd",
  "policy-evaluation.mjs":
    "a029818837765ccf1726206704986578f622e32fc99415cade5bb14d487750cc",
  "policy-git.mjs":
    "ae540d211f7309872dd20029c4f38dfc9f1774e4caeaf5ffe26334b54e1f422a",
  "policy-heredoc.mjs":
    "eeeddba44fc8cb1ce4e80619b03c7673e04f3422cbfa012ee531956efbf699d8",
  "policy-input.mjs":
    "533ff04a4660522c7781191fd4f7bd16a60631692ef8c971ff5426410ff00aee",
  "policy-prefixes.mjs":
    "31a464e0966601b21ec6638ae94968f60689b277d2207827eb922b8920ea5a21",
  "policy-segments.mjs":
    "b0408915ae823f061e65528ae2b8303c9bb1e72de054ab9e476ee52f97e4a580",
  "policy-substitutions.mjs":
    "373d4493db934621a91f6af73a5000b99eaa92990753f4d78db5742665e48b98",
  "policy-syntax.mjs":
    "e46c54a7881faa8d18721ec563cc81201f9773885ae6de2b3a2cd76b1d77541d",
  "policy-words.mjs":
    "51ecbfd923c722eb51b572fd818f2c55ae01ea6308d67f461a16481912bf8989",
  "post-turn-safety.mjs":
    "19698f19e87dafb450f0e034c468387a19b2b24ddabe17899a86fa167d4821f5",
  "post-turn/assignments.mjs":
    "d2ecb9410d52a3b50bbe9136f6c98373f34321eada4f4cc7c54a69816c3b64bd",
  "post-turn/context.mjs":
    "79b645ed2ead8f821fc0d9f07bfbc2c4af0ec09180c150cea8715addbcf97667",
  "post-turn/controller.mjs":
    "7a8ce839ee128c602d13bb905a4accaa0693049dbe12a316c1bf062dec1e5e3a",
  "post-turn/recovery.mjs":
    "2c5e0481ecf737b9be6e75ae851cd254be9aa13cad9e3009af6b3b8070888968",
  "post-turn/scanner.mjs":
    "b6d0b002732d25baccbba0bb48abeb4da2aeafecb5cbf42dfdfc6d71a628c013",
  "process-tree.mjs":
    "2a6beb870594f8b1ab4e6484a22b9e8224a45905731dea1384d1f56076e1870c",
  "run-hook.mjs":
    "c15957f79f7d3580a15d71bf7b613519a5cf1536aa3a972c73ef7a81fda4b668",
  "vendor/graphql.cjs":
    "86a01e3e0b9c9389fa1c6cb735ec4150bde9d27b3c9367b070eb55a0674a9a20",
  "vendor/js-yaml.cjs":
    "d7fdf1c03e3f58cb290e067efb8ced57a72e3c441af014be9bbf379078a5ef07",
};

/** Reviewed host observations; a row marked incomplete or security-hold must never become a support claim. */
export const HOOK_PROVIDER_HOST_EVIDENCE: readonly HookProviderHostEvidence[] =
  [
    {
      caseId: "C1",
      host: "windows",
      provider: "claude",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The operator closed the client after the completed turn; natural provider exit is not claimed.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.317",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T08:40:46.924Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "7c358388184b75cc084fb866ac1b1987a80ba29ef00d14b1c3937bc1aad008e5",
        approvalPacketSha256:
          "ff48b6553e9475ea91caee124de57d2cf3caa60c74d7b5ce6f79a59d1fbce903",
        producer: "claude native session output",
        reviewSha256:
          "28b1d2487592eb935c6a7cbc48f6d6b6b83ce43b60aeb4316b0c0fcdb6d5d439",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C2",
      host: "windows",
      provider: "claude",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "verified",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "The capture ended on its controller timeout 0.473 seconds after the deadline, about 25 seconds after the final answer and clean Stop; the user accepted this variance.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.317",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T08:47:45.212Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "d67fbf4d470a0d4e2e64171604011e27b0e056ab1036136e0d2acbb0b50c18d7",
        approvalPacketSha256:
          "0fe7398f5e3be02ed331a1e85cc88fde71e9832975102a2ef2b6c498ccf7132a",
        producer: "claude native session output",
        reviewSha256:
          "28b1d2487592eb935c6a7cbc48f6d6b6b83ce43b60aeb4316b0c0fcdb6d5d439",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C3",
      host: "windows",
      provider: "claude",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "verified",
      summary:
        "Stop blocked a conflict marker, the model repaired it, and clean Stop completed.",
      limitations: [
        "The operator closed the client after the completed turn; natural provider exit is not claimed.",
        "Claude Code 2.1.317 recorded the Stop block in the stop summary's hook errors rather than a separate stop-feedback record.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.317",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T19:24:39.459Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "7f75f1bb1bcbd5e0889f79c9252a51f7bc9fb0598bb6b534e0bb19d387289fa8",
        approvalPacketSha256:
          "9000a3424f00d167828ebbb3b83821be3bd8d475fb2fe0b0e0dadb44cff92df1",
        producer: "claude native session output",
        reviewSha256:
          "adc1058139ce4f9fd232b71a7dea6b1fd13c2199b93cafd6990b1ae07f7b7abb",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C4",
      host: "windows",
      provider: "codex",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The JSON event stream carried no hook event; delivery was read from the bound session record and native stderr.",
        "Codex recorded its approval policy as never although launched with --ask-for-approval on-request; no approval was needed.",
        "Tool calls ran through Codex's nested exec tool; direct tool routing is not claimed.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.166.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T19:34:34.982Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "3ac8b309996cd9b0d91341551b57bc9bfbeb316b95a036de4e54a9545dc33d8b",
        approvalPacketSha256:
          "b46e35b3f7f56db3165892fa90ad8a6a968f91d574deff0bd5dac90292570745",
        producer: "codex native session output",
        reviewSha256:
          "6190e6bce7f4d7b178d44990867443772dfb3cf7b69de0c3ed2b1f77433e1a98",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C5",
      host: "windows",
      provider: "codex",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "verified",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "The JSON event stream carried no hook event; delivery was read from the bound session record.",
        "Codex recorded its approval policy as never although launched with --ask-for-approval on-request; no approval was needed.",
        "Tool calls ran through Codex's nested exec tool; direct tool routing is not claimed.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.166.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T19:36:07.224Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "c2386d5345049ffb57468b9a89af6bd16d079323d9e0ceb01aa9a95df4755fa5",
        approvalPacketSha256:
          "b46e35b3f7f56db3165892fa90ad8a6a968f91d574deff0bd5dac90292570745",
        producer: "codex native session output",
        reviewSha256:
          "6190e6bce7f4d7b178d44990867443772dfb3cf7b69de0c3ed2b1f77433e1a98",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C6",
      host: "windows",
      provider: "codex",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "verified",
      summary:
        "Stop blocked a conflict marker, the model repaired it, and the turn then completed.",
      limitations: [
        "Codex recorded no separate clean Stop message after the repair; a clean scan is inferred from the completed turn and matching final files.",
        "The JSON event stream carried no hook event; delivery was read from the bound session record.",
        "Readiness reported on-request, but codex exec recorded approval_policy=never; no escalation was requested.",
        "Tool calls ran through Codex's nested exec tool; direct tool routing is not claimed. The model used only the three controls and three patches.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.166.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T19:36:07.224Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "c2386d5345049ffb57468b9a89af6bd16d079323d9e0ceb01aa9a95df4755fa5",
        approvalPacketSha256:
          "b46e35b3f7f56db3165892fa90ad8a6a968f91d574deff0bd5dac90292570745",
        producer: "codex native session output",
        reviewSha256:
          "6190e6bce7f4d7b178d44990867443772dfb3cf7b69de0c3ed2b1f77433e1a98",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C7",
      host: "windows",
      provider: "copilot",
      canonicalEvent: "pre-tool",
      providerEventName: "preToolUse",
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "1.0.103",
        providerMode:
          "prompt mode (-p), JSON output, low reasoning, allow-all-tools within available-tools",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T20:10:33.087Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "1b0a29c8379eb14d26eba89d15e294bb52147225309690c87ee86934efbb4ba6",
        approvalPacketSha256:
          "741a976f88cd8891c0af352f8f03ef161264b52aad0272f42c9b1a3f5897b733",
        producer: "copilot native session output",
        reviewSha256:
          "4858a7e7bddcf10c517040b027f93d8260cdad85282bba7ba917facb5ab3ec6e",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C8",
      host: "windows",
      provider: "copilot",
      canonicalEvent: "post-tool",
      providerEventName: "postToolUse",
      verification: "verified",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "1.0.103",
        providerMode:
          "prompt mode (-p), JSON output, low reasoning, allow-all-tools within available-tools",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T20:14:22.587Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "506b822c1c25dddf867f42af4bc7e2d2ab31eaa71bff1a10695b8bbc418f507a",
        approvalPacketSha256:
          "959e47b7d014301703b39f631a176ea3df02928de7c6f16bd96d19305fc9fb66",
        producer: "copilot native session output",
        reviewSha256:
          "4858a7e7bddcf10c517040b027f93d8260cdad85282bba7ba917facb5ab3ec6e",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C9",
      host: "windows",
      provider: "antigravity",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The session ran a private read-only copy of Antigravity 1.4.8; the quarantined helper was not used.",
        "The packet prohibited Defender changes; saved detection counts remained at three. The separate helper's quarantine cause remains unexplained.",
        "Hook decisions name no owner; policy attribution rests on the pinned code, the rehearsal and exact matches on the reason text.",
        "Allowed calls record one more allow than there are matching handlers; what writes it is not established.",
        "The record names no approval channel, so approvals are attributed to the operator by timing; the session's log reports remote control off.",
        "Actual model identity is limited to the native display and an unmapped but consistent enum.",
        "The controller closed the client after the turn ended; natural provider exit is not claimed.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "1.4.8",
        providerMode:
          "interactive CLI, request-review tool permission, default agent mode, low effort, run from a private read-only copy",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".agents/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T20:43:06.660Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "2651de194841c4e94bf95d47084dbe5e20e8821ca2cee58fc56705ad7881ba93",
        approvalPacketSha256:
          "0e825751cff3ee731f261adfefdd81a149db857635028cb56e472c120e40c2ab",
        producer: "antigravity native session output",
        reviewSha256:
          "eec2550d038c300ff287fd8e02db7ff75cc74d9b8dd54389e767b3194973ccc9",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C10",
      host: "wsl",
      provider: "claude",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "A Remote Control bridge was active; tool approvals are attributed to the operator by timing, because the record names no channel.",
        "The controller closed the client after the turn ended; natural provider exit is not claimed.",
        "Claude Code 2.1.317 hook records name no script; policy attribution rests on the pinned code, the rehearsal and exact matches on the reason text.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.317",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T20:56:06.087Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "68f8420fe9099770ad5787f8c287e0fcefe5f6f5478405c100f50742e01d3352",
        approvalPacketSha256:
          "3a4b22198f64b217bb8d87a811441eaf7c968238410df2f2d447d2e2be31db0f",
        producer: "claude native session output",
        reviewSha256:
          "279ccf8622e273544841fa15f0d849f639468b48dabebe43aa072265429d9eaa",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C11",
      host: "wsl",
      provider: "claude",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "verified",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "A Remote Control bridge was active; tool approvals are attributed to the operator by timing, because the record names no channel.",
        "The controller closed the client after the turn ended; natural provider exit is not claimed.",
        "Claude Code 2.1.317 hook records name no script; attribution rests on the hook's own output and its session-named health marker.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.317",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T20:58:34.257Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "030e744056b1fac8f57ded8854d50a1a4eb2f5d48ca4154cf623d6a9c18d1a70",
        approvalPacketSha256:
          "3a4b22198f64b217bb8d87a811441eaf7c968238410df2f2d447d2e2be31db0f",
        producer: "claude native session output",
        reviewSha256:
          "279ccf8622e273544841fa15f0d849f639468b48dabebe43aa072265429d9eaa",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C12",
      host: "wsl",
      provider: "claude",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "verified",
      summary:
        "Stop blocked a conflict marker, the model repaired it, and clean Stop completed.",
      limitations: [
        "The operator closed the client after the completed turn; natural provider exit is not claimed.",
        "Claude Code 2.1.317 recorded the Stop block in the stop summary's hook errors rather than a separate stop-feedback record.",
        "A Remote Control bridge was active; tool approvals are attributed to the operator by timing, because the record names no channel.",
        "Claude Code 2.1.317 hook records name no script; attribution rests on the single registered Stop hook and the reason text.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.317",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T21:06:29.573Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "50fa89641e40c7e983c17d5b220375b628565b725c14ae6ec60177a127631fcd",
        approvalPacketSha256:
          "e94696410f25d488ea0ff2b36973a7ac57a99eea30b0565e9e811c176b4d6a75",
        producer: "claude native session output",
        reviewSha256:
          "279ccf8622e273544841fa15f0d849f639468b48dabebe43aa072265429d9eaa",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C13",
      host: "wsl",
      provider: "codex",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The JSON event stream carried no hook event; delivery was read from the bound session record and native stderr.",
        "Codex recorded its approval policy as never although launched with --ask-for-approval on-request; no approval was needed.",
        "Tool calls ran through Codex's nested exec tool; direct tool routing is not claimed.",
        "The JSONL does not expose actual model identity.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.166.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, read-only goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T21:54:30.664Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "0adb4cd31511e45b2f0fc0be69ee09e489cf5d48d0ed938a0d3b402d18a98b4b",
        approvalPacketSha256:
          "60dc4d19ecefc3b71c69a988808789dc68bfae3b2b03886e24e1d3e90844e52f",
        producer: "codex native session output",
        reviewSha256:
          "cf3c22700381bd7d3a2d31967a7db7974a6c2901aa057cf2508756fc6031f4d2",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C14",
      host: "wsl",
      provider: "codex",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "verified",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "The JSON event stream carried no hook event; delivery was read from the bound session record.",
        "Codex recorded its approval policy as never although launched with --ask-for-approval on-request; no approval was needed.",
        "Tool calls ran through Codex's nested exec tool; direct tool routing is not claimed.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.166.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T21:55:24.983Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "cb55f56bddbeebf54276e15bbab84fa30295eea2d1a7bffa0b06cec9eff6650f",
        approvalPacketSha256:
          "60dc4d19ecefc3b71c69a988808789dc68bfae3b2b03886e24e1d3e90844e52f",
        producer: "codex native session output",
        reviewSha256:
          "cf3c22700381bd7d3a2d31967a7db7974a6c2901aa057cf2508756fc6031f4d2",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C15",
      host: "wsl",
      provider: "codex",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "verified",
      summary:
        "Stop blocked a conflict marker, the model repaired it, and the turn then completed.",
      limitations: [
        "Codex recorded no separate clean Stop message after the repair; a clean scan is inferred from the completed turn and matching final files.",
        "The JSON event stream carried no hook event; delivery was read from the bound session record.",
        "Readiness reported on-request, but codex exec recorded approval_policy=never; no escalation was requested.",
        "Tool calls ran through Codex's nested exec tool; direct tool routing is not claimed. The model used only the two controls and two patches.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.166.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-05T22:08:59.404Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "10ac43cf600bdbd6827dff610009dd80c931cb75e4e5977bc4570527926f1aef",
        approvalPacketSha256:
          "3c89890aaa761f96d503a14888650c5ed7e59c4fadd0c5a096943cc26747442a",
        producer: "codex native session output",
        reviewSha256:
          "cf3c22700381bd7d3a2d31967a7db7974a6c2901aa057cf2508756fc6031f4d2",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C16",
      host: "wsl",
      provider: "copilot",
      canonicalEvent: "pre-tool",
      providerEventName: "preToolUse",
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "Hook records name no owner; policy attribution rests on the pinned code, the rehearsal and exact matches on the reason text.",
        "One zero-priced gpt-4o-mini call generated the session title; every agent turn recorded claude-sonnet-5.5.",
        "The package file beside the pinned executable reads 1.0.2; --version, the banner and the session log read 1.0.91, and the cached 1.0.91 package is not pinned.",
        "The controller closed the client after the turn ended; natural provider exit is not claimed.",
        "The model was also offered extensions_reload and extensions_manage; it called neither.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "1.0.91",
        providerMode:
          "interactive CLI, manual approval mode, low reasoning, available-tools limited to bash and view",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-08T03:14:46.801Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "9fc416eec895064d267ac3e1c66c02386cec341be100aa1473c6712986aeb141",
        approvalPacketSha256:
          "3863488f8066d9e192ba2c8b53e119f0da992aa55b3a12735ca7c27ba6bb81f1",
        producer: "copilot native session output",
        reviewSha256:
          "6fbbdce39418e0b8817be3659a4b1d342bbb066c9ef1ce98fedc31a48a0d5456",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C17",
      host: "wsl",
      provider: "copilot",
      canonicalEvent: "post-tool",
      providerEventName: "postToolUse",
      verification: "verified",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "One zero-priced gpt-4o-mini call generated the session title; every agent turn recorded claude-sonnet-5.5.",
        "The package file beside the pinned executable reads 1.0.2; --version, the banner and the session log read 1.0.91, and the cached 1.0.91 package is not pinned.",
        "The controller closed the client after the turn ended; natural provider exit is not claimed.",
        "The model was also offered extensions_reload and extensions_manage; it called neither.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "1.0.91",
        providerMode:
          "interactive CLI, manual approval mode, low reasoning, available-tools limited to edit and view",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-08T03:17:19.221Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "145f546eadf6ce3b35b5ad5e26e48709a7cca8906829aa2811938683dccec489",
        approvalPacketSha256:
          "3863488f8066d9e192ba2c8b53e119f0da992aa55b3a12735ca7c27ba6bb81f1",
        producer: "copilot native session output",
        reviewSha256:
          "6fbbdce39418e0b8817be3659a4b1d342bbb066c9ef1ce98fedc31a48a0d5456",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
    {
      caseId: "C18",
      host: "wsl",
      provider: "antigravity",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "verified",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The session ran an isolated copy restored from the approved archived 1.4.12 binary, not the current global install; readiness confirmed the version natively.",
        "Hook decisions name no owner; policy attribution rests on the pinned code, the rehearsal and exact matches on the reason text.",
        "Allowed calls record one more allow than there are matching handlers; what writes it is not established.",
        "The final response quotes the GitHub reason without its Policy repository label; the full reason is in the error text.",
        "The record names no approval channel, so approvals are attributed to the operator by timing; the session's log reports remote control off.",
        "Actual model identity is limited to the native display and an unmapped but consistent enum.",
        "The controller closed the client after the turn ended; natural provider exit is not claimed.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "1.4.12",
        providerMode:
          "interactive CLI, request-review tool permission, default agent mode, low effort, run from a private read-only copy",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".agents/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-08T03:36:22.676Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "258c15999aa90c371a714a3752ae8df128cdfe205ed6c44474e671f1433da943",
        approvalPacketSha256:
          "59c5f57a7845f1cea6cfbe7fade8bc0e07d22534908f64e80692ebbdc59b31c0",
        producer: "antigravity native session output",
        reviewSha256:
          "c344cfd0809683051519b99290d214c706f85eec16ca7c25c7f17a944ef64d9f",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
  ];
