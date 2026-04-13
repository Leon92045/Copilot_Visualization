import * as vscode from 'vscode';

let panel: vscode.WebviewView | undefined;
let stats = { total: 0, accepted: 0, rejected: 0, xp: 0, level: 1, score: 0 };

// Track typing bursts to detect when Copilot is likely working
let typingTimer: NodeJS.Timeout | undefined;
let lastLineCount = 0;
let suggestionPending = false;

export function activate(context: vscode.ExtensionContext) {

  // Register the sidebar webview
  const provider = new CopilotPxViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('copilotPx.panel', provider)
  );

  // ── Text change listener ─────────────────────────────────────────────────
  // We watch for typing pauses — when the user stops typing for ~400ms
  // Copilot typically fires. We use this to trigger the "thinking" animation.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!panel) return;
      if (e.document.uri.scheme !== 'file') return;

      const newLineCount = e.document.lineCount;
      const delta = e.contentChanges;
      if (delta.length === 0) return;

      // Detect if a full line was inserted (likely an accepted suggestion)
      const bigInsert = delta.some(c => c.text.includes('\n') || c.text.length > 8);

      if (bigInsert && suggestionPending) {
        // Looks like Tab was pressed — suggestion accepted
        suggestionPending = false;
        stats.accepted++;
        stats.xp += 10;
        stats.score += 100;
        checkLevelUp();
        post({ type: 'accepted', stats });
      } else {
        // Regular typing — debounce to detect pause → trigger "thinking"
        clearTimeout(typingTimer);
        post({ type: 'typing' });
        typingTimer = setTimeout(() => {
          if (!suggestionPending) {
            suggestionPending = true;
            stats.total++;
            post({ type: 'thinking', stats });
            // After ~600ms simulate suggestion arriving
            setTimeout(() => post({ type: 'suggestion' }), 500 + Math.random() * 600);
          }
        }, 400);
      }

      lastLineCount = newLineCount;
    })
  );

  // ── Escape key → rejected ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('type', (args) => {
      if (args.text === '\x1b' && suggestionPending) {
        suggestionPending = false;
        stats.rejected++;
        stats.xp += 2;
        checkLevelUp();
        post({ type: 'rejected', stats });
      }
      return vscode.commands.executeCommand('default:type', args);
    })
  );

  // ── Active editor change ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) post({ type: 'fileChange', filename: editor.document.fileName.split('/').pop() });
    })
  );
}

function post(msg: object) {
  panel?.webview.postMessage(msg);
}

function checkLevelUp() {
  const needed = stats.level * 100;
  if (stats.xp >= needed) {
    stats.xp -= needed;
    stats.level++;
    post({ type: 'levelup', level: stats.level });
  }
}

class CopilotPxViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    panel = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent();

    // Messages from webview back to extension
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'manualAccept') {
        stats.accepted++;
        stats.xp += 10;
        stats.score += 100;
        checkLevelUp();
        post({ type: 'accepted', stats });
      }
      if (msg.type === 'manualReject') {
        stats.rejected++;
        stats.xp += 2;
        checkLevelUp();
        post({ type: 'rejected', stats });
      }
      if (msg.type === 'manualTrigger') {
        stats.total++;
        post({ type: 'thinking', stats });
        setTimeout(() => post({ type: 'suggestion' }), 500 + Math.random() * 700);
      }
    });
  }
}

function getWebviewContent(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0;image-rendering:pixelated;}
body{background:#0a0a0f;color:#e0e0e0;font-family:'Courier New',monospace;font-size:12px;overflow-x:hidden;}
@keyframes idle{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.93)}}
@keyframes think{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes celebrate{0%{transform:translateY(0)}30%{transform:translateY(-10px)}60%{transform:translateY(0)}80%{transform:translateY(-5px)}100%{transform:translateY(0)}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
@keyframes floatup{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-50px) translateX(var(--dx,0px));opacity:0}}
@keyframes fadeup{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-24px);opacity:0}}
@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes scanline{0%{top:0}100%{top:100%}}
@keyframes beam{0%{width:0}100%{width:calc(100% - 80px)}}
</style>
</head>
<body>

