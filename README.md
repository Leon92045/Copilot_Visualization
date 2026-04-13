# Code Quest 🚀

A playful pixel-art game that lives in your VS Code sidebar and visualizes your coding activity in real time.

Every keystroke fires a laser from your spaceship. Every new line deals damage. Defeat enemies by writing code — new monsters appear as you hit goals like 10 lines, 50 lines, 100 keystrokes, and longer sessions.

---

## How it works

- **Keystrokes** → laser fires, deals 1 damage to the current enemy
- **New line** → heavier hit, deals 5 damage
- **Goal reached** (lines written, keystrokes, session time) → new enemy spawns
- **Enemy defeated** → next monster appears automatically
- **Streak** → tracked across sessions, saved permanently

### Enemy progression

| Enemy    | HP  | Unlocked at        |
|----------|-----|--------------------|
| Slime    | 20  | start              |
| Goblin   | 50  | 100 keystrokes     |
| Skeleton | 70  | 10 lines           |
| Orc      | 90  | 500 keystrokes     |
| Knight   | 120 | 25 lines           |
| Vampire  | 150 | 50 lines           |
| Wizard   | 180 | 1000 keystrokes    |
| Golem    | 250 | 100 lines          |
| Demon    | 280 | 10 min session     |
| Dragon   | 350 | 200 lines          |
| Lich     | 400 | 30 min session     |
| Titan    | 500 | 3 files open       |

---

## Local setup

```bash
git clone https://github.com/your-username/Copilot_Visualization.git
cd Copilot_Visualization
npm install
npm run compile
```

Open the folder in VS Code and press **F5** — a new Extension Development Host window opens. Click the **Code Quest** icon in the Activity Bar to open the panel, then start coding.

---

## Auto-publish via GitHub Actions

Every push to `main` that touches `src/`, `package.json`, or `media/` automatically:

1. Compiles TypeScript
2. Bumps the patch version
3. Publishes to the VS Code Marketplace

### One-time setup

**1. Create a publisher** at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and update `package.json`:
```json
"publisher": "your-publisher-name"
```

**2. Create a Marketplace token** at [dev.azure.com](https://dev.azure.com):
- Scope: **Marketplace → Manage**
- Organization: **All accessible organizations**

**3. Add the token as a GitHub secret**:
- Repo → Settings → Secrets → Actions → New secret
- Name: `VSCE_TOKEN`, Value: your token

After that, `git push` is all you need.

---

## Manual publish

```bash
npx vsce package    # builds a .vsix file
npx vsce publish    # publishes to Marketplace
```

---

## Roadmap

- [ ] 8-bit sound effects on hit / enemy death
- [ ] Boss enemies with attack animations
- [ ] Weekly stats chart
- [ ] Different ship skins per language
- [ ] Combo multiplier for rapid coding