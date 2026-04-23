import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';
import { TaskType, SwarmMode, AgentRole, PipelineState, TASK_TYPE_META } from './types';

export class SwarmEngine {
  private _isStopped = false;

  constructor(private readonly _store: AgentStore) {}

  // ── Smart Auto-Mode Detection ──
  public resolveMode(input: string, preferredMode: SwarmMode): 'quick' | 'deep' {
    if (preferredMode === 'quick') return 'quick';
    if (preferredMode === 'deep') return 'deep';

    // Auto-detection heuristics
    const wordCount = input.trim().split(/\s+/).length;
    const complexKeywords = [
      'refactor', 'migrate', 'system', 'authentication', 'auth',
      'architecture', 'redesign', 'rewrite', 'from scratch',
      'logic', 'security', 'multi-file', 'integration', 'module',
      'new feature', 'setup', 'everything'
    ];
    // Threshold reduced to 50 words for better detection
    const isComplex = wordCount > 50 || complexKeywords.some(k => input.toLowerCase().includes(k));
    return isComplex ? 'deep' : 'quick';
  }

  // ── Main Entry Point ──
  public async run(
    objective: string,
    taskType: TaskType,
    mode: SwarmMode,
    onChunk?: (agentId: string, chunk: string) => void,
    onAction?: (action: { type: 'pending', path: string, content: string }) => void,
    onPhaseChange?: (pipeline: PipelineState) => void,
  ) {
    this._isStopped = false;
    this._store.resetAll();

    const resolvedMode = this.resolveMode(objective, mode);
    const context = await this._getWorkspaceContext();
    const taskMeta = TASK_TYPE_META[taskType];

    // Build task-specific system prompt prefix
    const taskPrefix = `[TASK MODE: ${taskMeta.label.toUpperCase()}]\n${taskMeta.description}\n\n`;
    const fullObjective = taskPrefix + objective;

    // Track deep mode usage for budget warnings
    if (resolvedMode === 'deep') {
      this._store.incrementDeepMode();
    } else {
      this._store.resetDeepMode();
    }

    const pipeline: PipelineState = {
      phase: 'idle',
      mode: resolvedMode,
      taskType,
      activeAgents: [],
      completedAgents: [],
    };

    if (resolvedMode === 'quick') {
      await this._runQuickMode(fullObjective, context, pipeline, onChunk, onAction, onPhaseChange);
    } else {
      await this._runDeepMode(fullObjective, context, pipeline, onChunk, onAction, onPhaseChange);
    }
  }

  // ── Quick Mode: Planner+Coder combined → Arbitrator review ──
  private async _runQuickMode(
    objective: string, context: string,
    pipeline: PipelineState,
    onChunk?: (agentId: string, chunk: string) => void,
    onAction?: (action: { type: 'pending', path: string, content: string }) => void,
    onPhaseChange?: (pipeline: PipelineState) => void,
  ) {
    const allActions: { path: string, content: string }[] = [];

    // Phase 1: Planner + Coder combined
    // In quick mode, output streams to the coder's agentId - so activeAgents = ['coder']
    // to ensure the UI auto-switches to the right output panel
    pipeline.phase = 'coding';
    pipeline.activeAgents = ['coder'];
    this._store.patchByRole('architect', { status: 'skipped' });
    if (onPhaseChange) onPhaseChange({ ...pipeline });

    const combinedPrompt = 
      `You are a Senior Full-Stack Developer. Plan AND implement the solution in one pass.\n` +
      `First, briefly outline your approach, then write the code immediately.\n` +
      `DO NOT ask for permission. DO NOT say "I will now do X". Just provide the [WRITE_FILE] blocks.\n`;

    const plannerAgent = this._store.getByRole('planner')!;
    const coderAgent = this._store.getByRole('coder')!;
    
    // Use coder's ID for streaming but combined prompt
    this._store.patch(plannerAgent.id, { status: 'running' });
    this._store.patch(coderAgent.id, { status: 'running' });

    const coderResult = await this._runAgent(
      coderAgent.id, coderAgent.modelId,
      combinedPrompt + (coderAgent.systemPrompt || ''), 
      objective, context, '', onChunk
    );
    
    this._store.patch(plannerAgent.id, { status: 'success', lastResponse: '(Combined with Coder in Quick Mode)' });

    // Parse actions from coder
    const coderActions = await this._parsePendingActions(coderResult);
    for (const action of coderActions) {
      this._upsertAction(allActions, action);
      if (onAction) onAction({ type: 'pending', ...action });
    }

    pipeline.completedAgents = ['planner', 'coder'];
    pipeline.activeAgents = ['arbitrator'];

    // Phase 2: Quick Arbitrator review
    pipeline.phase = 'arbitrating';
    if (onPhaseChange) onPhaseChange({ ...pipeline });

    const arbAgent = this._store.getByRole('arbitrator')!;
    const arbResult = await this._runAgent(
      arbAgent.id, arbAgent.modelId,
      `AUTONOMOUS REVIEW: Briefly check for critical bugs. If you see an issue, fix it immediately using [WRITE_FILE]. If not, just give a 1-line summary. NO small talk.\n` + (arbAgent.systemPrompt || ''),
      objective, context,
      `\n--- CODER OUTPUT ---\n${coderResult}\n---`,
      onChunk
    );

    const arbActions = await this._parsePendingActions(arbResult);
    for (const action of arbActions) {
      this._upsertAction(allActions, action);
      if (onAction) onAction({ type: 'pending', ...action });
    }

    pipeline.completedAgents.push('arbitrator');
    pipeline.activeAgents = [];
    pipeline.phase = 'done';
    pipeline.summary = this._extractSummary(arbResult);
    if (onPhaseChange) onPhaseChange({ ...pipeline });
  }

