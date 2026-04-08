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
    terminalSessionCount: 0,
    terminalAge: '',
    _ageInterval: null,
    _terminalStartTime: null,
    _lastInputTime: null,
    lastRunPrompt: null,
    selectedPreset: null,
    lastRunAgent: null,
    promptRunStates: {},
    launching: false,
    availableRunners: [],
    _terminalWs: null,
    _terminalXterm: null,
    _projectSessions: {},  // projectPath → { sessionId, startTime, prompt, agent }
    _xtermLoaded: false,

    // --- Projects state ---
    projectsList: [],
    projectsScanning: false,
    showAddProject: false,
    newProjectPath: '',

    // --- Rubrics state ---
    rubricChecks: [],
    antiPatterns: [],
    rubricFilter: 'all',
    rubricSearch: '',

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
      this._lastInputTime = Date.now();
      if (this._terminalXterm) this._terminalXterm.focus();
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
      // Dynamic browser tab title + terminal detach on project switch
      const updateTitle = () => { document.title = `${this.projectName} | GOAT Flow`; };
      this.$watch('projectPath', (newPath, oldPath) => {
        updateTitle();
        if (oldPath && newPath !== oldPath) {
          this.detachTerminal();
          this.reconnectTerminal();
          this.updateSessionCount();
        }
      });
      updateTitle();
      // Sync initial state (anti-FOUC script may have added 'dark' before Alpine)
      document.documentElement.classList.toggle('dark', this.darkMode);
      this._loadSavedProjects();
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        this.runScan();
        this.checkTerminalAvailable();
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

    // -- Projects --
    async addProject() {
      if (!this.newProjectPath) return;
      this.projectsList.push({ path: this.newProjectPath, state: '...', action: '...', details: 'Scanning...' });
      this.showAddProject = false;
      try {
        const res = await fetch(`/api/projects/status?paths=${encodeURIComponent(this.newProjectPath)}`);
        const data = await res.json();
        if (data.projects?.[0]) {
          const idx = this.projectsList.findIndex(p => p.path === this.newProjectPath);
          if (idx >= 0) this.projectsList[idx] = data.projects[0];
        }
      } catch { /* silent */ }
      this.newProjectPath = '';
      localStorage.setItem('goat-flow-projects', JSON.stringify(this.projectsList.map(p => p.path)));
    },
    removeProject(path) {
      this.projectsList = this.projectsList.filter(p => p.path !== path);
      localStorage.setItem('goat-flow-projects', JSON.stringify(this.projectsList.map(p => p.path)));
    },
    async scanAllProjects() {
      this.projectsScanning = true;
      try {
        const paths = this.projectsList.map(p => p.path).join(',');
        const res = await fetch(`/api/projects/status?paths=${encodeURIComponent(paths)}`);
        const data = await res.json();
        if (data.projects) this.projectsList = data.projects;
      } catch { /* silent */ }
      this.projectsScanning = false;
    },
    _loadSavedProjects() {
      try {
        const saved = JSON.parse(localStorage.getItem('goat-flow-projects') || '[]');
        if (saved.length > 0) {
          this.projectsList = saved.map(path => ({ path, state: '...', action: '...', details: 'Not scanned' }));
        }
      } catch { /* ignore */ }
    },

    // -- Rubrics --
    async loadRubrics() {
      try {
        const res = await fetch('/api/rubrics');
        const data = await res.json();
        this.rubricChecks = data.checks || [];
        this.antiPatterns = data.antiPatterns || [];
      } catch { this.showToast('Failed to load rubrics', true); }
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
      this.updateSessionCount();
    },
    async updateSessionCount() {
      try {
        const res = await fetch('/api/terminal/sessions');
        const data = await res.json();
        this.terminalSessionCount = data.activeCount || 0;
      } catch { /* ignore */ }
    },
    async endAllSessions() {
      try {
        const res = await fetch('/api/terminal/sessions');
        const data = await res.json();
        for (const session of (data.sessions || [])) {
          await fetch(`/api/terminal/${session.id}`, { method: 'DELETE' });
        }
        this._projectSessions = {};
        this.terminalSessionId = null;
        this.terminalEnded = true;
        this.terminalConnected = false;
        if (this._terminalCleanup) { this._terminalCleanup(); this._terminalCleanup = null; }
        await this.updateSessionCount();
        this.showToast('All sessions ended');
      } catch (err) {
        this.showToast('Failed to end sessions: ' + (err.message || ''), true);
      }
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
    detachTerminal() {
      // Flag prevents ws.onclose from setting terminalEnded during intentional detach
      this._detaching = true;
      // Save current session to project map before detaching
      if (this.terminalSessionId && !this.terminalEnded) {
        this._projectSessions[this.projectPath] = {
          sessionId: this.terminalSessionId,
          startTime: this._terminalStartTime,
          prompt: this.lastRunPrompt,
          agent: this.lastRunAgent,
        };
      }
      if (this._terminalCleanup) { this._terminalCleanup(); this._terminalCleanup = null; }
      if (this._ageInterval) { clearInterval(this._ageInterval); this._ageInterval = null; }
      this.terminalSessionId = null;
      this.terminalConnected = false;
      this.terminalEnded = false;
      this.terminalAge = '';
      this._terminalStartTime = null;
      this.lastRunPrompt = null;
      this.lastRunAgent = null;
      this.promptRunStates = {};
      this._detaching = false;
    },
    async reconnectTerminal() {
      const saved = this._projectSessions[this.projectPath];
      if (!saved) return false;
      // Verify session is still alive on the backend
      try {
        const res = await fetch('/api/terminal/sessions');
        const data = await res.json();
        const alive = (data.sessions || []).find(s => s.id === saved.sessionId);
        if (!alive) {
          delete this._projectSessions[this.projectPath];
          return false;
        }
      } catch { delete this._projectSessions[this.projectPath]; return false; }
      // Reconnect
      await this.loadXterm();
      this.terminalSessionId = saved.sessionId;
      this.terminalEnded = false;
      this._terminalStartTime = saved.startTime;
      this.lastRunPrompt = saved.prompt;
      this.lastRunAgent = saved.agent;
      this.activeView = 'workspace';
      this.workspacePanel = 'terminal';
      await this.$nextTick();
      this.connectTerminal(`/ws/terminal/${saved.sessionId}`);
      this.updateSessionCount();
      return true;
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
        this._terminalStartTime = Date.now();
        this._lastInputTime = Date.now();
        this.activeView = 'workspace';
        this.workspacePanel = 'terminal';
        await this.$nextTick();
        this.connectTerminal(data.wsUrl);
        this.updateSessionCount();
      } catch (err) {
        const msg = err.message || 'Failed to launch';
        if (msg.includes('Maximum') || msg.includes('concurrent')) {
          this.showToast('Maximum 3 sessions reached. End an existing session first.', true);
        } else {
          this.showToast(msg, true);
        }
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
        // Start session age ticker
        if (this._ageInterval) clearInterval(this._ageInterval);
        this._ageInterval = setInterval(() => {
          if (!this.terminalSessionId || this.terminalEnded) {
            clearInterval(this._ageInterval);
            this.terminalAge = '';
            return;
          }
          const elapsed = Math.floor((Date.now() - this._terminalStartTime) / 1000);
          const mins = Math.floor(elapsed / 60);
          const hrs = Math.floor(mins / 60);
          let age;
          if (hrs > 0) age = `Running ${hrs}h ${mins % 60}m`;
          else age = `Running ${mins}m`;
          // Idle timeout warning (60min server timeout)
          if (this._lastInputTime) {
            const idleSecs = Math.floor((Date.now() - this._lastInputTime) / 1000);
            const idleMins = Math.floor(idleSecs / 60);
            if (idleMins >= 58) {
              age = `Running ${mins}m | Timeout in ${60 - idleMins}m`;
            } else if (idleMins >= 50) {
              age += ` | Idle ${idleMins}m`;
            }
          }
          this.terminalAge = age;
        }, 30000);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'output') term.write(msg.data);
          else if (msg.type === 'exit') {
            this.terminalEnded = true; this.terminalConnected = false;
            delete this._projectSessions[this.projectPath];
            const runningId = Object.entries(this.promptRunStates).find(([_, s]) => s === 'running')?.[0];
            if (runningId) this.promptRunStates[runningId] = 'pass';
            this.updateSessionCount();
          }
          else if (msg.type === 'error') { term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`); }
          else if (msg.type === 'shutdown') { this.terminalEnded = true; this.terminalConnected = false; }
        } catch { /* ignore malformed messages */ }
      };
      ws.onclose = () => { this.terminalConnected = false; if (!this.terminalEnded && !this._detaching) this.terminalEnded = true; };
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
        this._lastInputTime = Date.now();
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
      // Remove from project sessions map
      delete this._projectSessions[this.projectPath];
      if (this._terminalCleanup) { this._terminalCleanup(); this._terminalCleanup = null; }
      if (this._ageInterval) { clearInterval(this._ageInterval); this._ageInterval = null; }
      this.terminalSessionId = null;
      this.terminalConnected = false;
      this.terminalEnded = false;
      this.terminalAge = '';
      this._terminalStartTime = null;
      this._lastInputTime = null;
      this.lastRunPrompt = null;
      this.lastRunAgent = null;
      this.updateSessionCount();
    },

    // -- Computed Properties --
    get currentAgent() { return this.report?.agents?.find(a => a.agent === (this.scanDetailAgent || this.selectedAgent)) || null; },
    get triggeredAPs() { return this.currentAgent?.antiPatterns?.filter(ap => ap.triggered) || []; },
    get filteredRubricChecks() {
      return this.rubricChecks.filter(c => {
        if (this.rubricFilter !== 'all' && c.tier !== this.rubricFilter) return false;
        if (this.rubricSearch && !c.name.toLowerCase().includes(this.rubricSearch.toLowerCase()) && !c.id.includes(this.rubricSearch)) return false;
        return true;
      });
    },
    get filteredAntiPatterns() {
      return this.antiPatterns.filter(ap => {
        if (this.rubricSearch && !ap.name.toLowerCase().includes(this.rubricSearch.toLowerCase()) && !ap.id.includes(this.rubricSearch)) return false;
        return true;
      });
    },

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
