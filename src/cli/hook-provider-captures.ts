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
    "2a80ef642c513e6f1da80d76c9cb576ec062a5b594a92da2bd035baa81da9164",
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
        "Claude Code wrapped each refusal in a hook-error frame that also carried the launcher's source text to the model.",
        "The session used the account default model, claude-fable-5-1; the row pins no model.",
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
        capturedAt: "2026-11-08T09:59:26.908Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "aec240de2c60b674a7439baea2abb8b35c1867f7e4cb26c002d7c0bbc6367f5c",
        approvalPacketSha256:
          "d054de86c5f93975a46f1d734068dc03aa88c4ec5e7e9af736fb73830f2a72f8",
        producer: "claude native session output",
        reviewSha256:
          "f7787ec4e2568580f3548cf0933898ae3072a998f4e07f9c94e7b26150cf347a",
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
        "The operator closed the client after the completed turn; natural provider exit is not claimed.",
        "A safety classifier withheld the first response before any tool call and Claude Code fell back to Opus 4.8 for the session; the capture packet disclosed this model variance in advance.",
        "The fixture file already held the expected bytes, so the Write left it unchanged; delivery rests on the transcript's Write and hook records.",
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
        capturedAt: "2026-11-08T10:01:28.168Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "43f33edff8bda0acaeb369c23295505ff6ad09bd6fbf0cd2a60bb408c5588179",
        approvalPacketSha256:
          "b9b894eacb80327857659c715109b4ef9630551b677d97b095cc113ccba56eb4",
        producer: "claude native session output",
        reviewSha256:
          "f7787ec4e2568580f3548cf0933898ae3072a998f4e07f9c94e7b26150cf347a",
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
        "The fixture file already held its final bytes before the session; the block and repair rest on the transcript's Write and Stop records, not on final-file equality.",
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
        capturedAt: "2026-11-08T10:05:30.127Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "7412c3efddebd2c71e9d5b13eb6ca701062110c5e72825c8a54a57a17e35728e",
        approvalPacketSha256:
          "201761634fc6a4f3947c54ebacf3d7e82b4523325eea87db7dfdbf2a186f62fe",
        producer: "claude native session output",
        reviewSha256:
          "f7787ec4e2568580f3548cf0933898ae3072a998f4e07f9c94e7b26150cf347a",
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
        "The session record offered collaboration and cua tools although the launch disabled multi_agent; the model called none.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.167.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-08T10:11:46.751Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "00cddb15bdcc3ea0c942761b076052bb32fe9da044bcbb2c7ee9c3d23711fbb9",
        approvalPacketSha256:
          "2e9659ba68ddd5d681a3004daa3fb3d95541c9263d0fc53386ca139c69b26939",
        producer: "codex native session output",
        reviewSha256:
          "c7904b4250bac7f486847e47b75c51d7fe9587dfa798ab0d35a77d10f7fc6f17",
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
        "The session record offered collaboration and cua tools although the launch disabled multi_agent; the model called none.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.167.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-08T10:12:46.150Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "7e862a9741439f209eea22ba80139a51b33831f4ec9dc3343f4e574ec515dc3f",
        approvalPacketSha256:
          "2e9659ba68ddd5d681a3004daa3fb3d95541c9263d0fc53386ca139c69b26939",
        producer: "codex native session output",
        reviewSha256:
          "c7904b4250bac7f486847e47b75c51d7fe9587dfa798ab0d35a77d10f7fc6f17",
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
        "The session record offered collaboration and cua tools although the launch disabled multi_agent; the model called none.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.167.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-08T10:12:46.150Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "7e862a9741439f209eea22ba80139a51b33831f4ec9dc3343f4e574ec515dc3f",
        approvalPacketSha256:
          "2e9659ba68ddd5d681a3004daa3fb3d95541c9263d0fc53386ca139c69b26939",
        producer: "codex native session output",
        reviewSha256:
          "c7904b4250bac7f486847e47b75c51d7fe9587dfa798ab0d35a77d10f7fc6f17",
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
        "The secret-file denial text shows the Windows path without its backslashes; the decision is unaffected.",
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
        capturedAt: "2026-11-08T10:16:30.038Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "76837f9ccdaad2964f98da5a16365fc564e653b445b0f192f982bf60951ba9d9",
        approvalPacketSha256:
          "f6f4542af41900f45bafc429a7f2334f0854f953f7c17876a91268eb7611b963",
        producer: "copilot native session output",
        reviewSha256:
          "2b8eed31ce7904beae1f2e5e6653e61905038c92e2ba7cae900ec28ce4f0717d",
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
        capturedAt: "2026-11-08T10:16:52.089Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "0347f18e25e65ed3be1df848725332957555ad8a6b979a3b38ef6dc103c04e82",
        approvalPacketSha256:
          "b6218cb6b61d17a85f6a001ae1bc90b06cedf4e59dbd7e4bf3a461e715f08143",
        producer: "copilot native session output",
        reviewSha256:
          "2b8eed31ce7904beae1f2e5e6653e61905038c92e2ba7cae900ec28ce4f0717d",
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
        "The secret-file denial text shows the Windows path without its backslashes; the decision is unaffected.",
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
        capturedAt: "2026-11-08T10:21:35.780Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "feef7ce3717ed43f18a34f993e325eff33c0d2129d92209218366aa6f903d194",
        approvalPacketSha256:
          "284d3f7868d406962a196a73e1194f66252f9a4251e90d9346a052d1b7507a37",
        producer: "antigravity native session output",
        reviewSha256:
          "6be581d12592602c6a21637b28bcc3af3615cf84bf5441ac7ddb99c5daea1cc4",
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
        "The session used the account default model, claude-fable-5-1; the row pins no model.",
        "The transcript labels the permission mode default although the launch arguments request manual.",
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
        capturedAt: "2026-11-08T10:27:00.381Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "32fa09a515b7c374a321df8bf866cd76d85b11b5e1626abad18d3ef9ef7fef20",
        approvalPacketSha256:
          "6fc9245ec3f5c83a2d4316651ba1b770cf076b352804d53b6995fe2c6a71f278",
        producer: "claude native session output",
        reviewSha256:
          "50f5a4f7da6f9ed5705ad627b05485276b19bdf0ee91770907e2d7a0b36cbc8c",
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
        "The session used the account default model, claude-fable-5-1; the row pins no model.",
        "The transcript labels the permission mode default although the launch arguments request manual.",
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
        capturedAt: "2026-11-08T10:30:18.804Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "d482e39d69e65aaa3297ac8fb40554484b330078500bba97fac97ea1c92114d8",
        approvalPacketSha256:
          "6fc9245ec3f5c83a2d4316651ba1b770cf076b352804d53b6995fe2c6a71f278",
        producer: "claude native session output",
        reviewSha256:
          "50f5a4f7da6f9ed5705ad627b05485276b19bdf0ee91770907e2d7a0b36cbc8c",
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
        "This row is the approved replacement session; the first session ended on its controller timeout before the repair Write was approved and supplies no evidence.",
        "The transcript labels the permission mode default although the launch arguments request manual; the readiness screen showed manual mode.",
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
        capturedAt: "2026-11-10T19:15:21.690Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "9510d291df7234c1efc3440756391e54f5efa107c56b6fb61350c4f7bcc838a5",
        approvalPacketSha256:
          "c716b8d8f08b21edd131d932d7d85dd04fb5ab12c9033434e521e256495b3efe",
        producer: "claude native session output",
        reviewSha256:
          "50f5a4f7da6f9ed5705ad627b05485276b19bdf0ee91770907e2d7a0b36cbc8c",
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
        "The session record offered collaboration tools although the launch disabled multi_agent; the model called none.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.167.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, read-only goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-10T19:26:50.530Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "8d75364b1a9fc1413175f81f9abc2e1729fb5682b4460ac75f45a935c1aee12b",
        approvalPacketSha256:
          "3a31759b342f7a0fc634c0c8364b2899bed47ba7e042f7d7a35a0e7b08467ea8",
        producer: "codex native session output",
        reviewSha256:
          "fe9b9f26e0e9a948bd31b4b718d8b58ff4d6576dfb1c8a04eacd8e878e9e1396",
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
        "The Gruff finding reached the model in a developer message; the patch call's own return was empty.",
        "The session record offered collaboration tools although the launch disabled multi_agent; the model called none.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.167.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-10T19:27:15.974Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "4e1a5ec667c6e87a9dd67e4e5445bad793474220044e3c171fb1fc9ff8b21ac1",
        approvalPacketSha256:
          "3a31759b342f7a0fc634c0c8364b2899bed47ba7e042f7d7a35a0e7b08467ea8",
        producer: "codex native session output",
        reviewSha256:
          "fe9b9f26e0e9a948bd31b4b718d8b58ff4d6576dfb1c8a04eacd8e878e9e1396",
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
        "The session record offered collaboration tools although the launch disabled multi_agent; the model called none.",
        "The final answer quotes the finding sentence without the post-turn-safety header or coverage lines; the full reason is in the hook prompt record.",
        "Raw hook stdin was not retained; input-field coverage is not claimed.",
        "Forced timeout behavior was not tested.",
      ],
      capture: {
        providerVersion: "0.167.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-11T07:43:00.137Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "db6b75f22e046b6d94af9b2a03e5c5c9a6903837cbe5562a2086f20a952eca56",
        approvalPacketSha256:
          "c184b2da52b7f452e283aa43d6e21bc06619f5e58e3daae2b7130e5ae3ae408d",
        producer: "codex native session output",
        reviewSha256:
          "50d0a8ac3589aec2139a5aad0416c911309953664be2f108034e91846f275562",
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
        "This row is the approved replacement session; the first attempt was interrupted by a host reboot and supplies no evidence.",
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
        capturedAt: "2026-11-10T19:26:18.954Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "aba645fbea7b9cc1d49771bf3e11ab351f2c90b09d5ef47224c4f62acdf940e6",
        approvalPacketSha256:
          "f0f7e0d49e68bced3a8c34abd6ed7daafd36f9a2f86e33bcc2c85d95c35908d1",
        producer: "copilot native session output",
        reviewSha256:
          "dc4408b0b7b1695408eda1983f6537672e902a76272f40f43ab0aa50740cdfef",
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
        capturedAt: "2026-11-10T19:26:54.292Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "f06687942f154856483e1b3fa0411a1119f809d229a941a8ed7c737923579a21",
        approvalPacketSha256:
          "f0f7e0d49e68bced3a8c34abd6ed7daafd36f9a2f86e33bcc2c85d95c35908d1",
        producer: "copilot native session output",
        reviewSha256:
          "dc4408b0b7b1695408eda1983f6537672e902a76272f40f43ab0aa50740cdfef",
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
        "The final response abbreviates the secret-file reason with an ellipsis; the full reason is in the error text.",
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
        capturedAt: "2026-11-10T19:19:15.689Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "43c5a58a352c486b8ff6d0d9f9f72f392260b91c5cc514b5e0211c2ed10ced87",
        approvalPacketSha256:
          "0a623edd5d93392b3528c15e240b0c42af0ef0bcee48b8eb02605b97f6d4af4c",
        producer: "antigravity native session output",
        reviewSha256:
          "0738ce4089f3aba8d48142ac2bff8f3ddc85e866e1b10d794d409852a3b6d793",
        runtimeSha256: VERIFIED_RUNTIME_SHA256,
      },
    },
  ];