  // ── Deep Mode: Planner → Architect → Coder → Arbitrator ──
  private async _runDeepMode(
    objective: string, context: string,
    pipeline: PipelineState,
    onChunk?: (agentId: string, chunk: string) => void,
    onAction?: (action: { type: 'pending', path: string, content: string }) => void,
    onPhaseChange?: (pipeline: PipelineState) => void,
  ) {
    const allActions: { path: string, content: string }[] = [];
    let history = context ? `\n--- SOURCE CONTEXT ---\n${context}\n---\n` : '';

    const roles: AgentRole[] = ['planner', 'architect', 'coder', 'arbitrator'];
    const phaseMap: Record<AgentRole, PipelineState['phase']> = {
      planner: 'planning', architect: 'architecting', coder: 'coding', arbitrator: 'arbitrating'
    };

    for (const role of roles) {
      if (this._isStopped) break;

      const agent = this._store.getByRole(role)!;
      pipeline.phase = phaseMap[role];
      pipeline.activeAgents = [role];
      if (onPhaseChange) onPhaseChange({ ...pipeline });

      const result = await this._runAgent(
        agent.id, agent.modelId, agent.systemPrompt,
        objective, '', history, onChunk
      );

      const actions = await this._parsePendingActions(result);
      for (const action of actions) {
        this._upsertAction(allActions, action);
        if (onAction) onAction({ type: 'pending', ...action });
      }

      history += `\n\n--- ${agent.name.toUpperCase()} OUTPUT ---\n${result}\n---`;
      pipeline.completedAgents.push(role);
    }

    pipeline.activeAgents = [];
    pipeline.phase = this._isStopped ? 'error' : 'done';

    const arbAgent = this._store.getByRole('arbitrator');
    pipeline.summary = arbAgent?.lastResponse ? this._extractSummary(arbAgent.lastResponse) : 'Completed.';
    if (onPhaseChange) onPhaseChange({ ...pipeline });
  }

  // ── Apply file edits to workspace ──
  public async applyEdits(edits: { path: string, content: string }[]) {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const ws = vscode.workspace.workspaceFolders;
    if (!ws) return;

    for (const edit of edits) {
      const normalizedPath = edit.path.replace(/\\/g, '/');
      const uri = vscode.Uri.joinPath(ws[0].uri, normalizedPath);
      workspaceEdit.createFile(uri, { overwrite: true, ignoreIfExists: true });
      workspaceEdit.replace(uri, new vscode.Range(0, 0, 1000000, 0), edit.content);
    }

    await vscode.workspace.applyEdit(workspaceEdit);
    vscode.window.showInformationMessage(`✅ Applied ${edits.length} swarm changes.`);
  }

  public async stopAll() {
    this._isStopped = true;
    this._store.all().forEach(a => this._store.patch(a.id, { status: 'idle' }));
  }

  // ── Budget warning check ──
  public shouldWarnBudget(): boolean {
    return this._store.getDeepModeCount() >= 3;
  }

  // ── Private Helpers ──

  private _upsertAction(actions: { path: string, content: string }[], action: { path: string, content: string }) {
    const idx = actions.findIndex(a => a.path === action.path);
    if (idx !== -1) actions[idx] = action;
    else actions.push(action);
  }

  private _extractSummary(text: string): string {
    // Try to find a SUMMARY section
    const match = text.match(/(?:SUMMARY|CONCLUSION|RESULT)[:\s]*\n?([\s\S]{10,300})/i);
    if (match) return match[1].trim();
    // Fallback: last 200 chars
    return text.length > 200 ? '...' + text.slice(-200).trim() : text.trim();
  }

