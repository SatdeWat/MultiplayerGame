// game.js
import { db, dbRef, dbGet, dbOnValue, dbPush, dbUpdate } from './firebase.js';

const player = localStorage.getItem('player');
const lobbyCode = localStorage.getItem('lobbyCode');
if(!lobbyCode) { alert('Geen lobby'); location.href='index.html' }

const turnPopup = document.getElementById('turnPopup');
const meName = document.getElementById('meName');
const gameTitle = document.getElementById('gameTitle');
const subInfo = document.getElementById('subInfo');
const ownBoardWrap = document.getElementById('ownBoardWrap');
const oppBoardWrap = document.getElementById('oppBoardWrap');
const logEl = document.getElementById('log');
const modeInfo = document.getElementById('modeInfo');
const remainingEl = document.getElementById('remaining');

let lobby = null;
let role = null;
let opponentRole = null;
let gridSize = 15;
let mode = 'classic';
let ownCells = [];
let ourShots = {}; // index -> entry
let oppShots = {};
let turn = 'host';
let finished = false;
let shipSet = [];

function appendLog(t){ const d = document.createElement('div'); d.textContent = `${new Date().toLocaleTimeString()} — ${t}`; logEl.prepend(d); }

// create grids
function makeGrid(container, clickable){
  container.innerHTML = '';
  const g = document.createElement('div'); g.className = 'board'; g.style.gridTemplateColumns = `repeat(${gridSize}, 34px)`;
  for(let i=0;i<gridSize*gridSize;i++){
    const c = document.createElement('div'); c.className='cell'; c.dataset.i = i;
    if(clickable) c.addEventListener('click', ()=> onCellClick(i,c));
    g.appendChild(c);
  }
  container.appendChild(g);
}

async function init(){
  const snap = await dbGet(dbRef(db, `lobbies/${lobbyCode}`));
  if(!snap.exists()){ alert('Lobby bestaat niet'); location.href='index.html' }
  lobby = snap.val();
  gridSize = lobby.size || 15;
  mode = lobby.mode || 'classic';
  shipSet = lobby.shipSet || [5,4,3,2];
  document.getElementById('subInfo').textContent = `${mode.toUpperCase()} · ${gridSize}x${gridSize} · Schepen: ${shipSet.join(',')}`;
  modeInfo.textContent = `Mode: ${mode} — regels: ${mode==='classic'?'1 schot/turn' : mode==='streak'?'bij hit blijf je schieten' : 'kies tot 3 vakjes per beurt'}`;
  meName.textContent = player || 'Gast';
  gameTitle.textContent = `Zeeslag — ${lobbyCode}`;

  // determine role
  const playersSnap = await dbGet(dbRef(db, `lobbies/${lobbyCode}/players`));
  const players = playersSnap.val();
  if(players.host === player) role='host', opponentRole='guest';
  else if(players.guest === player) role='guest', opponentRole='host';
  else { alert('Je bent niet in deze lobby'); location.href='index.html' }

  makeGrid(ownBoardWrap, false);
  makeGrid(oppBoardWrap, (mode!=='power')); // power needs special confirm UI implemented inline

  // listen lobby changes (turn, shots, status)
  dbOnValue(dbRef(db, `lobbies/${lobbyCode}`), async (snap)=>{
    if(!snap.exists()) return;
    lobby = snap.val();
    turn = lobby.turn || 'host';
    finished = (lobby.status === 'finished');
    updateTurnPopup();
    // refresh boards & shots
    await loadBoards();
    await loadShots();
    renderOwnBoard();
    renderOppBoard();
    if(finished){
      appendLog('Game finished — winner: ' + (lobby.winner || 'unknown'));
      turnPopup.textContent = 'Spel afgelopen — winnaar: ' + (lobby.winner || 'unknown');
    }
  });

  // listen shots for reactive UI
  dbOnValue(dbRef(db, `lobbies/${lobbyCode}/shots`), (snap)=>{
    const s = snap.val() || {};
    ourShots = {}; oppShots = {};
    Object.values(s).forEach(entry=>{
      if(entry.byRole === role) ourShots[entry.index] = entry;
      else oppShots[entry.index] = entry;
    });
    renderOwnBoard();
    renderOppBoard();
  });
}

async function loadBoards(){
  const snap = await dbGet(dbRef(db, `lobbies/${lobbyCode}/boards`));
  const b = snap.val() || {};
  ownCells = b?.[role]?.cells || [];
}

async function loadShots(){
  const snap = await dbGet(dbRef(db, `lobbies/${lobbyCode}/shots`));
  const s = snap.val() || {};
  ourShots = {}; oppShots = {};
  Object.values(s).forEach(entry=>{
    if(entry.byRole === role) ourShots[entry.index] = entry;
    else oppShots[entry.index] = entry;
  });
}