<!-- Header -->
<div style="background:#12121a;padding:8px 10px;border-bottom:2px solid #1a1a2e;display:flex;justify-content:space-between;align-items:center;">
  <span style="color:#7F77DD;font-size:11px;letter-spacing:.06em;">COPILOT<span style="color:#5DCAA5;">PX</span></span>
  <span style="font-size:10px;color:#EF9F27;">LV<span id="level">1</span> · <span id="score">000</span>pts</span>
</div>

<!-- Game world -->
<div id="world" style="position:relative;height:160px;background:#0d0d18;overflow:hidden;border-bottom:2px solid #1a1a2e;">
  <canvas id="stars" width="300" height="160" style="position:absolute;inset:0;"></canvas>
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:#1a1a2e;border-top:2px solid #534AB7;"></div>

  <div id="scan" style="position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#534AB7,transparent);opacity:0;top:0;pointer-events:none;"></div>

  <!-- Copilot character -->
  <div id="char-cp" style="position:absolute;bottom:28px;left:16px;animation:idle 1.2s ease-in-out infinite;">
    <canvas id="spr-cp" width="32" height="40"></canvas>
    <div id="bbl-cp" style="position:absolute;bottom:44px;left:-4px;background:#12121a;border:2px solid #534AB7;border-radius:4px;padding:2px 6px;font-size:9px;color:#9b95e8;white-space:nowrap;opacity:0;transition:opacity .3s;pointer-events:none;"></div>
  </div>

  <!-- Dev character -->
  <div id="char-dev" style="position:absolute;bottom:28px;right:16px;animation:idle 1.4s ease-in-out infinite .3s;">
    <canvas id="spr-dev" width="32" height="40"></canvas>
    <div id="bbl-dev" style="position:absolute;bottom:44px;right:-4px;background:#12121a;border:2px solid #5DCAA5;border-radius:4px;padding:2px 6px;font-size:9px;color:#5DCAA5;white-space:nowrap;opacity:0;transition:opacity .3s;pointer-events:none;"></div>
  </div>

  <!-- XP beam -->
  <div id="beam" style="position:absolute;bottom:46px;left:52px;height:3px;background:#7F77DD;border-radius:2px;width:0;transition:width .5s ease;opacity:0;"></div>

  <!-- Floating particles -->
  <div id="orbs" style="position:absolute;inset:0;pointer-events:none;overflow:hidden;"></div>
  <div id="popups" style="position:absolute;inset:0;pointer-events:none;overflow:hidden;"></div>

  <!-- XP bar -->
  <div style="position:absolute;bottom:6px;left:10px;right:10px;height:5px;background:#12121a;border-radius:3px;border:1px solid #2a2a3e;">
    <div id="xp-bar" style="height:100%;background:#534AB7;border-radius:2px;width:0%;transition:width .5s;"></div>
  </div>
  <div id="xp-txt" style="position:absolute;bottom:0px;right:12px;font-size:8px;color:#3a3a5a;">0/100 XP</div>
</div>

<!-- Token stream -->
<div style="background:#10101a;padding:6px 10px;border-bottom:1px solid #1a1a2e;min-height:28px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
  <span style="font-size:9px;color:#3a3a5a;letter-spacing:.05em;flex-shrink:0;">STREAM</span>
  <div id="tokens" style="display:flex;gap:3px;flex-wrap:wrap;flex:1;"></div>
  <div id="dots" style="display:flex;gap:2px;opacity:0;transition:opacity .3s;">
    <div style="width:4px;height:4px;background:#534AB7;border-radius:1px;animation:blink .6s step-end infinite;"></div>
    <div style="width:4px;height:4px;background:#534AB7;border-radius:1px;animation:blink .6s step-end infinite .2s;"></div>
    <div style="width:4px;height:4px;background:#534AB7;border-radius:1px;animation:blink .6s step-end infinite .4s;"></div>
  </div>
</div>

