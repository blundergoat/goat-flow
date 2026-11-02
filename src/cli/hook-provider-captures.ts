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
    "e197098ca2aae37b09bd2de5de8891b024af98a4896124b6fffc3ec2235374e6",
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
    "6f61e64607c08e5bf83c6fc63d2d4895920b528c2f81ca3622c4d76433f62ec2",
  "post-turn/controller.mjs":
    "d799e5277ad07ad50677a1ae9980c639bce728a4c8c87a3b2e563cf76296258a",
  "post-turn/recovery.mjs":
    "27eb1b162f6a34731e6ab489df8367a882e7f39889e05938b39154f73ab642a0",
  "post-turn/scanner.mjs":
    "95267f043bde4888508b25666801c4a5914a8e91f1510f1b908a1b563b0143d5",
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
        providerVersion: "2.1.312",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T09:33:20.193Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "635a71f979047dbdb67e9072d47f720e565b136fa00aefc592ef2c52c4e9f19c",
        approvalPacketSha256:
          "ebd2b5874ea044795a2c16930a745cb9dd4937337bad78fba5c6c060ab77de55",
        producer: "claude native session output",
        reviewSha256:
          "eb6ec6f1e2276b29f42f017c3021598f34db1c96388ece99edf2b77715efe2b5",
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
        providerVersion: "2.1.312",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T09:38:02.316Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "189c8148ecb7f2d020a48df9dcf8127f54005afb521107d9fe1d6349e3830cab",
        approvalPacketSha256:
          "ebd2b5874ea044795a2c16930a745cb9dd4937337bad78fba5c6c060ab77de55",
        producer: "claude native session output",
        reviewSha256:
          "c69b2fcd525c7c8775fb1bd8e7840b94994f7a3982f292ed37617a018421a8ed",
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
        "Claude Code 2.1.316 recorded the Stop block in the stop summary's hook errors rather than a separate stop-feedback record.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.316",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-01T23:44:35.209Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "09713221d2651c058dacd7f2f0096c83c560bafe91a9fa0bcf27ccf457222444",
        approvalPacketSha256:
          "f7deaa788f3885cc9244dc27901b153d90b55ec4f1e625bc8e528e291bd27252",
        producer: "claude native session output",
        reviewSha256:
          "28023c13b25ac38015de691a6fb15d9953209607277311800547898aeec384f1",
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
        providerVersion: "0.164.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T23:34:09.213Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "f5e067f71d6e21eb58ce2db5af737735409545be7cc47ada7193f328398fc425",
        approvalPacketSha256:
          "6c3a1fc94707b68af7ff42469b4a00974ab02a85c44651958af9ac0f6f3f59b2",
        producer: "codex native session output",
        reviewSha256:
          "5096f7110530a1e3587fff3864dbae1b2dffa21898bf1a0b8a61b64810e641b3",
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
        providerVersion: "0.164.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-10-29T23:47:19.119Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "c0d7f97e2ab1485ca74354117f08f26da4cc6ce3f18bff73f33958d278302341",
        approvalPacketSha256:
          "6c3a1fc94707b68af7ff42469b4a00974ab02a85c44651958af9ac0f6f3f59b2",
        producer: "codex native session output",
        reviewSha256:
          "93b6361bde2235e5878cb47453dd65879d84481fce26a47ea48a125c20fe00c8",
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
        capturedAt: "2026-11-02T00:02:16.995Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "a913304e1fe422ba13299e364fa21f93daf4185486d88910a32c923f80582a86",
        approvalPacketSha256:
          "177ee7ba8a7eee4bc37fb709039ad1686bf7774b842bea0d3a230e89b0264632",
        producer: "codex native session output",
        reviewSha256:
          "f6d98edee50e6bb064a94d43a25186f7ce70c18260ac5d0676d695c9a03ec7e0",
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
        capturedAt: "2026-10-29T07:37:33.254Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "39678554b7b163573c4107bc92ec14aa62cab1f3b2022a2f4a41aa6eae4eaca7",
        approvalPacketSha256:
          "907d2687eebebef296b87d8e3e747fdc375755a76510862148a623a5e9f3af60",
        producer: "copilot native session output",
        reviewSha256:
          "0cb7088b11ef1b53ada6db634cbef82777f7693f93b9217de35a3bb1bc00c5e6",
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
        capturedAt: "2026-10-29T07:38:38.730Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "2398efdd9d83c8d9e3e1446ac61b4eb95f26fa27fde3fd733b1cd4a8dd5dc3c0",
        approvalPacketSha256:
          "3b7997f9a531e7b935ebea1cf378c063a51f0507c6211feaa1bcbd63e1ee2e02",
        producer: "copilot native session output",
        reviewSha256:
          "4cdd5e06a830dc26813f8c9b77dd531bd64bd1eed2eb24a7e9ca5db43ce05ea9",
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
        capturedAt: "2026-11-01T22:50:08.273Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "22dd8dd4bcbcf438446b6b75a8b87c18be801912f59e19695164ddbf36d2b688",
        approvalPacketSha256:
          "8ee6fa9d7d875b695123e4ab06a6eac3a151432ada008d3fc44f7855b76adebc",
        producer: "antigravity native session output",
        reviewSha256:
          "c1825f735b78b68d34f41772c0a79cdd3eba2d22cddd1162d43c747437e8aa00",
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
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.314",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-10-30T21:58:51.468Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "73901e86951616577b0ba6d04a2d9c8b686749d8b29bfbbb738ecd28e977be57",
        approvalPacketSha256:
          "ab8f950d4f36af9adcf8b4042d1e616e2a0fac172de7a58003709ee34331bc7b",
        producer: "claude native session output",
        reviewSha256:
          "0a23e9c1ccc77dfc67f033d7e5b117e7cc07bb4ca979311ef4c5b7244c060342",
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
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.314",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-10-30T22:01:09.632Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "babf35fe871dd6e276b143400db49ae407feaeabac450c01b7c1fa598d6fdfa4",
        approvalPacketSha256:
          "ab8f950d4f36af9adcf8b4042d1e616e2a0fac172de7a58003709ee34331bc7b",
        producer: "claude native session output",
        reviewSha256:
          "89c26c309f0b5d8e585134942ca7bbdde02d0978b03e6ae94f1667e6140a487e",
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
        "Claude Code 2.1.316 recorded the Stop block in the stop summary's hook errors rather than a separate stop-feedback record.",
        "A Remote Control bridge was active; tool approvals are attributed to the operator by timing, because the record names no channel.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "2.1.316",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-02T00:23:46.603Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "ebe8fb1d49b66ee7b1af97e2b443228562995a8a5e785591a5e63f71e74963ed",
        approvalPacketSha256:
          "d7aaf1876fc8340852a4232bdd4b333c53c33977f0b2e58f0adfd09f610d26f3",
        producer: "claude native session output",
        reviewSha256:
          "b4774d14392310a06588fe4267bbf415329fb344ede36c57598a7616eb228ecc",
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
        providerVersion: "0.165.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, read-only goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-10-30T20:21:20.431Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "8a075e093937dd490793be46055f85e83754a61652420828be90fb9df4f54219",
        approvalPacketSha256:
          "6d65cf85fc21578ae0bd1630e21366edc2fb623280484bcbcd1b4f098d885fff",
        producer: "codex native session output",
        reviewSha256:
          "349bb081d760f51d1e5be91621c45ad43c0488befd400cd09e2297508ea0a12e",
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
        providerVersion: "0.165.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-10-30T20:21:56.207Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "c1b8e4550fbb633205d382ab323d4ddcf50c6d30cc14eda3543855c17f612fec",
        approvalPacketSha256:
          "6d65cf85fc21578ae0bd1630e21366edc2fb623280484bcbcd1b4f098d885fff",
        producer: "codex native session output",
        reviewSha256:
          "04feb044af451dc7cfa93b47c192571338380686e5d16598b2f78d204d94071b",
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
        capturedAt: "2026-11-02T00:44:47.548Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "75e924b119fea83c09fec8eb6ffce53c731d4f3cd0325da473583ff97bfd49b5",
        approvalPacketSha256:
          "704378df4daaa470eefbfc8438f62c397328dd01a394bf32ed5722da38d1db5f",
        producer: "codex native session output",
        reviewSha256:
          "ab03e648553c1ba033987062ed14c058eedc31e7d097d4f83a65b0562f6f638c",
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
        capturedAt: "2026-10-31T00:49:56.205Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "af1a8ec69b25cac6a3ac01490fee16c12c12f313b4446d36bc939d8a7e654e4b",
        approvalPacketSha256:
          "66df311f7ffe512c612acd0be275f7ed6f5a0fbeb9764b81c150841b9d8c1cbc",
        producer: "copilot native session output",
        reviewSha256:
          "ad3600417e887a5dede91b9d3ac52164eb1d1d90f60795242063964c3e00189d",
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
        capturedAt: "2026-10-31T00:50:56.483Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "ff713aac1e6a9845f1c56cff6242ae0aa7be7623294533626dbca5cfd2f27ab8",
        approvalPacketSha256:
          "66df311f7ffe512c612acd0be275f7ed6f5a0fbeb9764b81c150841b9d8c1cbc",
        producer: "copilot native session output",
        reviewSha256:
          "bd8d2eb6f8100556ce63f440ffa1b542a0ec1ef79d826d8c199f3802b80574d6",
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
        capturedAt: "2026-10-31T06:31:11.042Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "f28cbc80bcfca844b1513b148d06ebabef0eff9459d71837712e1be705bf6846",
        approvalPacketSha256:
          "29bcb58ca9e46572e9b873e3635ecb3a37132d55854b6196b4817737bf298a11",
        producer: "antigravity native session output",
        reviewSha256:
          "ce78b795191e96290102aaff1ef9b2ef0d4f7b486812f127a1423a8d4c15a25d",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
  ];
