/**
 * Records reviewed Windows and WSL observations of how agents deliver hook results.
 *
 * Use when the Hooks page or audit needs delivery evidence for one agent, event, and host.
 * A row without a current capture leaves delivery unverified. A historical capture keeps the hashes of the runtime that was reviewed.
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

/**
 * Runtime bytes at 9bc052af, recorded by the November 22 reviewed captures.
 *
 * Ten files changed after November 15: the launcher, supervisor and process tree, policy input, two deny-dangerous modules,
 * three Gruff files and the Stop controller.
 */
const RUNTIME_SHA256_NOVEMBER_22: Readonly<Record<string, string>> = {
  ...RUNTIME_SHA256_NOVEMBER_15,
  "deny-dangerous/git-command.mjs":
    "e9e40ecec8fd84925b734d7efceaffe5cab8254e895c4f58b35ebc8af309d3f1",
  "deny-dangerous/patterns-shell.mjs":
    "51ac0fa0f2613a9984381e8f52582766b50af74730263ef085ee3800e9d36206",
  "gruff-code-quality.mjs":
    "b799df3e58f720d098b4d1fd48ab769742ad00c3ab90d3654b88ed79942a5506",
  "gruff/analyzer.mjs":
    "5c878561084c627b14e04b102f2c1c6518d833e598cb1b30914d83a3a8e96c67",
  "gruff/scope.mjs":
    "224ab0ab2f151dbfc629727a7bace2ed82fe0d128b827c8e215992b8525bb981",
  "hook-launch.mjs":
    "7e8e19c2fb2e1b3236661fac1008915c6b324e6a37f84ccc7ecab440416c4bff",
  "hook-supervisor.mjs":
    "0ad5f8529bc974943d56e9d7ef23cac582f29e2653ba4a798d2eefcbbdae1328",
  "policy-input.mjs":
    "7d9a20f5e4925e56e1255d0fa3c490e3cb236fe1252d1778d4c9893e16365d5e",
  "post-turn/controller.mjs":
    "9978a97beb4595972e9756fbb2ce90105710bbc6153c1e80fe40e35cc5964637",
  "process-tree.mjs":
    "5e641c0934c12ba0f8b13c68716a24b6068c315f7f6ac416a634221a9ac2d853",
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
        "The Windows file-tool path fix changed the policy evaluator after this capture.",
        "The hook reason reached the model inside Claude Code’s hook-error text, which also carried the inline launcher source.",
        "Claude Code ran pwd and node --version without a prompt. Only command -v gh needed the one-time approval.",
        "The transcript labels permission mode default. The requested arguments and native UI show manual mode.",
        "The operator closed the completed client. The receipt records exit code 1 after the final answer.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "2.1.330",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T00:22:00.369Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "44c932391c9c415445ceb3b36551c3e2c8ec67107d0647c8796244537b224835",
        approvalPacketSha256:
          "cafad65de9bd833b6f848147c6086b538ac731b749b0414b1c09306ef9f4237a",
        producer: "claude native session output",
        reviewSha256:
          "c3f6e6cf98ce6f678a5084d4fd0fd693b4986f38d2413259789704683e537978",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "The approved same-content Write triggered Gruff. The transcript records the Write and delivered analysis while the fixture bytes stayed the same.",
        "Gruff also updated its own health marker in the fixture’s event log folder.",
        "Claude Code ran pwd, node --version and the Read without a prompt. Only command -v gh and the Write needed one-time approvals.",
        "The operator closed the completed client. The receipt records exit code 1 after the final answer.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "2.1.330",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T00:27:15.383Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "f3ded54293909566a94e2eb18c333f962fad03eb98444bc5c74831719a842861",
        approvalPacketSha256:
          "a0673a65306d1e06f6c15e917f680329b46814dc5c3c9676077fce2e866d6bfd",
        producer: "claude native session output",
        reviewSha256:
          "5a9ede2d94ab8fa99d49ce52bb35ed4c159dd1a6ae1eebbb0afcc7042cd38138",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "Claude Code 2.1.330 recorded the delivered Stop reason in the Stop summary’s hook errors.",
        "The operator closed the completed client. The receipt records exit code 1 after the clean Stop.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "2.1.330",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T00:32:58.989Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "e7fab1e3889f19521d535069baca43a18c7de831f6fcd13d924aded61fa54e26",
        approvalPacketSha256:
          "f51515d7be68803b4742c9aeb58669f7fb46a08d310f77d0f296cd5b6987bffe",
        producer: "claude native session output",
        reviewSha256:
          "7398f71cb70387f83d153d313c2ee05fb1070dc71143c642ad5e584db43cf018",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "The Windows file-tool path fix changed the policy evaluator after this capture.",
        "Copilot logs one combined preToolUse record per tool call for both policy hooks. The reason text names the policy behind each denial.",
        "The deny-dangerous reason printed the denied Windows path without its backslashes.",
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
        capturedAt: "2026-11-22T00:37:51.208Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "63d7da8ecc381a42fcc735391891c09917437c771a28863beeb5cef4c63fe6a2",
        approvalPacketSha256:
          "8e6d5666fea13aafaba9cf440977507bdcca252915b6915c6b9e4409b0a3dd2e",
        producer: "copilot native session output",
        reviewSha256:
          "8e918c7c213971400f4edd2cfcf8ec2a486afbeba8750b1bb5b75a401e80c01d",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "The postToolUse record carries no tool call ID. Event order and the hook text in the edit’s result tie it to the edit.",
        "Gruff also updated its own health marker in the fixture’s event log folder.",
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
        capturedAt: "2026-11-22T00:39:42.357Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "8d5f5704e521ac9f8444d38101d95da3b24ff6e43767ff8ff865cf3f010a4119",
        approvalPacketSha256:
          "0272c7f148af746fdaddaade75f24e21e075730f46da4b358288b846eee30519",
        producer: "copilot native session output",
        reviewSha256:
          "a8a9d3ed327cfd52d4335ab3535f6acc406ccea649f12bd03a8c06c1a2323330",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "Both policy denials reached the model and all harmless controls succeeded.",
      limitations: [
        "The Windows file-tool path fix changed the policy evaluator after this capture.",
        "The deny-dangerous reason printed the denied Windows path without its backslashes.",
        "The provider recorded no approval channel or hook owner. The local input sequence and timing establish the operator’s approvals, and the reason text names the policy behind each denial.",
        "The operator closed the completed client. The receipt records exit code 1.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "1.4.8",
        providerMode:
          "interactive CLI, request-review tool permission, default agent mode, low effort, run from a private copy",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".agents/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T00:48:03.847Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "24.21.0",
        artifactSha256:
          "6099fa47803ade22bb3905266618ebd3a178584614a66aa10c7bd92b05e19761",
        approvalPacketSha256:
          "7f28e38838d310dc124e069731854965a87a6dcb395e1b60a03b65ab0a1c1b55",
        producer: "antigravity native session output",
        reviewSha256:
          "32c6b5091da2e573fc8bb550b30849f47b13cd87abe4320689037f1853fce9f0",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
      },
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
        "The Windows file-tool path fix changed the policy evaluator after this capture.",
        "The local controller recorded each approval input. The provider transcript also contains Remote Control bridge records with no approval-channel field.",
        "Claude Code ran pwd and node --version without a prompt. Only command -v gh needed the one-time approval.",
        "The controller ended the completed client with signal 9.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "2.1.330",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T00:52:50.971Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "c300b5fe786176cf72b66e0a9460b982c8701bea8d8279e885003555c1a23453",
        approvalPacketSha256:
          "ae2fdc3f6e104af643adf8003842869399c9199697f9809a8095b795d3e7d6e1",
        producer: "claude native session output",
        reviewSha256:
          "5cfd3d3a396b0dc9b1592e6aa987db9e53602859244a39e3e01ad1d590997f80",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "Claude Code ran pwd and node --version without a prompt. Only command -v gh and the Write needed one-time approvals.",
        "The controller ended the completed client with signal 9.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "2.1.330",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T00:54:37.099Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "32029bc759af3fb6222af686989bb86e166b2cf65f20d572be8a8807ebcc39f3",
        approvalPacketSha256:
          "ae2fdc3f6e104af643adf8003842869399c9199697f9809a8095b795d3e7d6e1",
        producer: "claude native session output",
        reviewSha256:
          "5cfd3d3a396b0dc9b1592e6aa987db9e53602859244a39e3e01ad1d590997f80",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "Claude Code 2.1.330 records the exact Stop reason in the summary’s hook errors.",
        "Remote Control was connected from user settings despite the project-only setting sources. No remote input appears in the transcript.",
        "The operator closed the completed client with signal 9 after a clean Stop.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "2.1.330",
        providerMode:
          "interactive CLI, manual permission mode, project settings only",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".claude/settings.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T00:58:17.047Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["provider-ui", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "d2d14f9fb75bc200891da6895d3c0729fdb292cecfc7c1da4381f24186afe028",
        approvalPacketSha256:
          "a95acfc441f951721dfc5aab3f52b3a434eb581b2ec2b5d56704beaacc5b7f99",
        producer: "claude native session output",
        reviewSha256:
          "cebe4bc4a910a5e0afdc8cc7a6045ff535f624e2b1d0b61f9836d8311743d614",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
      verification: "incomplete",
      summary:
        "The native edit callback delivered Gruff findings to the model.",
      limitations: [
        "This observation predates the current shared hook launcher and process supervision.",
        "The operator granted hook trust in a separate no-task session after the changed-hook prompt. This was outside the capture packet’s readiness phase.",
        "Gruff feedback reached the model in a separate developer message. The patch tool returned empty output.",
        "Codex records the requested model and reasoning settings. The session does not report the backend model identity.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
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
      verification: "incomplete",
      summary:
        "Stop feedback blocked completion. The model repaired the fixture and completed the turn.",
      limitations: [
        "This observation predates the current shared hook launcher and process supervision.",
        "The controller relied on previously granted native hook trust. Stop delivery is present in the bound rollout.",
        "The rollout records a completed turn and a clean fixture after repair. It contains no separate clean Stop record.",
        "The model quoted the detailed reason during continuation and shortened it in the final response.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
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
        "The Windows file-tool path fix changed the policy evaluator after this capture.",
        "Copilot 1.0.114 ran command -v gh without a prompt. Only node --version needed the one-time approval, and no persistent allow rule was added.",
        "Hook records name no owner. Attribution rests on the pinned code, the local rehearsal and matching denial reasons.",
        "The controller ended the completed client with signal 9.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      historicalCapture: {
        providerVersion: "1.0.114",
        providerMode:
          "interactive CLI, manual approval mode, low reasoning, available-tools limited to bash and view",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T01:04:59.367Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "19b392bdece6cf05e020c885914ff7241a56365dde53f6fc154f630a84db2f91",
        approvalPacketSha256:
          "6721b0accac239a5988a9be4ff1254e6f215bc9a4b6f6f4c1695b725566748f1",
        producer: "copilot native session output",
        reviewSha256:
          "c52335269d7a4c34212827cba5d7aca49bdc080b5d3647e2baec79a6b4903961",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "The tool result also carried Copilot’s own credit notice under the postToolUse guidance heading. No logged hook produced it.",
        "The controller ended the completed client with signal 9.",
        "Raw hook stdin was not retained. Input field coverage and forced timeouts were untested.",
      ],
      capture: {
        providerVersion: "1.0.114",
        providerMode:
          "interactive CLI, manual approval mode, low reasoning, available-tools limited to edit and view",
        hookVersion: "1.19.0",
        adapterVersion: "1",
        configurationSource: "project",
        configurationPath: ".github/hooks/hooks.json",
        trustState: "trusted",
        capturedAt: "2026-11-22T01:06:17.642Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "dfc2b5c7fab26a9e38ff0c1dbe86e5fe0c54482e63b005458a8bdafdab8fa378",
        approvalPacketSha256:
          "6721b0accac239a5988a9be4ff1254e6f215bc9a4b6f6f4c1695b725566748f1",
        producer: "copilot native session output",
        reviewSha256:
          "c52335269d7a4c34212827cba5d7aca49bdc080b5d3647e2baec79a6b4903961",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
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
        "The Windows file-tool path fix changed the policy evaluator after this capture.",
        "The conversation used a write-ahead log. The capture bound the native database and sidecar bytes to the reviewed output.",
        "The provider recorded no approval channel or hook owner. The local input sequence and timing establish the operator’s approvals; registration order and reason text attribute each denial.",
        "The controller ended the completed client with signal 9.",
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
        capturedAt: "2026-11-22T03:45:02.800Z",
        supportOutcome: "supported",
        observedPayloadFields: [],
        responseChannels: ["stdout-json", "model-context"],
        resultDelivery: "delivered",
        timeoutBehavior: "not-tested",
        continuationBehavior: "continued",
        modelResultVisibility: "visible",
        nodeVersion: "22.22.1",
        artifactSha256:
          "5c716525df89b316a1e74e49a36f95c58fd3554fe3ecc1f6d726dc5490ce78a3",
        approvalPacketSha256:
          "ff7da6ed242180d711d5f703140644d750b4345f56540af926dcf3b4a012f8b3",
        producer: "antigravity native session output",
        reviewSha256:
          "4814a9ce728f16fd003312abbd293060f09e30bcea3bfd78180f5f22dcde3204",
        runtimeSha256: RUNTIME_SHA256_NOVEMBER_22,
      },
    },
  ];
