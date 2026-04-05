function app() {
  return {
    // --- Core state ---
    report: window.__GOAT_FLOW_REPORT__ || null,
    selectedAgent: window.__GOAT_FLOW_REPORT__?.agents?.[0]?.agent || null,
    projectPath: window.__GOAT_FLOW_DEFAULT_PATH__ || '.',
    darkMode: localStorage.getItem('gf-dark') === 'true' || (!localStorage.getItem('gf-dark') && window.matchMedia('(prefers-color-scheme: dark)').matches),
    scanning: false, toast: '', toastError: false, copyLabel: 'Copy', srAnnouncement: '',
    activeView: 'home',
    installedAgents: [],
    allAgents: [],
    activeRunner: 'claude',
    userRole: '',
    workspacePanel: 'prompts',
    sidebarCollapsed: false,
    scanDetailAgent: null,
    get projectName() { return this.projectPath.split('/').filter(Boolean).pop() || this.projectPath; },
    get projectColor() {
      const name = this.projectName;
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
      const hue = Math.abs(hash) % 360;
      return `hsl(${hue}, 60%, 50%)`;
    },
    showBrowser: false, browserCurrent: '', browserParent: '', browserDirs: [],

    lastScanTime: null,

    // --- Scanner state ---
    selectedFixes: [],
    fixCopyLabel: 'Copy fixes',

    // --- Terminal state ---
    terminalAvailable: false,
    terminalSessionId: null,
    terminalConnected: false,
    terminalEnded: false,
    lastRunPrompt: null,
    selectedPreset: null,
    lastRunAgent: null,
    promptRunStates: {},
    launching: false,
    availableRunners: [],
    _terminalWs: null,
    _terminalXterm: null,
    _xtermLoaded: false,

    // --- Config/Settings state ---
    configYaml: '',
    localConfigYaml: '',
    configDirty: false,
    configNote: '',
    _localConfigPlaceholder: '# Local overrides - this file is gitignored.\n# Values here merge on top of config.yaml.\n# Uncomment and edit as needed.\n\n# userRole: developer\n# agents:\n#   - claude\n',

    // --- Wizard state ---
    wizardDetecting: false,
    wizardSelectedAgent: 'claude',
    wizardData: {
      languages: [],
      frameworks: [],
      commands: { test: '', lint: '', build: '', format: '' },
      agents: { claude: true, codex: false, gemini: false, copilot: false },
      existing: { skills: false, instructions: false, evals: false, lessons: false, footguns: false, config: false },
      nonGoatFlow: [],
    },
    wizardGenerating: false,
    wizardSetupOutputs: {},

    // --- Launcher state ---
    presets: PRESETS,
    presetFilter: 'all',
    presetSearch: '',
    presetFavorites: JSON.parse(localStorage.getItem('goat-flow-preset-favorites') || '[]'),
    toggleFavorite(id) {
      const idx = this.presetFavorites.indexOf(id);
      if (idx === -1) this.presetFavorites.push(id);
      else this.presetFavorites.splice(idx, 1);
      localStorage.setItem('goat-flow-preset-favorites', JSON.stringify(this.presetFavorites));
      this._saveFavoritesToConfig();
    },
    async _saveFavoritesToConfig() {
      try {
        const res = await fetch(`/api/config?path=${encodeURIComponent(this.projectPath)}`);
        const data = await res.json();
        let yaml = data.localConfig || '';
        // Remove existing favorites line(s)
        yaml = yaml.replace(/^\s*favorites:.*$\n?/m, '');
        yaml = yaml.replace(/^\s*- [a-z-]+\n?/gm, (match, offset) => {
          // Only remove list items that follow a favorites: key
          const before = yaml.substring(0, offset);
          return before.match(/favorites:\s*\n\s*$/m) ? '' : match;
        });
        // Append favorites
        yaml = yaml.trimEnd() + '\nfavorites:\n' + this.presetFavorites.map(f => `  - ${f}`).join('\n') + '\n';
        await fetch(`/api/config/local?path=${encodeURIComponent(this.projectPath)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: yaml }),
        });
      } catch { /* silent - localStorage is the fallback */ }
    },
    async _loadFavoritesFromConfig() {
      try {
        const res = await fetch(`/api/config?path=${encodeURIComponent(this.projectPath)}`);
        const data = await res.json();
        if (data.localConfig) {
          const match = data.localConfig.match(/favorites:\s*\n((?:\s+-\s+\S+\n?)*)/);
          if (match) {
            const ids = match[1].match(/- (\S+)/g)?.map(m => m.replace('- ', '')) || [];
            if (ids.length > 0) {
              this.presetFavorites = ids;
              localStorage.setItem('goat-flow-preset-favorites', JSON.stringify(ids));
            }
          }
        }
      } catch { /* fall back to localStorage */ }
    },
    isFavorite(id) { return this.presetFavorites.includes(id); },
    get presetCats() {
      const cats = new Map();
      for (const p of this.presets) if (!cats.has(p.cat)) cats.set(p.cat, p.cat.charAt(0).toUpperCase() + p.cat.slice(1));
      return [{ id: 'all', label: 'All' }, { id: 'favorites', label: '\u2605 Favorites' }, ...Array.from(cats, ([id, label]) => ({ id, label }))];
    },
    get filteredPresets() {
      let list;
      if (this.presetFilter === 'favorites') {
        list = this.presets.filter(p => this.presetFavorites.includes(p.id));
      } else {
        list = this.presetFilter === 'all' ? this.presets : this.presets.filter(p => p.cat === this.presetFilter);
      }
      if (this.presetSearch.trim()) {
        const q = this.presetSearch.toLowerCase();
        list = list.filter(p => p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q) || p.prompt.toLowerCase().includes(q));
      } else if (this.presetFilter !== 'favorites') {
        const favSet = new Set(this.presetFavorites);
        list = [...list.filter(p => favSet.has(p.id)), ...list.filter(p => !favSet.has(p.id))];
      }
      return list;
    },
    /** Adapt /goat prefix for the active runner (Codex uses $goat) */
    adaptPrompt(prompt) {
      if (this.activeRunner === 'codex') return prompt.replace(/^\/goat\b/, '$goat');
      return prompt;
    },
    copyPreset(prompt) { this.copyText(this.adaptPrompt(prompt)); },
    sendToTerminal(text) {
      if (!this._terminalWs || this._terminalWs.readyState !== WebSocket.OPEN) {
        this.showToast('No active terminal session', true);
        return;
      }
      // Use bracketed paste mode so the terminal receives the entire text as a single paste,
      // not as individual keystrokes that trigger line-by-line execution.
      // \x1b[200~ = start bracketed paste, \x1b[201~ = end bracketed paste
      const adapted = this.adaptPrompt(text);
      const escaped = adapted.replace(/\r?\n/g, ' ');
      this._terminalWs.send(JSON.stringify({ type: 'input', data: escaped + '\r' }));
    },

    // --- Init ---
    init() {
      this.$watch('darkMode', v => {
        localStorage.setItem('gf-dark', v);
        document.documentElement.classList.toggle('dark', v);
      });
      // Re-fit terminal when switching back to workspace view.
      // The terminal container must have real dimensions before fitting.
      // Use requestAnimationFrame to wait for the browser to actually paint.
      this.$watch('activeView', v => {
        if (v === 'workspace' && this._terminalXterm?._addonFit) {
          const refit = () => {
            const container = this.$refs.terminalContainer;
            if (!container || container.offsetWidth === 0) return false;
            this._terminalXterm._addonFit.fit();
            if (this._terminalWs?.readyState === WebSocket.OPEN) {
              this._terminalWs.send(JSON.stringify({ type: 'resize', cols: this._terminalXterm.cols, rows: this._terminalXterm.rows }));
            }
            return true;
          };
          // Poll until the container has real dimensions (x-show transition complete)
          const poll = (attempts = 0) => {
            if (attempts > 20) return; // give up after ~1s
            requestAnimationFrame(() => {
              if (!refit()) setTimeout(() => poll(attempts + 1), 50);
            });
          };
          this.$nextTick(() => poll());
        }
      });
      // Also re-fit when switching to the terminal sub-panel on mobile
      this.$watch('workspacePanel', v => {
        if (v === 'terminal' && this._terminalXterm?._addonFit) {
          requestAnimationFrame(() => {
            this._terminalXterm._addonFit.fit();
            if (this._terminalWs?.readyState === WebSocket.OPEN) {
              this._terminalWs.send(JSON.stringify({ type: 'resize', cols: this._terminalXterm.cols, rows: this._terminalXterm.rows }));
            }
          });
        }
      });
      // Dynamic browser tab title
      const updateTitle = () => { document.title = `${this.projectName} | GOAT Flow`; };
      this.$watch('projectPath', updateTitle);
      updateTitle();
      // Sync initial state (anti-FOUC script may have added 'dark' before Alpine)
      document.documentElement.classList.toggle('dark', this.darkMode);
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        this.runScan();
        this.loadConfig();
        this.checkTerminalAvailable();
        this._loadFavoritesFromConfig();
        // Detect installed agents
        fetch('/api/agents/installed').then(r => r.json()).then(data => {
          this.allAgents = data.agents;
          this.installedAgents = data.agents.filter(a => a.installed);
          if (this.installedAgents.length > 0 && !this.installedAgents.find(a => a.id === this.activeRunner)) {
            this.activeRunner = this.installedAgents[0].id;
          }
        }).catch(() => {});
      }
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { this.showBrowser = false; }
        // Ctrl+Shift+D exits terminal view
        if (e.key === 'D' && e.ctrlKey && e.shiftKey && this.activeView === 'workspace' && this.terminalSessionId) { e.preventDefault(); this.exitTerminal(); return; }
        // "/" focuses search (when not in an input/textarea)
        if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          const searchInput = this.$refs.presetSearchInput;
          if (searchInput) { this.activeView = 'workspace'; this.$nextTick(() => searchInput.focus()); }
        }
      });
    },

    // -- API Calls --
    async runScan() {
      this.scanning = true; this.toast = '';
      try {
        const res = await fetch(`/api/scan?path=${encodeURIComponent(this.projectPath)}`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        this.report = data;
        this.selectedAgent = data.agents?.[0]?.agent || null;
        this.lastScanTime = new Date();
        if (!this.scanDetailAgent) { this.scanDetailAgent = data.agents?.[0]?.agent || null; }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg.includes('Failed to fetch') ? 'Server not running. Start with: goat-flow dashboard .' : msg, true);
      }
      this.scanning = false;
    },
    // -- Folder Browser --
    async openBrowser() { this.showBrowser = !this.showBrowser; if (this.showBrowser) await this.browseTo(this.projectPath); },
    async browseTo(path) {
      try {
        const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (data.error) { this.showToast(data.error, true); return; }
        this.browserCurrent = data.current; this.browserParent = data.parent; this.browserDirs = data.dirs;
      } catch { this.showToast('Browse failed', true); }
    },
    selectDir(dir) {
      if (dir.isProject) { this.projectPath = dir.path; this.showBrowser = false; this.runScan(); }
      else this.browseTo(dir.path);
    },

    // -- Config/Settings --
    async loadConfig() {
      try {
        const res = await fetch(`/api/config?path=${encodeURIComponent(this.projectPath)}`);
        const data = await res.json();
        if (data.error) { this.showToast(data.error, true); return; }
        if (data.note) {
          this.configNote = data.note;
          this.configYaml = '';
          this.localConfigYaml = this._localConfigPlaceholder;
        } else {
          this.configNote = '';
          this.configYaml = data.config || '';
          this.localConfigYaml = data.localConfig || this._localConfigPlaceholder;
        }
        this.configDirty = false;
        this._parseUserRole();
      } catch { this.showToast('Failed to load config', true); }
    },
    _parseUserRole() {
      const valid = ['developer', 'investigator', 'tester'];
      const match = (this.localConfigYaml || '').match(/^\s*userRole:\s*(\w+)/m);
      this.userRole = (match && valid.includes(match[1])) ? match[1] : '';
    },
    async saveLocalConfig() {
      try {
        const res = await fetch(`/api/config/local?path=${encodeURIComponent(this.projectPath)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: this.localConfigYaml }),
        });
        const data = await res.json();
        if (data.error) { this.showToast(data.error, true); return; }
        this.configDirty = false;
        // saved successfully - no toast needed
      } catch { this.showToast('Failed to save config', true); }
    },
    async resetLocalConfig() {
      try {
        const res = await fetch(`/api/config/local?path=${encodeURIComponent(this.projectPath)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: this._localConfigPlaceholder }),
        });
        const data = await res.json();
        if (data.error) { this.showToast(data.error, true); return; }
        this.localConfigYaml = this._localConfigPlaceholder;
        this.configDirty = false;
        this._parseUserRole();
      } catch { this.showToast('Failed to reset config', true); }
    },

    // -- Wizard --
    async detectStack() {
      this.wizardDetecting = true;
      try {
        const res = await fetch(`/api/setup/detect?path=${encodeURIComponent(this.projectPath)}`);
        const data = await res.json();
        if (data.error) { this.showToast(data.error, true); this.wizardDetecting = false; return; }
        this.wizardData.languages = data.languages || [];
        this.wizardData.frameworks = data.frameworks || [];
        this.wizardData.commands = data.commands || { test: '', lint: '', build: '', format: '' };
        this.wizardData.agents = data.agents || { claude: true, codex: false, gemini: false, copilot: false };
        if (!Object.values(this.wizardData.agents).some(v => v)) this.wizardData.agents.claude = true;
        this.wizardData.existing = data.existing || { skills: false, instructions: false, evals: false, lessons: false, footguns: false, config: false };
        this.wizardData.nonGoatFlow = data.nonGoatFlow || [];
      } catch (err) {
        this.showToast(err.message || 'Detection failed', true);
      }
      this.wizardDetecting = false;
    },
    async generateWizardSetup() {
      this.wizardGenerating = true;
      this.wizardSetupOutputs = {};
      const agent = this.wizardSelectedAgent;
      try {
        const res = await fetch(`/api/setup?path=${encodeURIComponent(this.projectPath)}&agent=${agent}`);
        const data = await res.json();
        if (data.error) { this.showToast(`${agent}: ${data.error}`, true); }
        else { this.wizardSetupOutputs[agent] = data.output || 'No output generated.'; }
      } catch (err) {
        this.showToast(err.message || 'Generation failed', true);
      }
      this.wizardGenerating = false;
    },

    // -- Clipboard + Toast --
    copyText(text) {
      const el = document.createElement('textarea'); el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
      document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
      this.copyLabel = 'Copied!'; setTimeout(() => this.copyLabel = 'Copy', 2000);
    },
    showToast(msg, isError) { this.toast = msg; this.toastError = isError; setTimeout(() => this.toast = '', 4000); },

    // -- Fix prompts --
    buildFixPrompt(rec) {
      return `Fix ${rec.checkId} (${rec.category}): ${rec.action}\n\nVerify: goat-flow scan ${this.projectPath} --agent ${this.selectedAgent}`;
    },
    copyFixPrompt(rec) {
      this.copyText(this.buildFixPrompt(rec));
      // copied - button gives inline feedback
    },

    // -- Terminal --
    async checkTerminalAvailable() {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          this.availableRunners = data.availableRunners || [];
          this.terminalAvailable = data.nodePtyAvailable && this.availableRunners.length > 0;
          if (this.availableRunners.length > 0) this.activeRunner = this.availableRunners[0];
        }
      } catch { this.terminalAvailable = false; }
    },
    async loadXterm() {
      if (this._xtermLoaded) return;
      await new Promise((resolve, reject) => {
        const link = document.createElement('link'); link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css';
        document.head.appendChild(link);
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js';
        script.onerror = reject;
        const timer = setTimeout(() => reject(new Error('xterm.js load timeout')), 5000);
        script.onload = () => { clearTimeout(timer); resolve(); };
        document.head.appendChild(script);
      });
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js';
        const timer = setTimeout(() => reject(new Error('fit addon load timeout')), 5000);
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = reject;
        document.head.appendChild(script);
      });
      this._xtermLoaded = true;
    },
    async launchPreset(prompt, runner) {
      if (this.launching) return;
      const preset = this.presets.find(p => this.adaptPrompt(p.prompt) === this.adaptPrompt(prompt));
      this.lastRunPrompt = preset?.name || 'Custom prompt';
      this.lastRunAgent = runner || this.activeRunner;
      if (preset) this.promptRunStates[preset.id] = 'running';
      let adapted = this.adaptPrompt(prompt);
      if (this.userRole === 'investigator') {
        adapted = 'You are in investigator mode. Read-only - investigate, plan, and review only. Do NOT make any code changes.\n\n' + adapted;
      } else if (this.userRole === 'tester') {
        adapted = 'You are in tester mode. Test-focused - generate test plans, verify coverage, run QA analysis. Do NOT make code changes beyond test files.\n\n' + adapted;
      }
      await this.launchInTerminal(adapted, runner || this.activeRunner);
    },
    async launchInTerminal(prompt, runner = 'claude') {
      if (this.terminalSessionId && !this.terminalEnded) {
        this.showToast('A session is already running. Exit it first.', true);
        return;
      }
      this.launching = true;
      try {
        // launching - button shows "Starting..." state
        await this.loadXterm();
        const res = await fetch('/api/terminal/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, projectPath: this.projectPath, runner }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        this.terminalSessionId = data.id;
        this.terminalEnded = false;
        this.activeView = 'workspace';
        this.workspacePanel = 'terminal';
        await this.$nextTick();
        this.connectTerminal(data.wsUrl);
      } catch (err) {
        this.showToast(err.message || 'Failed to launch', true);
      }
      this.launching = false;
    },
    connectTerminal(wsUrl) {
      const container = this.$refs.terminalContainer;
      if (!container) return;
      container.innerHTML = '';
      const term = new window.Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: { background: '#0f1729', foreground: '#f3f4f6', cursor: '#f3f4f6' },
      });
      const fitAddon = new window.FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      term._addonFit = fitAddon;
      this._terminalXterm = term;
      const doFit = () => {
        if (!container.offsetWidth) return;
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };
      setTimeout(doFit, 50);
      setTimeout(doFit, 200);
      setTimeout(doFit, 500);
      const ro = new ResizeObserver(() => { doFit(); });
      ro.observe(container);
      const resizeHandler = () => { doFit(); };
      window.addEventListener('resize', resizeHandler);
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}${wsUrl}`);
      this._terminalWs = ws;
      ws.onopen = () => {
        this.terminalConnected = true;
        setTimeout(doFit, 50);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'output') term.write(msg.data);
          else if (msg.type === 'exit') {
            this.terminalEnded = true; this.terminalConnected = false;
            const runningId = Object.entries(this.promptRunStates).find(([_, s]) => s === 'running')?.[0];
            if (runningId) this.promptRunStates[runningId] = 'pass';
          }
          else if (msg.type === 'error') { term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`); }
          else if (msg.type === 'shutdown') { this.terminalEnded = true; this.terminalConnected = false; }
        } catch { /* ignore malformed messages */ }
      };
      ws.onclose = () => { this.terminalConnected = false; if (!this.terminalEnded) this.terminalEnded = true; };
      ws.onerror = () => { this.terminalConnected = false; };
      term.attachCustomKeyEventHandler(e => {
        if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
          navigator.clipboard.readText().then(text => {
            if (text && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: text }));
          }).catch(() => {});
          return false;
        }
        if (e.type === 'keydown' && e.ctrlKey && e.key === 'c' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          return false;
        }
        return true;
      });
      term.onData(data => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
      });
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      });
      this._terminalCleanup = () => {
        ro.disconnect();
        window.removeEventListener('resize', resizeHandler);
        try { ws.close(); } catch {}
        try { term.dispose(); } catch {}
        this._terminalWs = null;
        this._terminalXterm = null;
      };
      term.focus();
    },
    exitTerminal() {
      const runningId = Object.entries(this.promptRunStates).find(([_, s]) => s === 'running')?.[0];
      if (runningId) this.promptRunStates[runningId] = 'pass';
      if (this.terminalSessionId && !this.terminalEnded) {
        fetch(`/api/terminal/${this.terminalSessionId}`, { method: 'DELETE' }).catch(() => {});
      }
      if (this._terminalCleanup) { this._terminalCleanup(); this._terminalCleanup = null; }
      this.terminalSessionId = null;
      this.terminalConnected = false;
      this.terminalEnded = false;
      this.lastRunPrompt = null;
      this.lastRunAgent = null;
    },

    // -- Computed Properties --
    get currentAgent() { return this.report?.agents?.find(a => a.agent === (this.scanDetailAgent || this.selectedAgent)) || null; },
    get triggeredAPs() { return this.currentAgent?.antiPatterns?.filter(ap => ap.triggered) || []; },

    // -- Helpers --
    gradeColor(grade) { return { A: '#4ade80', B: '#facc15', C: '#fb923c', D: '#f87171', F: '#f87171', 'insufficient-data': '#71717a' }[grade] || '#71717a'; },
    formatTimeAgo(date) {
      if (!date) return '';
      const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
      if (s < 60) return 'just now';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    },
  };
}
