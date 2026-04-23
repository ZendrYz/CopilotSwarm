import * as vscode from 'vscode';
import { AgentState, AgentRole, SwarmConfig, DEFAULT_CONFIG } from './types';

const ROLE_DEFAULTS: Record<AgentRole, { name: string; systemPrompt: string; defaultModel: string }> = {
  planner: {
    name: 'Planner',
    defaultModel: 'gpt-4.1',
    systemPrompt: `You are the Swarm Planner. Break the task into discrete, logical steps. Identify exactly which files are impacted. Output ONLY the technical plan. No conversational filler.`,
  },
  architect: {
    name: 'Architect',
    defaultModel: 'gpt-4.1',
    systemPrompt: `You are the Swarm Architect. Define data structures, API contracts, and logic flow based on the plan. Be precise and technical. No preamble.`,
  },
  coder: {
    name: 'Coder',
    defaultModel: 'gpt-4.1',
    systemPrompt: `You are the Swarm Coder. Implement the architecture now. You HAVE write permission. For every change, use: [WRITE_FILE: path]...[/WRITE_FILE]. Zero talk, 100% code.`,
  },
  arbitrator: {
    name: 'Arbitrator',
    defaultModel: 'claude-sonnet-4.6',
    systemPrompt: `You are the Swarm Arbitrator. Verify the solution against the objective. If any file is buggy or missing, rewrite it immediately with [WRITE_FILE: path]. End with a summary of changes.`,
  },
};

export class AgentStore {
  private _agents: AgentState[] = [];
  private _totalTokens: number = 0;
  private _config: SwarmConfig = { ...DEFAULT_CONFIG };
  private _deepModeCount: number = 0; // Track consecutive deep mode uses
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private readonly _context: vscode.ExtensionContext) {
    this._load();
  }

  // ── Agent Access ──
  public all(): AgentState[] { return [...this._agents]; }
  public getByRole(role: AgentRole): AgentState | undefined { return this._agents.find(a => a.role === role); }

  // ── Token Tracking ──
  public getTotalTokens(): number { return this._totalTokens; }
  public getTokenLimit(): number { return this._config.tokenBudget; }
  public setTokenLimit(limit: number) { this._config.tokenBudget = limit; this._save(); }
  public incrementTotalTokens(amount: number) { this._totalTokens += amount; this._save(); }

  // ── Config ──
  public getConfig(): SwarmConfig { return { ...this._config }; }
  public updateConfig(patch: Partial<SwarmConfig>) {
    this._config = { ...this._config, ...patch };
    this._refreshAgents();
    this._save();
  }

  private _refreshAgents() {
    this._agents.forEach(agent => {
      const def = ROLE_DEFAULTS[agent.role];
      if (agent.role === 'planner' || agent.role === 'architect') {
        // plannerModel applies to planner and architect only
        agent.modelId = this._config.plannerModel || (def?.defaultModel ?? 'gpt-4.1');
      } else if (agent.role === 'coder') {
        agent.modelId = this._config.coderModel || (def?.defaultModel ?? 'gpt-4.1');
      } else if (agent.role === 'arbitrator') {
        // Arbitrator always keeps its own default (claude-sonnet-4.6) unless explicitly overridden
        // It is NOT affected by plannerModel - it has the best model by design
        agent.modelId = def?.defaultModel ?? 'claude-sonnet-4.6';
      }
    });
  }

  // ── Deep Mode Counter ──
  public getDeepModeCount(): number { return this._deepModeCount; }
  public incrementDeepMode() { this._deepModeCount++; this._save(); }
  public resetDeepMode() { this._deepModeCount = 0; this._save(); }

  // ── Patch Agent ──
  public patch(id: string, patch: Partial<AgentState>) {
    const idx = this._agents.findIndex(a => a.id === id);
    if (idx !== -1) {
      this._agents[idx] = { ...this._agents[idx], ...patch };
      this._save();
    }
  }

  public patchByRole(role: AgentRole, patch: Partial<AgentState>) {
    const agent = this._agents.find(a => a.role === role);
    if (agent) this.patch(agent.id, patch);
  }

  // ── Reset All Agents ──
  public resetAll() {
    this._agents.forEach(a => {
      a.status = 'idle';
      a.lastResponse = '';
      a.tokensUsed = 0;
    });
    this._save();
  }

  // ── Persistence ──
  private _load() {
    this._totalTokens = this._context.globalState.get<number>('swarm.totalTokens', 0);
    this._deepModeCount = this._context.globalState.get<number>('swarm.deepModeCount', 0);
    
    const savedConfig = this._context.globalState.get<SwarmConfig>('swarm.config');
    if (savedConfig) this._config = { ...DEFAULT_CONFIG, ...savedConfig };

    // Create the fixed 4-agent setup
    this._agents = (Object.keys(ROLE_DEFAULTS) as AgentRole[]).map(role => {
      const def = ROLE_DEFAULTS[role];
      return {
        id: `agent-${role}`,
        role,
        name: def.name,
        modelId: def.defaultModel,
        systemPrompt: def.systemPrompt,
        objective: '',
        status: 'idle' as const,
      };
    });

    // Apply config to sync models
    this._refreshAgents();
  }

  private _save() {
    this._context.globalState.update('swarm.totalTokens', this._totalTokens);
    this._context.globalState.update('swarm.config', this._config);
    this._context.globalState.update('swarm.deepModeCount', this._deepModeCount);
    this._onDidChange.fire();
  }

  public dispose() {}
}
