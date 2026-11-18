/**
 * Reviewed Windows and WSL observations of each provider delivering hook results to the model, for the 1.19.0 runtime.
 *
 * The hooks registry attaches each row to its provider's evidence; support gates are still decided separately.
 * Digests point back to the reviewed receipts without publishing transcripts or raw payload values.
 */
import type { HookProviderHostEvidence } from "./hook-contracts.js";

/**
 * SHA256 of the 41 runtime files as captured for the rows whose hooks do not load the scanner, keyed by path relative to workflow/hooks.
 *
 * These values stay as captured. A row must match the current bytes of every file its own hook loads, so changing such a file
 * means recapturing that hook's rows instead of editing a value here. A row captured on different bytes needs its own constant.
 */
const RUNTIME_SHA256_WITH_EARLIER_SCANNER: Readonly<Record<string, string>> = {
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

/**
 * Runtime hashes from the November 13 captures, used as the base for later snapshots.
 *
 * The scanner is the only difference from the earlier snapshot above.
 */
const VERIFIED_RUNTIME_SHA256: Readonly<Record<string, string>> = {
  ...RUNTIME_SHA256_WITH_EARLIER_SCANNER,
  "post-turn/scanner.mjs":
    "95c985073274de606803bdfbbf800a86ada369582af0a9a1f1d4a897bdc7afd1",
};

/** Runtime bytes recorded by the November 15 and 16 reviewed captures. */
const RUNTIME_SHA256_NOVEMBER_15: Readonly<Record<string, string>> = {
  ...VERIFIED_RUNTIME_SHA256,
  "antigravity-hook-bootstrap.cjs":
    "ba456d5d4b6da01b8938611a500ce29943e0ad9d4ae583b2260601448e9ce6f6",
  "policy-evaluation.mjs":
    "886c4e39acb37ac929cd26fe37e2b2f57e3923fee226cf93026dd86a9d3b6c3c",
  "policy-input.mjs":
    "0d31a5105efc31154f6b7e6b2de7087a5e20e2a7f08f2d9f0a56167b1a14a029",
};

/** Runtime bytes recorded by the later Windows Copilot captures. */
const RUNTIME_SHA256_COPILOT_WINDOWS: Readonly<Record<string, string>> = {
  ...RUNTIME_SHA256_NOVEMBER_15,
  "post-turn/scanner.mjs":
    "2a80ef642c513e6f1da80d76c9cb576ec062a5b594a92da2bd035baa81da9164",
};

/** Reviewed host observations. Only verified rows attest current delivery. */
export const HOOK_PROVIDER_HOST_EVIDENCE: readonly HookProviderHostEvidence[] =
  [
    {
      caseId: "C1",
      host: "windows",
      provider: "claude",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The operator closed the completed client. The receipt records exit code 1 and the native transcript records a clean Stop.",
        "The transcript labels permission mode default. The requested arguments and native UI show manual mode.",
        "The denial frames also carried launcher source text to the model.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "2.1.325",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-15T05:26:28.771Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "9d440a76de149d56d499e2eb1854b298576f009c998362657b38daa0ec10f801",
        approvalPacketSha256:
          "df488dcd0f1bdd5cc7ed0fd48d9b113972c33889e61c2396ccc5cd393ed75b7c",
        producer: "claude native session output",
        reviewSha256:
          "913a16a004ade7c128743635e71e1f79a9b70d29c69d946b21d0df30ddd98da2",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
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
        "The operator closed the completed client. The receipt records exit code 1 and the native transcript records a clean Stop.",
        "The approved same-content Write triggered Gruff. The transcript records the Write and delivered analysis while the fixture bytes stayed the same.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "2.1.325",
        providerMode: "interactive CLI, manual permission mode",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-15T06:13:22.280Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "49beb6f63458575fe29dacf8f5dba0e4efc2884757212dfdee4abee6c36cabd1",
        approvalPacketSha256:
          "e6b97f0053f551f7f3eddd637b3c1d331f75564a70c3b6d760000125d4398024",
        producer: "claude native session output",
        reviewSha256:
          "73647b4243ec9083e3c8553fe956c97f39659a13b410dd04ab283f51f3839c1d",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
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
        "Claude Code 2.1.325 recorded the delivered Stop reason in the Stop summary’s hook errors.",
        "The operator closed the completed client. The receipt records exit code 1 after the clean Stop.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "2.1.325",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-15T19:14:28.595Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "ba1b0aaa859efa5e3e9b01ff85c8223a4d142c0f2f465d4f89b5cc7101f31dc7",
        approvalPacketSha256:
          "f260a82e834978dcc96e9f87cf6b9471f754e1f003f3b96aba0db10d4bfa1bc0",
        producer: "claude native session output",
        reviewSha256:
          "acd2a8e3c7672565fa8c358fda54a74ff9ecfb5067bce9e80dca2a11e79b6230",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
      },
    },
    {
      caseId: "C4",
      host: "windows",
      provider: "codex",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "The Windows recapture stopped during sandbox setup before either policy probe ran.",
      limitations: [
        "The earlier capture used runtime bytes that the current deny hooks have since changed.",
        "The attempted replacement spent its claim without exercising either denial.",
      ],
    },
    {
      caseId: "C5",
      host: "windows",
      provider: "codex",
      canonicalEvent: "post-tool",
      providerEventName: "PostToolUse",
      verification: "incomplete",
      summary:
        "Windows PostToolUse delivery awaits a capture of the current registration.",
      limitations: [
        "Codex CLI 0.168.0 delivered feedback on November 13 using the previous Windows command.",
        "The replacement session did not start after the Windows sandbox setup failure in the PreToolUse attempt.",
      ],
    },
    {
      caseId: "C6",
      host: "windows",
      provider: "codex",
      canonicalEvent: "turn-stop",
      providerEventName: "Stop",
      verification: "incomplete",
      summary:
        "Windows Stop delivery awaits a capture of the current registration.",
      limitations: [
        "Codex CLI 0.168.0 delivered feedback on November 13 using the previous Windows command.",
        "The replacement session did not start after the Windows sandbox setup failure in the PreToolUse attempt.",
      ],
    },
    {
      caseId: "C7",
      host: "windows",
      provider: "copilot",
      canonicalEvent: "pre-tool",
      providerEventName: "preToolUse",
      verification: "incomplete",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The capture used synthetic files and a local GitHub stub. Recorded hashes cover the final state of the six declared fixture files.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "1.0.103",
        providerMode:
          "prompt mode (-p), JSON output, low reasoning, allow-all-tools within available-tools",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-17T19:38:58.832Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "263782c22602f89cc414bacf84e706d07a2c167d5d5bd00fa041cbd79c8c5969",
        approvalPacketSha256:
          "24fb3c66a1b1f14a7132e94ac41cfa2693dd3b95397545f322569949b2f6ddcc",
        producer: "copilot native session output",
        reviewSha256:
          "21e8927deacbaa7523e9afbba3c56c7f0bc7643140aadd3943d294a23ed5a180",
        runtimeSha256: RUNTIME_SHA256_COPILOT_WINDOWS,
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
        "The callback and the model’s reply contain the expected Gruff feedback phrase. One digit elsewhere in the hook context differs between rehearsal and capture.",
        "Recorded hashes identify the intended synthetic edit and the final state of the other five declared fixture files.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
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
        capturedAt: "2026-11-18T09:22:55.592Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "3f093574cfb8793f2288c79239c9e9718c098558fa9e8beb8d1267db9bd5254c",
        approvalPacketSha256:
          "f6a5b18adb8e9c5f078cb440739cf1e0892c7f86a2379e1e0005defdf9f2cd82",
        producer: "copilot native session output",
        reviewSha256:
          "0bb6f6a9d24e5657a0accd69d4022ebfe44a331c4d0172bfefe75ecb4b8dcc21",
        runtimeSha256: RUNTIME_SHA256_COPILOT_WINDOWS,
      },
    },
    {
      caseId: "C9",
      host: "windows",
      provider: "antigravity",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "The Windows recapture stopped before refresh when the Defender detection count differed from the approved baseline.",
      limitations: [
        "The earlier capture used runtime bytes that the current deny hooks have since changed.",
        "The approved preflight required three Defender detections. The operator reported zero and the replacement claim was unused.",
      ],
    },
    {
      caseId: "C10",
      host: "wsl",
      provider: "claude",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The local controller recorded each approval input. The provider transcript also contains Remote Control bridge records with no approval-channel field.",
        "The controller ended the completed client with signal 9.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "2.1.325",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-16T08:03:28.161Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "cbf440fec0489092df99564b8ee360572406cbe3e0c510f0cf20c52282d198d1",
        approvalPacketSha256:
          "09735e07f9a2539d8edafd32212d29431f120871fe08adfc1b25c26731acb307",
        producer: "claude native session output",
        reviewSha256:
          "4f35ad495b92561452170e75d4c08f571caef043bba5367c54070fa905b15320",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
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
        "The local controller recorded each approval input. The provider transcript also contains Remote Control bridge records with no approval-channel field.",
        "The controller ended the completed client with signal 9.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "2.1.325",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-16T08:05:02.982Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "2ba41f03d5fbf4165ff7cb9b7fa8128f7eefa0a3222b0046e34b679f7830f7bc",
        approvalPacketSha256:
          "09735e07f9a2539d8edafd32212d29431f120871fe08adfc1b25c26731acb307",
        producer: "claude native session output",
        reviewSha256:
          "4f35ad495b92561452170e75d4c08f571caef043bba5367c54070fa905b15320",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
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
        "Claude Code 2.1.325 records the exact Stop reason in the summary’s hook errors. The model condensed it before repairing the fixture.",
        "The operator closed the completed client with signal 9 after a clean Stop.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "2.1.325",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-15T19:30:07.395Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "f13b1521bf0db7c906816125fc8ad37b1db1e7462a8338942077994869de9205",
        approvalPacketSha256:
          "f5f8316305ebf840323c397fa8676686da0ba64a7cfe657747d38f89bbcb6e1e",
        producer: "claude native session output",
        reviewSha256:
          "63ede2d017f87ebb6ae8dd1457d02de8383dc4a9c58e46d4b87edf46b6cccd95",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
      },
    },
    {
      caseId: "C13",
      host: "wsl",
      provider: "codex",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The operator granted hook trust in a separate no-task session after the changed-hook prompt. This was outside the capture packet’s readiness phase.",
        "Codex records the requested model and reasoning settings. The session does not report the backend model identity.",
        "The JSON event stream carried no hook event. The bound rollout and native stderr establish delivery.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "0.169.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, read-only goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-16T07:46:08.682Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stderr", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "c725d4874f4e05900c10fc47338cafcaa7618157124b701c5dea3c5f043e3c07",
        approvalPacketSha256:
          "bca6477d9715bb41a72cf82252ec1b9d6d285bb098a94dee6fb989482eb26add",
        producer: "codex native session output",
        reviewSha256:
          "f81dfb5722960c9a92a5c5711158a8666b45793edc08ad50a23ecdfbfb458bfb",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
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
        "The operator granted hook trust in a separate no-task session after the changed-hook prompt. This was outside the capture packet’s readiness phase.",
        "Gruff feedback reached the model in a separate developer message. The patch tool returned empty output.",
        "Codex records the requested model and reasoning settings. The session does not report the backend model identity.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "0.169.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-16T07:46:37.968Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "a3c54d8c542f3a64051f59ccb65ebef4be2bd247aad54dd6728433078d4cd7e5",
        approvalPacketSha256:
          "bca6477d9715bb41a72cf82252ec1b9d6d285bb098a94dee6fb989482eb26add",
        producer: "codex native session output",
        reviewSha256:
          "f81dfb5722960c9a92a5c5711158a8666b45793edc08ad50a23ecdfbfb458bfb",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
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
        "Stop feedback blocked completion. The model repaired the fixture and completed the turn.",
      limitations: [
        "The controller relied on previously granted native hook trust. Stop delivery is present in the bound rollout.",
        "The rollout records a completed turn and a clean fixture after repair. It contains no separate clean Stop record.",
        "The model quoted the detailed reason during continuation and shortened it in the final response.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "0.169.0",
        providerMode:
          "exec mode (codex exec --json), low reasoning, workspace goat-flow permission profile, launched with --ask-for-approval on-request",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".codex/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-16T07:05:10.059Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "d985cd2ece425df5f9dcddda3fc3c0387bfb2a23439d1fb9790744c5664ad4ce",
        approvalPacketSha256:
          "6f06554c088e4bf0bbba2336b018300445ff3bb2cc94e36665a00ede463b708c",
        producer: "codex native session output",
        reviewSha256:
          "ff5b81434468b4b7c4f106796c711b9bda678c03b31037542343b22c0db59772",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
      },
    },
    {
      caseId: "C16",
      host: "wsl",
      provider: "copilot",
      canonicalEvent: "pre-tool",
      providerEventName: "preToolUse",
      verification: "incomplete",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The controller ended the completed client with signal 9. The tool availability list included two extension tools, neither of which was called.",
        "Hook records name no owner. Attribution rests on the pinned code, the local rehearsal and matching denial reasons.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "1.0.91",
        providerMode:
          "interactive CLI, manual approval mode, low reasoning, available-tools limited to bash and view",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-16T08:41:54.011Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "4407e76586befede638826e9e573d2de282008a22ad7a723c4fb64ada0503330",
        approvalPacketSha256:
          "f1a11e9faf0592791dbaf3e312788105a799a5f7f5463f7deb26cd0d022474c0",
        producer: "copilot native session output",
        reviewSha256:
          "f6de76c5e0021e60caac782b97dc72b472f9c0641bd443b75909430189874811",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
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
        "The controller ended the completed client with signal 9. The tool availability list included two extension tools, neither of which was called.",
        "A stale session lock remained under a terminated process ID. The event log hash matched the reviewed bytes.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
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
        capturedAt: "2026-11-16T08:44:06.119Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "5ff2beb2844fa29d60a570c138668681346652727aea769460816e0a0e502153",
        approvalPacketSha256:
          "f1a11e9faf0592791dbaf3e312788105a799a5f7f5463f7deb26cd0d022474c0",
        producer: "copilot native session output",
        reviewSha256:
          "f6de76c5e0021e60caac782b97dc72b472f9c0641bd443b75909430189874811",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
      },
    },
    {
      caseId: "C18",
      host: "wsl",
      provider: "antigravity",
      canonicalEvent: "pre-tool",
      providerEventName: "PreToolUse",
      verification: "incomplete",
      summary:
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The model ID and native UI showed the low-effort model. The client rejected the separate effort flag.",
        "The conversation used a write-ahead log. The extractor bound the native database and sidecar bytes to the reviewed output.",
        "The provider recorded no approval channel. The local input sequence and timing establish attribution for the operator’s approvals.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "1.4.12",
        providerMode:
          "interactive CLI, request-review tool permission, default agent mode, low effort, run from a private read-only copy",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".agents/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-16T08:58:37.697Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "08b3fb78403c99f3f41f693e08c158145e31a3567b6ca860a9f65d46dc8356d0",
        approvalPacketSha256:
          "b1ee9fc91c5fdc981aa507557d0c94a2b577d588b9b4ef3c217a20a0cfb0f6dd",
        producer: "antigravity native session output",
        reviewSha256:
          "70a4a8d7b09b1704ebacdbb07292c22e0028de194a33fcaada1be1c59bf89f3b",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_15,
      },
    },
  ];
