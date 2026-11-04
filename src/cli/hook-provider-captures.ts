/**
 * Retains reviewed Windows and WSL delivery observations for the 1.19.0 runtime.
 * Use these host-specific records when reviewing capture applicability; registry gates remain separate.
 * Digests preserve capture provenance without publishing transcripts or raw payload values.
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
    "debb178a4e166e46859b05a71a34844ea00f858a1d2cedfca752229a9a8b0e8d",
  "post-turn/recovery.mjs":
    "df7298cbc23252aee95f90889c23fb647329ae30ac55f3adbce114ed73224346",
  "post-turn/scanner.mjs":
    "b5b59fc68ff6a1103b289af960672ac6875912a00a50e30928100a8b1efd084b",
  "process-tree.mjs":
    "2a6beb870594f8b1ab4e6484a22b9e8224a45905731dea1384d1f56076e1870c",
  "run-hook.mjs":
    "c15957f79f7d3580a15d71bf7b613519a5cf1536aa3a972c73ef7a81fda4b668",
  "vendor/graphql.cjs":
    "86a01e3e0b9c9389fa1c6cb735ec4150bde9d27b3c9367b070eb55a0674a9a20",
  "vendor/js-yaml.cjs":
    "d7fdf1c03e3f58cb290e067efb8ced57a72e3c441af014be9bbf379078a5ef07",
};

/** Reviewed observations, including incomplete rows that must not become support claims. */
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
        "The capture ended on its controller timeout after every required record was in the transcript; the user accepted this variance.",
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
        capturedAt: "2026-11-04T00:28:15.832Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "02a66fa1261a4c5e4a0592ca5d3774d3c349a1f44888593701618c7a8bc591f5",
        approvalPacketSha256:
          "f0213001b4058fc3b2c7b3d1462b53791a5e8d169e79d8599fe8a2ad0b5c84d4",
        producer: "claude native session output",
        reviewSha256:
          "564aca3854e030b0c96f11ea6358076b56fc25ae84a4fe67ace47a38939a3e10",
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
        capturedAt: "2026-11-04T02:07:03.414Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "a0f2874e5c4fede162c3202f0a291924065dda23bf42b7a8bbf1869690690c2b",
        approvalPacketSha256:
          "7b5a39ad78198aa6e31e873285a3d3647e5ee05661ffecc0b4400e0e365f754a",
        producer: "claude native session output",
        reviewSha256:
          "6eefba40dca74ec4f01cfd90aead048ebacfd949bd25fe7ae66770826719be9c",
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
        capturedAt: "2026-11-04T02:13:36.256Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "ad056a3432d72ad23db81ed6790fd68eed0fbd3ec05db398b013f4c63d2f3a52",
        approvalPacketSha256:
          "dd09ffe422d645648c79c0fc1791bfdcc5127a35a56da7dbdea36b7e44c6022c",
        producer: "claude native session output",
        reviewSha256:
          "5f90001a905c471b9dca5db36fc41876ca0a3049bf2eedf397fc402849f0299c",
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
        capturedAt: "2026-11-03T22:21:24.663Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "2085612d4b73a1e996e9682835e92c4585bebe44147a9035d53fe87f72c0005c",
        approvalPacketSha256:
          "7320dd13b3aff23046a48f6dcef7c3aed82090a3217e7e7eb9a9e2bf52410724",
        producer: "codex native session output",
        reviewSha256:
          "f33d4c21ad394b8ba4b255a446a80e7b2a81de3f7a4f5fb5771cacba55191d6b",
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
        capturedAt: "2026-11-03T22:22:52.728Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "21a9adf538f221173f1504ecefa45288853ba8d886b2cd84963afda34fdb2ee0",
        approvalPacketSha256:
          "7320dd13b3aff23046a48f6dcef7c3aed82090a3217e7e7eb9a9e2bf52410724",
        producer: "codex native session output",
        reviewSha256:
          "5c6dd2d2485b8cf8be006c105bf582704263bd4c76c819009491c90908d68619",
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
        capturedAt: "2026-11-03T22:22:52.728Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "21a9adf538f221173f1504ecefa45288853ba8d886b2cd84963afda34fdb2ee0",
        approvalPacketSha256:
          "7320dd13b3aff23046a48f6dcef7c3aed82090a3217e7e7eb9a9e2bf52410724",
        producer: "codex native session output",
        reviewSha256:
          "5c6dd2d2485b8cf8be006c105bf582704263bd4c76c819009491c90908d68619",
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
        capturedAt: "2026-11-03T22:52:24.086Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "3dc56bc99af1bde4dbfb837c58363f3a6b0679419dbf17272f5de26b4d91e201",
        approvalPacketSha256:
          "9e54816f72815ce811006135b2dfefa01806d3bd4ecb39ce12774ab8b7664ae0",
        producer: "copilot native session output",
        reviewSha256:
          "e0f415a86c61ff42907d8f6ea70404c9df1314d4caf3e6912bc7cbe5e71eb50e",
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
        capturedAt: "2026-11-03T22:52:59.933Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "cbb03788b5e178dc1180a1ac18ae3c7894ece39056a98f7041cf432bfa38039a",
        approvalPacketSha256:
          "ef6ee1b0a0d20a986602f101af19a3bce2e7c8577e67dcf4c71f11832b3d5c37",
        producer: "copilot native session output",
        reviewSha256:
          "8ce40f849073d031c9bf8ccc0c897ac3470a1e751e886491a6204191f5177121",
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
        capturedAt: "2026-11-04T03:01:53.759Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "55370647ea01c81bdc573956632a36e996ddb5e0cbc6e253adcdc77ed2283986",
        approvalPacketSha256:
          "80836442676b36949c9302e79fcb48ce9e4d2615e0974965f9d66da3d97fecf5",
        producer: "antigravity native session output",
        reviewSha256:
          "716fd2dcc296488a3b73a8b48ec31940e5b18702fe34934b0b59034904ba5466",
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
        capturedAt: "2026-11-03T22:41:42.140Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "f390930a3f3f4b5b6d23284330a47ba5a1429093448a5235eda1489b257e8b42",
        approvalPacketSha256:
          "93ae8f0af93c0a78cf2297cd5aade3b77ae1de356537a59d40f4cb5e93121c0f",
        producer: "claude native session output",
        reviewSha256:
          "4f69354774c8dca634199abdc989020d4b658a224ef93aeefae4c2761d957ba8",
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
        capturedAt: "2026-11-03T22:43:53.152Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "c1b0e42152c2432bb1e921f5d89cec3c75605efeee0be0ba42d5fca54fc12d7d",
        approvalPacketSha256:
          "93ae8f0af93c0a78cf2297cd5aade3b77ae1de356537a59d40f4cb5e93121c0f",
        producer: "claude native session output",
        reviewSha256:
          "cea918217d85e70515c984c3458381cb8b687fc8994f2fcd7b323efb3689a130",
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
        capturedAt: "2026-11-03T22:48:50.044Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "d16cba8aa1625807f313b181dae09c90778e42adcb80b6b709a3e1b18e6a945c",
        approvalPacketSha256:
          "3a331f7fd85c86f00d41a05eacbe35e4494d9a27c8ac0eab244b816cff0e1c9d",
        producer: "claude native session output",
        reviewSha256:
          "111b0df5caa90e9ca4fa044c495796a624387b8b803cd0d54a0169b66423c6e4",
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
        capturedAt: "2026-11-03T21:04:49.485Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "f961fdca44ee10083e4d70ea9182ee6eb242e28fdbcf9412c8c31dc608ada655",
        approvalPacketSha256:
          "953090102ccdee6e47472b9f35a0b1d05073a098ce8fa1af604e2f468de7556c",
        producer: "codex native session output",
        reviewSha256:
          "13fe674cf60c0ba9780b8d55dcad7341d459bc017bc3b1c168f5e725c80aaf09",
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
        capturedAt: "2026-11-03T21:05:27.897Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "1ce5af4d84beb8e540035633afc704935345eb0856df9d4a46190843feb3c575",
        approvalPacketSha256:
          "953090102ccdee6e47472b9f35a0b1d05073a098ce8fa1af604e2f468de7556c",
        producer: "codex native session output",
        reviewSha256:
          "0cc8491639badfc997a78c65e33bac42d165035012b69df6ca09c9406557bba2",
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
        "Tool calls ran through Codex's nested exec tool; direct tool routing is not claimed. Connected tool bindings were visible, but the model used only the two controls and two patches.",
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
        capturedAt: "2026-11-03T21:59:14.466Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "85c0e878be6c573f4e24ba532bd724a731b97a993abd270bfd03e75a7a1b8fdb",
        approvalPacketSha256:
          "29328629e84ceef8c9479928ea2b17a084ccf40869b186864c932638e8f27783",
        producer: "codex native session output",
        reviewSha256:
          "572ba74d8e735ecb87781b8b46cda4d7583fdf6f12fafa38f63088f30fa96805",
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
        "A gpt-4o-mini side call also received the prompt; every assistant message recorded claude-sonnet-5.5.",
        "The package file beside the pinned executable reads 1.0.2; --version, the banner and the session log read 1.0.91, and the cached 1.0.91 package is not pinned.",
        "The controller closed the client after the turn ended; natural provider exit is not claimed.",
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
        capturedAt: "2026-11-03T21:48:05.266Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "d7bc75d7d81886f297f166303f13a94914485545ea8fe962f4f882fc0856f704",
        approvalPacketSha256:
          "1e7dc824f7f978083127c02a9b58d42fda496eceeaf65017eb277865bdd5db29",
        producer: "copilot native session output",
        reviewSha256:
          "28ceee207d53efcbe152ae1d31959add0ceeb6776f5d3c27df59aafdd2e93cd0",
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
        "A gpt-4o-mini side call also received the prompt; every assistant message recorded claude-sonnet-5.5.",
        "The package file beside the pinned executable reads 1.0.2; --version, the banner and the session log read 1.0.91, and the cached 1.0.91 package is not pinned.",
        "The controller closed the client after the turn ended; natural provider exit is not claimed.",
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
        capturedAt: "2026-11-03T21:49:11.316Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "95b271fa3c875296e48bb910f21bd6d1da8af439e62374cd3bccb9e15a23f0c8",
        approvalPacketSha256:
          "1e7dc824f7f978083127c02a9b58d42fda496eceeaf65017eb277865bdd5db29",
        producer: "copilot native session output",
        reviewSha256:
          "c7b751e421c2149d74e086ac85046d709af36bea54e6c06e560fce3182580da1",
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
        "The session ran a private read-only copy of the installed binary, whose hash equals the install's.",
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
        capturedAt: "2026-11-03T21:52:29.035Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "3afbebbedc9719b7b73fcdb85c5bde0809984be4ca9a2a2e7f3a387574369ca5",
        approvalPacketSha256:
          "63151acb029821adfe72b6e692aec6e1148fc42e0ca8a17a78ba95a18fecfa1c",
        producer: "antigravity native session output",
        reviewSha256:
          "01cb977ee627d3838a0a9db1aa5fb1284ff415630bbd15e1d30d47f973c174eb",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
  ];