function updateTurnPopup(){
  if(finished){ turnPopup.textContent = 'Spel afgelopen'; return; }
  if(turn === role) turnPopup.innerHTML = `<span class="active">Jij bent aan de beurt!</span>`;
  else {
    // show opponent name if present
    const oppName = lobby.players && lobby.players[opponentRole] ? lobby.players[opponentRole] : 'Tegenstander';
    turnPopup.innerHTML = `Wachten op <strong>${oppName}</strong>`;
  }
}

function renderOwnBoard(){
  const cells = document.querySelectorAll('#ownBoardWrap .cell');
  cells.forEach(c=>{
    const i = parseInt(c.dataset.i);
    c.className='cell';
    c.textContent='';
    if(ownCells.includes(i)){ c.classList.add('own'); }
    if(oppShots[i]){
      if(oppShots[i].result === 'hit'){ c.classList.add('hit','revealed'); c.textContent='✖'; c.classList.add('hitPulse'); }
      else { c.classList.add('miss','revealed'); c.textContent='•'; c.classList.add('missPulse'); }
    }
  });
}

function renderOppBoard(){
  const cells = document.querySelectorAll('#oppBoardWrap .cell');
  cells.forEach(c=>{
    const i = parseInt(c.dataset.i);
    c.className='cell';
    c.textContent='';
    // reveal ourShots
    if(ourShots[i]){
      if(ourShots[i].result === 'hit'){ c.classList.add('hit','revealed'); c.textContent='✖'; c.classList.add('hitPulse'); }
      else { c.classList.add('miss','revealed'); c.textContent='•'; c.classList.add('missPulse'); }
    } else {
      // fog
      c.textContent = '';
    }
  });
}

// click logic
let selectedPower = new Set();
function onCellClick(index, el){
  if(finished) return;
  if(turn !== role) return alert('Niet jouw beurt!');
  if(ourShots[index]) return; // already shot here
  if(mode === 'classic' || mode === 'streak'){
    doShot([index]);
  } else if(mode === 'power'){
    // toggle selection (max 3)
    if(selectedPower.has(index)){ selectedPower.delete(index); el.classList.remove('revealed'); el.textContent=''; }
    else {
      if(selectedPower.size >= 3) { alert('Max 3 vakjes bij Power'); return; }
      selectedPower.add(index); el.classList.add('revealed'); el.textContent='?';
    }
    showPowerControls();
  }
}

function showPowerControls(){
  if(document.getElementById('powerControls')) return;
  const panel = document.createElement('div'); panel.id='powerControls'; panel.className='flex';
  const ok = document.createElement('button'); ok.className='btn small'; ok.textContent='Bevestig';
  const cancel = document.createElement('button'); cancel.className='btn ghost small'; cancel.textContent='Annuleer';
  ok.onclick = async ()=> {
    if(selectedPower.size === 0) return alert('Kies minstens 1 vakje');
    const arr = Array.from(selectedPower);
    selectedPower.clear(); panel.remove(); await doShot(arr);
  };
  cancel.onclick = ()=> { selectedPower.clear(); panel.remove(); renderOppBoard(); };
  panel.appendChild(ok); panel.appendChild(cancel);
  document.querySelector('.panel').appendChild(panel);
}

// perform shots: array indices
async function doShot(indices){
  // read opponent board cells
  const boardsSnap = await dbGet(dbRef(db, `lobbies/${lobbyCode}/boards`));
  const boards = boardsSnap.val() || {};
  if(!boards[opponentRole]) return alert('Tegenstander nog niet klaar');
  const oppCells = boards[opponentRole].cells || [];

  const updates = {};
  const results = [];
  for(const idx of indices){
    const isHit = oppCells.includes(parseInt(idx));
    const res = isHit ? 'hit' : 'miss';
    results.push({ index: idx, result: res });
    const newKey = dbPush(dbRef(db, `lobbies/${lobbyCode}/shots`)).key;
    updates[`lobbies/${lobbyCode}/shots/${newKey}`] = { index: idx, byRole: role, result: res, ts: Date.now() };
  }
  // apply
  await dbUpdate(dbRef(db, '/'), updates);

  // decide next turn
  if(mode === 'classic') turn = (turn === 'host') ? 'guest' : 'host';
  else if(mode === 'streak'){
    const anyHit = results.some(r => r.result === 'hit');
    if(!anyHit) turn = (turn === 'host') ? 'guest' : 'host';
  } else if(mode === 'power'){
    turn = (turn === 'host') ? 'guest' : 'host';
  }
  await dbUpdate(dbRef(db, '/'), { [`lobbies/${lobbyCode}/turn`]: turn });

  appendLog(`Je schoot op: ${indices.join(', ')} → ${results.map(r=>r.result).join(', ')}`);

  // re-render and check for sunk ships + game end after small delay
  setTimeout(()=> { loadBoards().then(()=> { renderOwnBoard(); renderOppBoard(); checkSunkAndWin(); }); }, 150);
}

