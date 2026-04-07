# CopilotSwarm

Orchestrate multiple GitHub Copilot agents in a sequential, hierarchical workflow. Define a research specialist, an architect, and a coder, and let them solve complex tasks by passing context from one to another.

All processing is done **natively** through the official VS Code Language Model API. No external APIs, no extra costs beyond your Copilot subscription.

## Features
- **Hierarchical Swarms**: Run agents in order. Each agent reads what the previous one produced.
- **Dynamic Model Selection**: Select any model authorized in your subscription (GPT-4o, Claude 3.5, etc.).
- **Security System**: Set a global token budget. The swarm auto-stops if you exceed your limit.
- **Persistent Metrics**: Track your total usage across VS Code sessions.
- **Fully Customizable**: Edit system prompts and agent roles on the fly.

## Development & Installation

Since this is a developer-focused tool and not yet on the Marketplace, you need to compile and install it manually.

### 1. Requirements
- **VS Code 1.90+**
- **Node.js** & **npm**
- An active **GitHub Copilot** subscription (and be logged in within VS Code).

### 2. Setup & Compilation
Clone the repository, install dependencies, and build the project:

```bash
# Install dependencies
npm install

# Compile the TypeScript code
npm run build
```

### 3. Manual Installation (VSIX)
To use the extension in your daily VS Code instance, you can package it into a `.vsix` file and install it:

1. **Package the extension**:
   ```bash
   npm run package
   ```
   This will generate a file named `copilot-swarm-control-X.X.X.vsix` in the root folder.

2. **Install to VS Code**:
   - Open VS Code.
   - Go to the **Extensions** view (`Ctrl+Shift+X`).
   - Click the "..." (More Actions) menu at the top right of the Extensions view.
   - Select **Install from VSIX...**.
   - Pick the `.vsix` file you just generated.

### 4. Running for Development
If you just want to test or modify the code:
- Open the project folder in VS Code.
- Press `F5` to open a new "Extension Development Host" window with the extension active.

## How to Use
1. Open the command palette (`Ctrl+Shift+P`).
2. Search for **"Open Swarm Control Panel"**.
3. (Optional) Click **Connect GitHub** to sync your account and start tracking usage.
4. Define your **Global Swarm Objective**.
5. Configure your agents' **System Prompts** (roles).
6. Click **Run Hierarchy** and watch them collaborate!

---
*Created with focus on privacy and efficiency. No data leaves your machine except for the standard Copilot API calls.*
