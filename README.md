# Copilot PX 🎮

Playful pixel-art visualizer for GitHub Copilot activity in VS Code.

Two pixel characters react live as Copilot works — the purple bot thinks, fires token beams, celebrates accepted suggestions, and sulks on rejections. XP, levels, accept rate — all tracked.

## Setup

```bash
npm install
npm run compile
```

Then press **F5** in VS Code to open the Extension Development Host.

The **Copilot PX** icon appears in the Activity Bar (left sidebar). Click it to open the panel.

## How it works

- Watches `onDidChangeTextDocument` for typing pauses (~400ms)
- After a pause → triggers "thinking" animation (Copilot likely firing)
- Large text insertions → treated as accepted suggestions
- Manual **TAB** / **ESC** buttons in the panel as fallback

## Publish to Marketplace

```bash
npm install -g @vscode/vsce
vsce package          # creates copilot-px-0.1.0.vsix
vsce publish          # needs Personal Access Token from marketplace.visualstudio.com
```

## Roadmap ideas
- [ ] Sound effects (8-bit beeps on accept/reject)
- [ ] Streak counter + combo multiplier
- [ ] Different character skins unlockable at levels
- [ ] Daily/weekly stats chart
- [ ] Latency display (ms per suggestion)
