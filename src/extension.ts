import * as vscode from 'vscode';
import { AgentStore } from './AgentStore';
import { SwarmEngine } from './SwarmEngine';
import { SwarmPanel } from './SwarmPanel';

export async function activate(context: vscode.ExtensionContext) {
  console.log('Copilot Swarm Control activated.');

  const store = new AgentStore(context);
  const engine = new SwarmEngine(store);

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-swarm.openPanel', () => {
      SwarmPanel.createOrShow(context.extensionUri, store, engine);
    })
  );

  context.subscriptions.push(store);

  // Auto-open on first run
  const firstRun = context.globalState.get<boolean>('copilot.firstRun', true);
  if (firstRun) {
    context.globalState.update('copilot.firstRun', false);
    SwarmPanel.createOrShow(context.extensionUri, store, engine);
  }
}

export function deactivate() {}