<!-- Stats -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px;background:#0d0d18;">
  <div style="background:#12121a;border:1px solid #1a1a2e;border-radius:5px;padding:6px;text-align:center;">
    <div style="font-size:16px;font-weight:500;color:#7F77DD;" id="st-total">0</div>
    <div style="font-size:8px;color:#3a3a5a;letter-spacing:.04em;margin-top:1px;">TOTAL</div>
  </div>
  <div style="background:#12121a;border:1px solid #1a1a2e;border-radius:5px;padding:6px;text-align:center;">
    <div style="font-size:16px;font-weight:500;color:#5DCAA5;" id="st-acc">0</div>
    <div style="font-size:8px;color:#3a3a5a;letter-spacing:.04em;margin-top:1px;">ACCEPTED</div>
  </div>
  <div style="background:#12121a;border:1px solid #1a1a2e;border-radius:5px;padding:6px;text-align:center;">
    <div style="font-size:16px;font-weight:500;color:#E24B4A;" id="st-rej">0</div>
    <div style="font-size:8px;color:#3a3a5a;letter-spacing:.04em;margin-top:1px;">REJECTED</div>
  </div>
  <div style="background:#12121a;border:1px solid #1a1a2e;border-radius:5px;padding:6px;text-align:center;">
    <div style="font-size:16px;font-weight:500;color:#EF9F27;" id="st-rate">0%</div>
    <div style="font-size:8px;color:#3a3a5a;letter-spacing:.04em;margin-top:1px;">RATE</div>
  </div>
</div>

<!-- Manual buttons (fallback when not using Copilot) -->
<div style="padding:8px 10px;background:#0a0a0f;border-top:1px solid #1a1a2e;display:flex;gap:6px;">
  <button onclick="vscode.postMessage({type:'manualTrigger'})" style="flex:1;padding:6px;background:#12121a;border:1px solid #534AB7;border-radius:4px;color:#9b95e8;font-family:monospace;font-size:10px;cursor:pointer;">▶ trigger</button>
  <button onclick="vscode.postMessage({type:'manualAccept'})" style="padding:6px 10px;background:#0d1f14;border:1px solid #3B6D11;border-radius:4px;color:#5DCAA5;font-family:monospace;font-size:10px;cursor:pointer;">TAB</button>
  <button onclick="vscode.postMessage({type:'manualReject'})" style="padding:6px 10px;background:#1f0d0d;border:1px solid #6b2b2b;border-radius:4px;color:#f48771;font-family:monospace;font-size:10px;cursor:pointer;">ESC</button>
</div>

<script>
const vscode = acquireVsCodeApi();
const P = 4;
const TOKENS = ['return','price','*','(1','-','rate',')',';','val','if','def','True','None'];
const COLORS = ['#7F77DD','#5DCAA5','#85B7EB','#EF9F27','#ED93B1'];
let hasSuggestion = false;
let stats = {total:0,accepted:0,rejected:0,xp:0,level:1,score:0};