async function checkSunkAndWin(){
  // determine hit sets
  const boardsSnap = await dbGet(dbRef(db, `lobbies/${lobbyCode}/boards`));
  const boards = boardsSnap.val() || {};
  if(!boards.host || !boards.guest) return;
  const hostCells = boards.host.cells || [];
  const guestCells = boards.guest.cells || [];
  const shotsSnap = await dbGet(dbRef(db, `lobbies/${lobbyCode}/shots`));
  const shots = shotsSnap.val() || {};
  const hitsOnGuest = new Set();
  const hitsOnHost = new Set();
  Object.values(shots || {}).forEach(e=>{
    if(e.result !== 'hit') return;
    if(e.byRole === 'host') hitsOnGuest.add(parseInt(e.index));
    else hitsOnHost.add(parseInt(e.index));
  });

  // sunk detection: check shipSet segmentation by placement? We don't track ship segmentation server-side beyond cells.
  // We'll detect when all cells of a ship are hit by comparing sets using shipSet lengths and heuristics:
  // Simpler: if all cells of a player's ship (any contiguous subset of lengths) are hit -> visually highlight.
  // For now: check overall loss
  const guestLost = guestCells.length>0 && guestCells.every(c=> hitsOnGuest.has(parseInt(c)));
  const hostLost = hostCells.length>0 && hostCells.every(c=> hitsOnHost.has(parseInt(c)));
  if(guestLost || hostLost){
    finished = true;
    const winner = guestLost ? lobby.players.host : lobby.players.guest;
    await dbUpdate(dbRef(db, '/'), { [`lobbies/${lobbyCode}/status`]: 'finished', [`lobbies/${lobbyCode}/winner`]: winner });
    appendLog('Spel afgelopen — winnaar: ' + winner);
    turnPopup.textContent = 'Spel afgelopen — winnaar: ' + winner;
    // mark sunk cells visually (all hit cells become sunk)
    markSunkCells(hitsOnGuest, hitsOnHost);
    return;
  }
  // Update remaining ships/cells (informative)
  remainingEl.textContent = `Jouw schade: ${Object.keys(oppShots).length || 0} hits tegen jou`;
}

function markSunkCells(hitsOnGuest, hitsOnHost){
  // mark cells that are hits as sunk if they belong to a fully destroyed ship.
  // Simpler heuristic: any hit cell that is adjacent to other hits forming lengths from shipSet -> mark 'sunk' class.
  // For visual effect: mark all hit cells that are part of full shipSet as sunk.
  // We'll mark every hit cell with sunk class if all player's cells are hit (in final) — already done in checkWin
  document.querySelectorAll('#ownBoardWrap .cell').forEach(c=>{
    const i = parseInt(c.dataset.i);
    if(hitsOnHost.has(i)) c.classList.add('sunk');
  });
  document.querySelectorAll('#oppBoardWrap .cell').forEach(c=>{
    const i = parseInt(c.dataset.i);
    if(hitsOnGuest.has(i)) c.classList.add('sunk');
  });
}

// attach events for exit/restart
document.getElementById('btnExit').addEventListener('click', ()=> { if(confirm('Stop en terug naar home?')) { localStorage.removeItem('lobbyCode'); location.href='index.html' }});
document.getElementById('btnSurrender').addEventListener('click', async ()=> {
  if(!confirm('Weet je zeker? Je geeft op.')) return;
  // opponent wins
  const playersSnap = await dbGet(dbRef(db, `lobbies/${lobbyCode}/players`));
  const players = playersSnap.val() || {};
  const winner = players[opponentRole] || 'Tegenstander';
  await dbUpdate(dbRef(db, '/'), { [`lobbies/${lobbyCode}/status`]: 'finished', [`lobbies/${lobbyCode}/winner`]: winner });
  location.href='index.html';
});

document.getElementById('btnRestart').addEventListener('click', ()=> {
  if(confirm('Start nieuwe lobby als host?')) {
    // create new lobby and redirect
    const newCode = Math.floor(1000 + Math.random()*9000).toString();
    const lobbyObj = { players: { host: player }, status: 'waiting', mode, size: gridSize, shipSet, created: Date.now() };
    dbUpdate(dbRef(db, '/'), { [`lobbies/${newCode}`]: lobbyObj }).then(()=>{
      localStorage.setItem('lobbyCode', newCode);
      location.href='place-ships.html';
    });
  }
});

// initialize UI & listeners
(async function(){
  await init();
  // build grids clickable
  makeGrid(ownBoardWrap, false);
  makeGrid(oppBoardWrap, true);
  // attach click listeners to oppGrid cells
  const obs = new MutationObserver(()=> {
    // attach to newly rendered cells
    document.querySelectorAll('#oppBoardWrap .cell').forEach(c=>{
      if(!c.dataset.bound){
        c.dataset.bound = '1';
        c.addEventListener('click', ()=> onCellClick(parseInt(c.dataset.i), c));
      }
    });
  });
  obs.observe(oppBoardWrap, { childList:true, subtree:true });
})();