  private async _getWorkspaceContext(): Promise<string> {
    let ctx = '';
    const ws = vscode.workspace.workspaceFolders;
    if (ws) {
      // 1. Workspace Structure (limit to 500 to save tokens, avoiding build dirs)
      ctx += '--- WORKSPACE STRUCTURE ---\n';
      try {
        const files = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/build/**,**/.next/**,**/.cache/**}', 500);
        ctx += files.map(f => vscode.workspace.asRelativePath(f)).sort().join('\n') + '\n\n';
      } catch { ctx += 'Could not load structure.\n\n'; }
    }

    const editor = vscode.window.activeTextEditor;
    const docs = vscode.workspace.textDocuments.filter(d => !d.isClosed && !d.fileName.includes('.git') && !d.fileName.includes('extension-output'));

    // 2. Active File Context (highest priority)
    if (editor && !editor.document.fileName.includes('extension-output')) {
      ctx += '--- ACTIVE DOCUMENT (Focus Here) ---\n';
      ctx += `File: ${vscode.workspace.asRelativePath(editor.document.uri)}\n`;
      let text = editor.document.getText();
      if (text.length > 10000) text = text.substring(0, 10000) + '\n... (truncated for length)';
      ctx += `\`\`\`${editor.document.languageId}\n${text}\n\`\`\`\n\n`;

      if (!editor.selection.isEmpty) {
        ctx += `--- USER SELECTION inside ${vscode.workspace.asRelativePath(editor.document.uri)} ---\n`;
        ctx += `\`\`\`${editor.document.languageId}\n${editor.document.getText(editor.selection)}\n\`\`\`\n\n`;
      }
    }

    // 3. Other Open Files Context
    const otherDocs = docs.filter(d => !editor || d.uri.toString() !== editor.document.uri.toString());
    if (otherDocs.length > 0) {
      ctx += '--- OTHER BACKGROUND FILES ---\n';
      for (const doc of otherDocs) {
        if (doc.languageId === 'Log') continue;
        let text = doc.getText();
        if (text.length > 3000) text = text.substring(0, 3000) + '\n... (truncated)';
        ctx += `File: ${vscode.workspace.asRelativePath(doc.uri)}\n\`\`\`${doc.languageId}\n${text}\n\`\`\`\n\n`;
      }
    }

    return ctx;
  }

  private async _parsePendingActions(text: string): Promise<{ path: string, content: string }[]> {
    const regex = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/gi;
    let match;
    const actions: { path: string, content: string }[] = [];
    while ((match = regex.exec(text)) !== null) {
      actions.push({ path: match[1].trim(), content: match[2].trim() });
    }
    return actions;
  }

  private async _runAgent(
    id: string, modelId: string, systemPrompt: string,
    objective: string, context: string, history: string,
    onChunk?: (agentId: string, chunk: string) => void,
  ): Promise<string> {
    const agent = this._store.all().find(a => a.id === id);
    if (!agent) return '';
    this._store.patch(id, { status: 'running', objective, lastResponse: '' });

    try {
      const authModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (!authModels || authModels.length === 0) {
        throw new Error("No Copilot models found. Ensure Copilot Chat is installed and authenticated.");
      }
      
      // The modelId in AgentStore is already synchronized with user settings
      const preferredModel = agent.modelId;
      const model = authModels.find(m => m.id === preferredModel) || authModels[0];
      
      let prompt = `Role: ${systemPrompt}\n\nObjective: ${objective}\n\n${context}${history}\n\n`;
      prompt += `!!! AUTONOMOUS DIRECTIVE !!!\n`;
      prompt += `1. DO NOT ask for permission. DO NOT say "I can help with that".\n`;
      prompt += `2. If files need changing, write them IMMEDIATELY using the [WRITE_FILE: path] format.\n`;
      prompt += `3. Be cold and efficient. No conversational filler. Avoid explaining what you will do, just do it.\n`;
      prompt += `4. If you finish, do not ask for the next step. Just output your result.\n\n`;
      prompt += `Format for file changes:\n[WRITE_FILE: relative/path/file.ext]\nContent\n[/WRITE_FILE]`;

      const request = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(prompt)],
        {},
        new vscode.CancellationTokenSource().token
      );

      let fullResponse = '';
      for await (const chunk of request.text) {
        if (this._isStopped) break;
        fullResponse += chunk;
        if (onChunk) onChunk(id, chunk);
      }

      this._store.incrementTotalTokens(Math.floor((fullResponse.length + prompt.length) / 4));
      this._store.patch(id, { status: 'success', lastResponse: fullResponse.trim() });
      return fullResponse.trim();
    } catch (err: any) {
      this._store.patch(id, { status: 'error', lastResponse: `Error: ${err.message}` });
      return '';
    }
  }
}