// ── Pixel sprite drawing ─────────────────────────────────────────────────
function drawSprite(id, type, state) {
  const c = document.getElementById(id);
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,32,40);

  if (type === 'cp') {
    const body = state==='think' ? '#534AB7' : state==='celebrate' ? '#7F77DD' : '#3C3489';
    const eye  = state==='think' ? '#EF9F27' : '#9b95e8';
    const px = [
      [0,0,1,1,1,1,0,0],
      [0,1,1,1,1,1,1,0],
      [1,1,0,1,1,0,1,1],
      [1,1,1,1,1,1,1,1],
      [0,1,0,1,1,0,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,1,0,0,1,1,0],
      [1,1,0,0,0,0,1,1],
      [1,1,1,0,0,1,1,1],
      [0,1,1,1,1,1,1,0],
    ];
    px.forEach((row,y)=>row.forEach((v,x)=>{
      if(!v) return;
      ctx.fillStyle = (y===2&&(x===2||x===5)) ? eye : body;
      ctx.fillRect(x*P, y*P, P, P);
    }));
    if (state==='think') {
      ctx.fillStyle='#EF9F27';
      ctx.fillRect(4*P, 0, P, P);
      ctx.fillRect(3*P, P/2, 2*P, P/2);
    }
  }

  if (type === 'dev') {
    const body = state==='celebrate' ? '#5DCAA5' : '#1D9E75';
    const px = [
      [0,0,1,1,1,1,0,0],
      [0,1,1,1,1,1,1,0],
      [1,1,0,1,1,0,1,1],
      [1,1,1,1,1,1,1,1],
      [0,0,1,0,0,1,0,0],
      [0,1,1,1,1,1,1,0],
      [0,1,0,1,1,0,1,0],
      [1,1,1,0,0,1,1,1],
      [0,1,1,0,0,1,1,0],
      [0,0,1,0,0,1,0,0],
    ];
    px.forEach((row,y)=>row.forEach((v,x)=>{
      if(!v) return;
      ctx.fillStyle = y<2 ? '#EF9F27' : y<4 ? '#F0997B' : body;
      ctx.fillRect(x*P, y*P, P, P);
    }));
  }
}

