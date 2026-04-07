import * as vscode from 'vscode';

export type AgentStatus = 'idle' | 'running' | 'success' | 'error' | 'stopped';

export interface AgentState {
  id: string;
  name: string;
  modelId: string;
  systemPrompt: string;
  objective: string;
  status: AgentStatus;
  lastResponse?: string;
  tokensUsed?: number;
}

export interface SwarmState {
  agents: AgentState[];
  objective: string;
  quota?: { 
    user: string; 
    used: number; 
    limit: number; // User-defined limit
    unit: string 
  } | null;
}

export interface AgentConfig {
  name: string;
  modelId: string;
  systemPrompt: string;
}
