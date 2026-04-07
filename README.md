# CopilotSwarm

Orchestrate multiple GitHub Copilot agents in a sequential, hierarchical workflow. Define a research specialist, an architect, and a coder, and let them solve complex tasks by passing context from one to another.

All processing is done **natively** through the official VS Code Language Model API. No external APIs, no extra costs beyond your Copilot subscription.

## Features
- **Hierarchical Swarms**: Run agents in order. Each agent reads what the previous one produced.
- **Dynamic Model Selection**: Select any model authorized in your subscription (GPT-4o, Claude 3.5, etc.).
- **Security System**: Set a global token budget. The swarm auto-stops if you exceed your limit.
- **Persistent Metrics**: Track your total usage across VS Code sessions.
- **Fully Customizable**: Edit system prompts and agent roles on the fly.

## Installation

### From the Marketplace
The easiest way to get started is to install **CopilotSwarm** directly from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ZendrYz.copilotswarm).

1. Open VS Code.
2. Go to the **Extensions** view (`Ctrl+Shift+X`).
3. Search for `CopilotSwarm`.
4. Click **Install**.

### Manual Installation (VSIX)
If you'd rather build it yourself or install the `.vsix` file:
1. Clone the repo.
2. Run `npm install` and `npm run build`.
3. Package it with `npx @vscode/vsce package`.
4. Install the resulting `.vsix` from the Extensions menu.

## Requirements
- **VS Code 1.90+**
- An active **GitHub Copilot** subscription (log in through VS Code).

## How to Use
1. Open the command palette (`Ctrl+Shift+P`).
2. Search for **"Open Swarm Control Panel"**.
3. Define your **Global Swarm Objective**.
4. Configure your agents' **System Prompts** (roles).
5. Click **Run Hierarchy** and watch them collaborate!

---
*Created by [ZendrYz](https://github.com/ZendrYz). Focus on privacy and efficiency. No data leaves your machine except for the standard Copilot API calls.*
