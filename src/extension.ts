import * as vscode from 'vscode';

let panel: vscode.WebviewView | undefined;
let keystrokeTimer: NodeJS.Timeout | undefined;
let sessionTimer: NodeJS.Timeout | undefined;
let ctx: vscode.ExtensionContext;

const session = {
  keystrokes: 0,
  linesWritten: 0,
  sessionStart: Date.now(),
  filesEdited: new Set<string>(),
  languages: new Set<string>(),
};

function post(msg: object) { panel?.webview.postMessage(msg); }

function save(key: string, val: any) { ctx.globalState.update(key, val); }
function load<T>(key: string, def: T): T { return ctx.globalState.get<T>(key, def); }

function sessionDuration(): string {
  const ms = Date.now() - session.sessionStart;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function checkStreak() {
  const today = new Date().toDateString();
  const lastDay = load<string>('lastActiveDay', '');
  if (lastDay !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const streak = load<number>('streak', 0);
    save('streak', lastDay === yesterday ? streak + 1 : 1);
    save('lastActiveDay', today);
  }
}

// Goals that trigger a new enemy when reached
const GOALS = [
  { key: 'lines_10',   check: () => session.linesWritten >= 10,   label: '10 lines',    enemy: 'slime'   },
  { key: 'lines_25',   check: () => session.linesWritten >= 25,   label: '25 lines',    enemy: 'goblin'  },
  { key: 'lines_50',   check: () => session.linesWritten >= 50,   label: '50 lines',    enemy: 'knight'  },
  { key: 'lines_100',  check: () => session.linesWritten >= 100,  label: '100 lines',   enemy: 'wizard'  },
  { key: 'lines_200',  check: () => session.linesWritten >= 200,  label: '200 lines',   enemy: 'dragon'  },
  { key: 'keys_100',   check: () => session.keystrokes >= 100,    label: '100 keys',    enemy: 'slime'   },
  { key: 'keys_500',   check: () => session.keystrokes >= 500,    label: '500 keys',    enemy: 'goblin'  },
  { key: 'keys_1000',  check: () => session.keystrokes >= 1000,   label: '1000 keys',   enemy: 'knight'  },
  { key: 'session_10', check: () => (Date.now()-session.sessionStart) >= 600000,  label: '10 min',  enemy: 'wizard'  },
  { key: 'session_30', check: () => (Date.now()-session.sessionStart) >= 1800000, label: '30 min',  enemy: 'dragon'  },
  { key: 'files_3',    check: () => session.filesEdited.size >= 3, label: '3 files',   enemy: 'goblin'  },
];

const reachedGoals = new Set<string>();

function checkGoals() {
  for (const g of GOALS) {
    if (!reachedGoals.has(g.key) && g.check()) {
      reachedGoals.add(g.key);
      post({ type: 'newEnemy', enemy: g.enemy, label: g.label });
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  ctx = context;

  const provider = new PanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('copilotPx.panel', provider)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'file') return;
      const lang = e.document.languageId;
      session.filesEdited.add(e.document.fileName);
      session.languages.add(lang);
      checkStreak();

      for (const change of e.contentChanges) {
        const added = change.text.length;
        if (added > 0 && added < 80) {
          session.keystrokes += added;
          // each keystroke = hit on current enemy
          post({ type: 'hit', damage: 1, lang });
        }
        const newLines = (change.text.match(/\n/g) || []).length;
        if (newLines > 0) {
          session.linesWritten += newLines;
          // newline = bigger hit
          post({ type: 'hit', damage: 5, lang });
        }
      }

      checkGoals();

      clearTimeout(keystrokeTimer);
      keystrokeTimer = setTimeout(() => {
        post({
          type: 'stats',
          keystrokes: session.keystrokes,
          lines: session.linesWritten,
          files: session.filesEdited.size,
          sessionTime: sessionDuration(),
          streak: load<number>('streak', 0),
          totalKills: 0,
          lang,
        });
      }, 200);
    })
  );

  sessionTimer = setInterval(() => {
    post({ type: 'tick', sessionTime: sessionDuration() });
  }, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(sessionTimer) });

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      post({ type: 'fileSwitch', lang: editor.document.languageId, filename: editor.document.fileName.split('/').pop() });
    })
  );
}

class PanelProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}
  resolveWebviewView(webviewView: vscode.WebviewView) {
    panel = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getHTML();
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') {
        post({
          type: 'init',
          totalKills: 0,
          streak: load<number>('streak', 0),
        });
      }
      if (msg.type === 'enemyKilled') {
        post({ type: 'killConfirm' });
      }
    });
  }
}

function getHTML(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0;image-rendering:pixelated;}
body{background:transparent;color:#e0e0f0;font-family:'Courier New',monospace;font-size:11px;overflow:hidden;height:100vh;display:flex;flex-direction:column;}
@keyframes idle{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes hit{0%,100%{transform:translateX(0)}20%{transform:translateX(6px)}60%{transform:translateX(-6px)}}
@keyframes death{0%{transform:scale(1);opacity:1}50%{transform:scale(1.4) rotate(10deg);opacity:.5}100%{transform:scale(0);opacity:0}}
@keyframes appear{0%{transform:translateX(60px);opacity:0}100%{transform:translateX(0);opacity:1}}
@keyframes laser{0%{opacity:1;transform:scaleX(0)}30%{opacity:1;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1)}}
@keyframes floatup{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-30px)}}
@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes shake-screen{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
@keyframes star-scroll{0%{transform:translateY(-100%)}100%{transform:translateY(200px)}}
</style></head><body>

<!-- HUD -->
<div style="background:transparent;padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;align-items:center;">
  <span style="color:#7F77DD;font-size:11px;letter-spacing:.06em;">CODE <span style="color:#5DCAA5;">QUEST</span></span>
  <div style="display:flex;gap:10px;">
    <span style="font-size:10px;color:#E24B4A;">☠ <span id="kills-hud">0</span> kills</span>
    <span style="font-size:10px;color:#EF9F27;">⚡ <span id="streak-hud">0</span>d</span>
  </div>
</div>

<!-- BATTLE ARENA -->
<div id="arena" style="position:relative;flex:1;min-height:120px;background:transparent;overflow:hidden;border-bottom:1px solid rgba(255,255,255,.1);">

  <!-- stars -->
  <canvas id="stars-c" style="position:absolute;inset:0;pointer-events:none;"></canvas>

  <!-- ground line -->
  <div style="position:absolute;bottom:28px;left:0;right:0;height:2px;background:#1a1a3e;"></div>

  <!-- PLAYER (left) -->
  <div id="player-wrap" style="position:absolute;bottom:30px;left:14px;">
    <canvas id="player-spr" width="30" height="42" style="image-rendering:pixelated;"></canvas>
  </div>

  <!-- Laser beam (drawn between player and enemy) -->

  <!-- ENEMY (right) -->
  <div id="enemy-wrap" style="position:absolute;bottom:30px;right:14px;">
    <canvas id="enemy-spr" width="40" height="48"></canvas>
    <div id="enemy-name" style="text-align:center;font-size:8px;color:#aaaacc;margin-top:2px;"></div>
  </div>

  <!-- HP bar enemy -->
  <div style="position:absolute;top:8px;right:10px;width:90px;">
    <div style="font-size:8px;color:#a0a0c0;margin-bottom:3px;text-align:right;" id="enemy-label">waiting...</div>
    <div style="background:transparent;border:1px solid #2a2a4e;border-radius:2px;height:6px;">
      <div id="enemy-hp-bar" style="height:100%;background:#E24B4A;border-radius:2px;width:100%;transition:width .3s;"></div>
    </div>
    <div style="font-size:8px;color:#a0a0c0;margin-top:2px;text-align:right;"><span id="enemy-hp">—</span></div>
  </div>

  <!-- goal badge -->
  <div id="goal-badge" style="position:absolute;top:8px;left:8px;background:#7F77DD22;border:1px solid #7F77DD55;border-radius:3px;padding:2px 6px;font-size:8px;color:#9b95e8;opacity:0;transition:opacity .4s;">next goal</div>

  <!-- popups -->
  <div id="popups" style="position:absolute;inset:0;pointer-events:none;overflow:hidden;"></div>

</div>

<!-- Session bar -->
<div style="background:transparent;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #252530;">
  <div style="display:flex;align-items:center;gap:4px;">
    <div style="width:4px;height:4px;background:#5DCAA5;border-radius:1px;animation:blink 1s step-end infinite;"></div>
    <span id="session-time" style="color:#5DCAA5;font-size:11px;letter-spacing:.08em;">00:00</span>
  </div>
  <span style="color:#a0a0c0;font-size:10px;">lines <span id="lines-hud" style="color:#85B7EB;">0</span></span>
  <span style="color:#a0a0c0;font-size:10px;">keys <span id="keys-hud" style="color:#7F77DD;">0</span></span>
</div>

<!-- Stats -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:6px 8px;background:transparent;">
  <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:4px;padding:6px;text-align:center;">
    <div style="font-size:16px;font-weight:500;color:#5DCAA5;" id="st-lines">0</div>
    <div style="font-size:8px;color:#9090b0;margin-top:1px;">LINES WRITTEN</div>
  </div>
  <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:4px;padding:6px;text-align:center;">
    <div style="font-size:16px;font-weight:500;color:#E24B4A;" id="st-kills">0</div>
    <div style="font-size:8px;color:#9090b0;margin-top:1px;">ENEMIES DEFEATED</div>
  </div>
  <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:4px;padding:6px;text-align:center;">
    <div style="font-size:16px;font-weight:500;color:#7F77DD;" id="st-keys">0</div>
    <div style="font-size:8px;color:#9090b0;margin-top:1px;">KEYSTROKES</div>
  </div>
  <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:4px;padding:6px;text-align:center;">
    <div style="font-size:16px;font-weight:500;color:#85B7EB;" id="st-files">0</div>
    <div style="font-size:8px;color:#9090b0;margin-top:1px;">FILES</div>
  </div>
</div>

<!-- Next goal -->
<div style="padding:4px 8px 6px;background:transparent;">
  <div style="font-size:8px;color:#8080a0;letter-spacing:.05em;margin-bottom:4px;">NEXT GOAL</div>
  <div id="next-goal-bar" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:3px;height:6px;overflow:hidden;">
    <div id="next-goal-fill" style="height:100%;background:#534AB7;width:0%;transition:width .4s;border-radius:3px;"></div>
  </div>
  <div id="next-goal-label" style="font-size:9px;color:#a0a0c0;margin-top:3px;">— open a file to begin —</div>
</div>
<div style="padding:4px 8px 10px;background:transparent;border-top:1px solid #1c1c28;">
  <div style="font-size:8px;color:#8080a0;letter-spacing:.05em;margin-bottom:5px;">LANGUAGES</div>
  <div id="langs" style="display:flex;gap:4px;flex-wrap:wrap;min-height:18px;">
    <span style="font-size:9px;color:#8080a0;">— open a file —</span>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
const P = 4;

// ── Enemy definitions ─────────────────────────────────────────────────────
const ENEMIES = {
  slime:    { name:'Slime',    hp:20,  color:'#5DCAA5', points:10  },
  goblin:   { name:'Goblin',   hp:50,  color:'#639922', points:25  },
  skeleton: { name:'Skeleton', hp:70,  color:'#D3D1C7', points:35  },
  orc:      { name:'Orc',      hp:90,  color:'#854F0B', points:45  },
  knight:   { name:'Knight',   hp:120, color:'#85B7EB', points:60  },
  vampire:  { name:'Vampire',  hp:150, color:'#993556', points:75  },
  wizard:   { name:'Wizard',   hp:180, color:'#7F77DD', points:90  },
  golem:    { name:'Golem',    hp:250, color:'#888780', points:120 },
  demon:    { name:'Demon',    hp:280, color:'#D85A30', points:140 },
  dragon:   { name:'Dragon',   hp:350, color:'#E24B4A', points:175 },
  lich:     { name:'Lich',     hp:400, color:'#AFA9EC', points:200 },
  titan:    { name:'Titan',    hp:500, color:'#F0997B', points:250 },
};

// Goals in order for progress bar
const GOAL_ORDER = [
  { key:'keys_100',   label:'100 keystrokes', target:()=>100,  current:()=>keys  },
  { key:'lines_10',   label:'10 lines',        target:()=>10,   current:()=>lines },
  { key:'keys_500',   label:'500 keystrokes',  target:()=>500,  current:()=>keys  },
  { key:'lines_25',   label:'25 lines',        target:()=>25,   current:()=>lines },
  { key:'lines_50',   label:'50 lines',        target:()=>50,   current:()=>lines },
  { key:'keys_1000',  label:'1000 keystrokes', target:()=>1000, current:()=>keys  },
  { key:'lines_100',  label:'100 lines',       target:()=>100,  current:()=>lines },
  { key:'lines_200',  label:'200 lines',       target:()=>200,  current:()=>lines },
];

let currentEnemy = null;
let currentEnemyType = null;
let totalKills = 0;
let lines = 0, keys = 0;
let goalIdx = 0;
let isIdle = true;

// ── Stars ────────────────────────────────────────────────────────────────
function drawStars(){
  const c=document.getElementById('stars-c');
  const arena=document.getElementById('arena');
  c.width=arena.clientWidth;
  c.height=arena.clientHeight;
  const ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  for(let i=0;i<90;i++){
    const size=Math.random()>.85?2:1;
    ctx.fillStyle='rgba(255,255,255,'+(0.15+Math.random()*.6)+')';
    ctx.fillRect(Math.round(Math.random()*c.width),Math.round(Math.random()*c.height),size,size);
  }
}
function initStars(){
  drawStars();
  new ResizeObserver(()=>drawStars()).observe(document.getElementById('arena'));
}

// ── Draw player ──────────────────────────────────────────────────────────
function drawPlayer(){
  const c=document.getElementById('player-spr');
  const S=3;
  c.width=10*S; c.height=14*S;
  const ctx=c.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.clearRect(0,0,c.width,c.height);
  // nose tip
  [[4,0],[5,0]].forEach(([x,y])=>{ctx.fillStyle='#e0e0f0';ctx.fillRect(x*S,y*S,S,S);});
  // cockpit
  [[3,1],[4,1],[5,1],[6,1]].forEach(([x,y])=>{ctx.fillStyle='#85B7EB';ctx.fillRect(x*S,y*S,S,S);});
  [[2,2],[3,2],[4,2],[5,2],[6,2],[7,2]].forEach(([x,y])=>{ctx.fillStyle='#5090c8';ctx.fillRect(x*S,y*S,S,S);});
  // main hull
  [[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],[7,3],[8,3]].forEach(([x,y])=>{ctx.fillStyle='#c0c8e0';ctx.fillRect(x*S,y*S,S,S);});
  [[0,4],[1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4],[9,4]].forEach(([x,y])=>{ctx.fillStyle='#d0d8f0';ctx.fillRect(x*S,y*S,S,S);});
  [[0,5],[1,5],[2,5],[3,5],[4,5],[5,5],[6,5],[7,5],[8,5],[9,5]].forEach(([x,y])=>{ctx.fillStyle='#b0b8d0';ctx.fillRect(x*S,y*S,S,S);});
  [[1,6],[2,6],[3,6],[4,6],[5,6],[6,6],[7,6],[8,6]].forEach(([x,y])=>{ctx.fillStyle='#9098b8';ctx.fillRect(x*S,y*S,S,S);});
  // wings
  [[0,6],[9,6]].forEach(([x,y])=>{ctx.fillStyle='#7F77DD';ctx.fillRect(x*S,y*S,S,S);});
  [[0,7],[1,7],[8,7],[9,7]].forEach(([x,y])=>{ctx.fillStyle='#534AB7';ctx.fillRect(x*S,y*S,S,S);});
  // accent stripe
  [[2,4],[7,4]].forEach(([x,y])=>{ctx.fillStyle='#5DCAA5';ctx.fillRect(x*S,y*S,S,S);});
  // engine glow
  [[2,8],[3,8],[4,8],[5,8],[6,8],[7,8]].forEach(([x,y])=>{ctx.fillStyle='#EF9F27';ctx.fillRect(x*S,y*S,S,S);});
  [[3,9],[4,9],[5,9],[6,9]].forEach(([x,y])=>{ctx.fillStyle='#E24B4A';ctx.fillRect(x*S,y*S,S,S);});
}

// ── Draw enemy ───────────────────────────────────────────────────────────
function drawEnemy(type, hpRatio){
  const c=document.getElementById('enemy-spr'), ctx=c.getContext('2d');
  ctx.clearRect(0,0,40,48);
  const e=ENEMIES[type]||ENEMIES.slime;
  const col=e.color;
  const sprites={
    slime:   [[0,0,0,1,1,1,0,0],[0,0,1,1,1,1,1,0],[0,1,1,0,1,0,1,1],[0,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,1],[0,0,1,1,1,1,0,0],[0,1,0,1,0,1,0,1]],
    goblin:  [[0,0,1,0,0,1,0,0],[0,1,1,1,1,1,1,0],[1,1,0,1,1,0,1,1],[1,1,1,1,1,1,1,1],[0,1,0,1,1,0,1,0],[1,1,1,0,0,1,1,1],[0,1,0,0,0,0,1,0],[0,0,1,0,0,1,0,0]],
    skeleton:[[0,0,1,1,1,1,0,0],[0,1,0,1,1,0,1,0],[0,1,1,1,1,1,1,0],[0,0,1,1,1,1,0,0],[0,0,0,1,1,0,0,0],[0,0,1,0,0,1,0,0],[0,1,1,0,0,1,1,0],[0,1,0,0,0,0,1,0]],
    orc:     [[0,1,1,0,0,1,1,0],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[1,1,0,1,1,0,1,1],[0,1,1,0,0,1,1,0],[0,0,1,0,0,1,0,0]],
    knight:  [[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,1,0,1,1,0,1,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,0,1,0,0,1,0,1],[0,1,1,0,0,1,1,0]],
    vampire: [[0,1,0,1,1,0,1,0],[0,1,1,1,1,1,1,0],[1,1,0,1,1,0,1,1],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[0,1,0,1,1,0,1,0],[1,1,1,0,0,1,1,1],[0,0,1,1,1,1,0,0]],
    wizard:  [[0,0,1,1,1,0,0,0],[0,1,1,1,1,1,0,0],[1,1,0,1,1,0,1,0],[1,1,1,1,1,1,1,0],[0,1,1,1,1,1,0,0],[0,1,0,1,1,0,1,0],[1,1,1,0,0,1,1,1],[0,0,1,1,1,1,0,0]],
    golem:   [[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[1,1,0,1,1,0,1,1],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,0,0,1,1,1],[1,0,0,0,0,0,0,1]],
    demon:   [[1,0,1,0,0,1,0,1],[0,1,1,1,1,1,1,0],[1,1,0,1,1,0,1,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[1,0,1,1,1,1,0,1],[0,1,0,0,0,0,1,0],[1,0,1,0,0,1,0,1]],
    dragon:  [[1,0,0,1,1,0,0,1],[1,1,1,1,1,1,1,1],[0,1,0,1,1,0,1,0],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[0,1,1,0,0,1,1,0],[1,0,1,0,0,1,0,1]],
    lich:    [[0,1,0,1,1,0,1,0],[1,0,1,1,1,1,0,1],[0,1,0,1,1,0,1,0],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[1,0,0,1,1,0,0,1],[0,1,1,0,0,1,1,0],[1,0,1,0,0,1,0,1]],
    titan:   [[1,1,1,1,1,1,1,1],[1,1,0,1,1,0,1,1],[1,1,1,1,1,1,1,1],[1,0,1,1,1,1,0,1],[1,1,1,1,1,1,1,1],[1,1,0,1,1,0,1,1],[1,0,1,1,1,1,0,1],[1,1,1,0,0,1,1,1]],
  };
  const px=sprites[type]||sprites.slime;
  const alpha=0.3+hpRatio*0.7;
  px.forEach((row,y)=>row.forEach((v,x)=>{
    if(!v)return;
    const isEye=(y===2)&&(x===2||x===5);
    ctx.globalAlpha=alpha;
    ctx.fillStyle=isEye?'#ffffff':col;
    ctx.fillRect(x*P+4,y*P+4,P,P);
  }));
  ctx.globalAlpha=1;
}

// ── Flash laser beam — from player to enemy ──────────────────────────────
function flashLaser(lang){
  const LC={python:'#3B8BD4',javascript:'#EF9F27',typescript:'#85B7EB',rust:'#E24B4A',go:'#5DCAA5',cpp:'#7F77DD',default:'#7F77DD'};
  const col=LC[lang]||LC.default;
  const arena=document.getElementById('arena');
  const player=document.getElementById('player-wrap');
  const enemy=document.getElementById('enemy-wrap');

  const startX=player.offsetLeft+player.offsetWidth+2;
  const endX=enemy.offsetLeft+2;
  const y=player.offsetTop+12;
  if(endX<=startX)return;
  const dist=endX-startX;
  const duration=Math.max(80,dist*0.4);

  // bullet: simple colored rect that flies across
  const b=document.createElement('div');
  b.style.cssText='position:absolute;left:'+startX+'px;top:'+y+'px;width:14px;height:4px;background:'+col+';border-radius:2px;pointer-events:none;z-index:10;';
  // bright white tip
  const tip=document.createElement('div');
  tip.style.cssText='position:absolute;right:0;top:0;width:5px;height:4px;background:#fff;border-radius:0 2px 2px 0;';
  b.appendChild(tip);
  arena.appendChild(b);

  const t0=performance.now();
  function step(now){
    const p=Math.min(1,(now-t0)/duration);
    b.style.left=(startX+dist*p)+'px';
    // spawn fading trail dot every ~10px
    if(Math.floor((startX+dist*p)/10)!==Math.floor((startX+dist*Math.max(0,p-0.05))/10)){
      const tr=document.createElement('div');
      tr.style.cssText='position:absolute;left:'+(startX+dist*p-6)+'px;top:'+(y+1)+'px;width:6px;height:2px;background:'+col+';opacity:.5;border-radius:1px;pointer-events:none;transition:opacity .2s;';
      arena.appendChild(tr);
      setTimeout(()=>{tr.style.opacity='0';setTimeout(()=>tr.remove(),200);},20);
    }
    if(p<1){requestAnimationFrame(step);}
    else{
      b.remove();
      // impact flash
      const wrap=document.getElementById('enemy-wrap');
      wrap.style.filter='brightness(2.5)';
      setTimeout(()=>wrap.style.filter='',100);
      // 4 impact pixels
      for(let i=0;i<4;i++){
        const sp=document.createElement('div');
        const dx=(Math.random()-.5)*20,dy=(Math.random()-.5)*20;
        sp.style.cssText='position:absolute;left:'+(endX+dx)+'px;top:'+(y+dy)+'px;width:3px;height:3px;background:'+col+';border-radius:1px;pointer-events:none;animation:floatup .35s ease-out forwards;';
        arena.appendChild(sp);
        setTimeout(()=>sp.remove(),350);
      }
    }
  }
  requestAnimationFrame(step);
}

// ── Spawn popup ──────────────────────────────────────────────────────────
function popup(msg, color, x, y){
  const c=document.getElementById('popups'), el=document.createElement('div');
  el.textContent=msg;
  el.style.cssText='position:absolute;left:'+(x||100)+'px;top:'+(y||60)+'px;font-size:11px;font-weight:500;color:'+color+';animation:floatup .9s ease-out forwards;white-space:nowrap;pointer-events:none;';
  c.appendChild(el); setTimeout(()=>el.remove(),900);
}

// ── Set enemy ────────────────────────────────────────────────────────────
function setEnemy(type){
  const e=ENEMIES[type]||ENEMIES.slime;
  currentEnemyType=type;
  currentEnemy={hp:e.hp, maxHp:e.hp};
  document.getElementById('enemy-label').textContent=e.name;
  document.getElementById('enemy-name').textContent=e.name;
  document.getElementById('enemy-hp').textContent=e.hp+'/'+e.hp;
  document.getElementById('enemy-hp-bar').style.width='100%';
  document.getElementById('enemy-hp-bar').style.background=e.color;
  const wrap=document.getElementById('enemy-wrap');
  wrap.style.animation='appear .5s ease forwards';
  setTimeout(()=>wrap.style.animation='',500);
  drawEnemy(type,1);
  popup('⚔ '+e.name+' appeared!', e.color, 60, 40);
}

// ── Take damage ──────────────────────────────────────────────────────────
function takeDamage(dmg, lang){
  if(!currentEnemy) return;
  flashLaser(lang);
  currentEnemy.hp=Math.max(0,currentEnemy.hp-dmg);
  const ratio=currentEnemy.hp/currentEnemy.maxHp;
  document.getElementById('enemy-hp-bar').style.width=(ratio*100)+'%';
  document.getElementById('enemy-hp').textContent=currentEnemy.hp+'/'+currentEnemy.maxHp;
  drawEnemy(currentEnemyType, ratio);

  // hit animation
  const wrap=document.getElementById('enemy-wrap');
  wrap.style.animation='hit .25s ease';
  setTimeout(()=>wrap.style.animation=currentEnemy.hp>0?'idle 1.5s ease-in-out infinite':'',260);

  if(currentEnemy.hp<=0) killEnemy();
}

// ── Kill enemy ───────────────────────────────────────────────────────────
function killEnemy(){
  const e=ENEMIES[currentEnemyType]||ENEMIES.slime;
  const wrap=document.getElementById('enemy-wrap');
  wrap.style.animation='death .6s ease forwards';
  popup('💀 defeated! +'+e.points, '#EF9F27', 80, 30);
  setTimeout(()=>{
    currentEnemy=null;
    vscode.postMessage({type:'enemyKilled'});
    wrap.style.animation='';
  },700);
}

// ── Update next goal progress bar ────────────────────────────────────────
function updateGoalBar(){
  const g=GOAL_ORDER[goalIdx];
  if(!g){ document.getElementById('next-goal-label').textContent='all goals done!'; return; }
  const cur=g.current(), tar=g.target();
  const pct=Math.min(100,Math.round(cur/tar*100));
  document.getElementById('next-goal-fill').style.width=pct+'%';
  document.getElementById('next-goal-label').textContent=g.label+' — '+cur+'/'+tar;
  if(pct>=100) goalIdx++;
}

// ── Messages ─────────────────────────────────────────────────────────────
window.addEventListener('message',({data:msg})=>{
  if(msg.type==='init'){
    totalKills=msg.totalKills||0;
    document.getElementById('kills-hud').textContent=totalKills;
    document.getElementById('st-kills').textContent=totalKills;
    document.getElementById('streak-hud').textContent=(msg.streak||0);
    // spawn first enemy
    setEnemy('slime');
  }
  if(msg.type==='hit'){
    isIdle=false;
    if(currentEnemy) takeDamage(msg.damage||1, msg.lang||'default');
    else flashLaser(msg.lang||'default');
  }
  if(msg.type==='newEnemy'){
    const badge=document.getElementById('goal-badge');
    badge.textContent='goal: '+msg.label+'!';
    badge.style.opacity='1';
    setTimeout(()=>badge.style.opacity='0',2500);
    // if no current enemy, spawn now; otherwise queue
    if(!currentEnemy) setEnemy(msg.enemy);
    else popup('next: '+msg.enemy, '#EF9F27', 60, 70);
  }
  if(msg.type==='stats'){
    lines=msg.lines||0; keys=msg.keystrokes||0;
    document.getElementById('st-lines').textContent=lines;
    document.getElementById('st-keys').textContent=keys;
    document.getElementById('st-files').textContent=msg.files||0;
    document.getElementById('lines-hud').textContent=lines;
    document.getElementById('keys-hud').textContent=keys;
    document.getElementById('streak-hud').textContent=(msg.streak||0);
    drawPlayer();
    updateGoalBar();
    if(msg.lang){
      const LC={python:'#3B8BD4',javascript:'#EF9F27',typescript:'#85B7EB',html:'#D85A30',css:'#ED93B1',rust:'#E24B4A',go:'#5DCAA5',java:'#E24B4A',cpp:'#7F77DD',c:'#7F77DD',default:'#888790'};
      const col=LC[msg.lang]||LC.default;
      const langs=document.getElementById('langs');
      langs.innerHTML='';
      const t=document.createElement('span');
      t.textContent=msg.lang;
      t.style.cssText='background:'+col+'22;color:'+col+';border:1px solid '+col+'55;border-radius:3px;padding:3px 10px;font-size:10px;font-weight:500;';
      langs.appendChild(t);
    }
  }
  if(msg.type==='tick'){
    document.getElementById('session-time').textContent=msg.sessionTime;
  }
  if(msg.type==='killConfirm'){
    totalKills++;
    document.getElementById('kills-hud').textContent=totalKills;
    document.getElementById('st-kills').textContent=totalKills;
    const types=['slime','goblin','skeleton','orc','knight','vampire','wizard','golem','demon','dragon','lich','titan'];
    const nextType=types[Math.min(totalKills, types.length-1)];
    setEnemy(nextType);
  }
  if(msg.type==='fileSwitch'){
    drawPlayer();
    popup(msg.filename||'', '#85B7EB', 10, 140);
  }
});

setTimeout(()=>initStars(),100);
drawPlayer();
vscode.postMessage({type:'ready'});
</script></body></html>`;
}

export function deactivate() { clearInterval(sessionTimer); }