function initStars() {
  const c = document.getElementById('stars');
  const ctx = c.getContext('2d');
  for(let i=0;i<50;i++){
    ctx.fillStyle = \`rgba(255,255,255,\${.05+Math.random()*.25})\`;
    ctx.fillRect(Math.round(Math.random()*300), Math.round(Math.random()*140), Math.random()>.7?2:1, Math.random()>.7?2:1);
  }
}

function bubble(who, msg) {
  const el = document.getElementById('bbl-'+who);
  el.textContent = msg;
  el.style.opacity = '1';
  setTimeout(()=>el.style.opacity='0', 1500);
}

function spawnOrb(color) {
  const container = document.getElementById('orbs');
  const p = document.createElement('div');
  const x = 20 + Math.random()*240;
  const dx = (Math.random()-.5)*50;
  p.style.cssText = \`position:absolute;left:\${x}px;bottom:30px;width:6px;height:6px;background:\${color};border-radius:1px;--dx:\${dx}px;animation:floatup .8s ease-out forwards;\`;
  container.appendChild(p);
  setTimeout(()=>p.remove(), 800);
}

function spawnPopup(msg, color) {
  const container = document.getElementById('popups');
  const el = document.createElement('div');
  el.textContent = msg;
  const x = 60 + Math.random()*140;
  el.style.cssText = \`position:absolute;left:\${x}px;top:40px;font-size:10px;font-weight:500;color:\${color};animation:fadeup .9s ease-out forwards;\`;
  container.appendChild(el);
  setTimeout(()=>el.remove(), 900);
}

function addToken(txt, color) {
  const row = document.getElementById('tokens');
  const t = document.createElement('span');
  t.textContent = txt;
  t.style.cssText = \`background:\${color}22;color:\${color};border:1px solid \${color}44;border-radius:2px;padding:1px 5px;font-size:9px;\`;
  row.appendChild(t);
  if(row.children.length > 9) row.removeChild(row.children[0]);
}

function updateUI(s) {
  stats = s || stats;
  document.getElementById('st-total').textContent = stats.total;
  document.getElementById('st-acc').textContent   = stats.accepted;
  document.getElementById('st-rej').textContent   = stats.rejected;
  const r = stats.total ? Math.round(stats.accepted/stats.total*100) : 0;
  document.getElementById('st-rate').textContent  = r+'%';
  document.getElementById('score').textContent    = String(stats.score).padStart(3,'0');
  document.getElementById('level').textContent    = stats.level;
  const needed = stats.level * 100;
  document.getElementById('xp-bar').style.width  = Math.min(100, Math.round(stats.xp/needed*100))+'%';
  document.getElementById('xp-txt').textContent  = stats.xp+'/'+needed+' XP';
}

function runScan() {
  const s = document.getElementById('scan');
  s.style.opacity='1'; s.style.top='0';
  s.style.transition='top 1.6s linear';
  setTimeout(()=>s.style.top='100%', 50);
  setTimeout(()=>{s.style.opacity='0';s.style.transition='';s.style.top='0';}, 1700);
}

// ── Message handler ──────────────────────────────────────────────────────
window.addEventListener('message', ({data}) => {
  const msg = data;

  if (msg.type === 'typing') {
    drawSprite('spr-cp','cp','idle');
    document.getElementById('char-cp').style.animation='idle 1.2s ease-in-out infinite';
  }

  if (msg.type === 'thinking') {
    hasSuggestion = false;
    updateUI(msg.stats);
    runScan();
    drawSprite('spr-cp','cp','think');
    document.getElementById('char-cp').style.animation='think .5s ease-in-out infinite';
    document.getElementById('dots').style.opacity='1';
    bubble('cp','thinking...');
    bubble('dev','hmm...');
    for(let i=0;i<4;i++) setTimeout(()=>spawnOrb(COLORS[Math.floor(Math.random()*COLORS.length)]),i*150);
    setTimeout(()=>document.getElementById('dots').style.opacity='0', 2000);
  }

  if (msg.type === 'suggestion') {
    hasSuggestion = true;
    drawSprite('spr-cp','cp','idle');
    document.getElementById('char-cp').style.animation='idle 1.2s ease-in-out infinite';
    bubble('cp','ready!');
    bubble('dev','looks good?');

    const beam = document.getElementById('beam');
    beam.style.opacity='1'; beam.style.width='0';
    beam.style.transition='width .5s ease';
    setTimeout(()=>beam.style.width='calc(100% - 100px)', 50);
    setTimeout(()=>{beam.style.opacity='0';beam.style.width='0';beam.style.transition='';}, 700);

    for(let i=0;i<3;i++) setTimeout(()=>addToken(
      TOKENS[Math.floor(Math.random()*TOKENS.length)],
      COLORS[Math.floor(Math.random()*COLORS.length)]
    ), i*120);
  }

  if (msg.type === 'accepted') {
    hasSuggestion = false;
    updateUI(msg.stats);
    drawSprite('spr-cp','cp','celebrate');
    drawSprite('spr-dev','dev','celebrate');
    document.getElementById('char-cp').style.animation='celebrate .5s ease-in-out 3';
    document.getElementById('char-dev').style.animation='celebrate .5s ease-in-out 3';
    bubble('cp','+10 XP!');
    bubble('dev','nice!');
    spawnPopup('+10 XP','#5DCAA5');
    for(let i=0;i<8;i++) setTimeout(()=>{
      spawnOrb('#5DCAA5'); spawnOrb('#7F77DD');
    },i*60);
    setTimeout(()=>{
      drawSprite('spr-cp','cp','idle');
      drawSprite('spr-dev','dev','idle');
      document.getElementById('char-cp').style.animation='idle 1.2s ease-in-out infinite';
      document.getElementById('char-dev').style.animation='idle 1.4s ease-in-out infinite .3s';
    }, 1500);
  }

  if (msg.type === 'rejected') {
    hasSuggestion = false;
    updateUI(msg.stats);
    document.getElementById('char-cp').style.animation='shake .4s ease-in-out 2';
    bubble('cp','aw...');
    spawnPopup('NOPE','#E24B4A');
    spawnOrb('#E24B4A');
    setTimeout(()=>{
      drawSprite('spr-cp','cp','idle');
      document.getElementById('char-cp').style.animation='idle 1.2s ease-in-out infinite';
    }, 800);
  }

  if (msg.type === 'levelup') {
    spawnPopup('LEVEL UP!','#EF9F27');
    for(let i=0;i<12;i++) setTimeout(()=>spawnOrb(COLORS[i%COLORS.length]),i*80);
  }

  if (msg.type === 'fileChange') {
    addToken(msg.filename, '#85B7EB');
  }
});

// Init
initStars();
drawSprite('spr-cp','cp','idle');
drawSprite('spr-dev','dev','idle');
updateUI(null);
</script>
</body>
</html>`;
}

export function deactivate() {}
