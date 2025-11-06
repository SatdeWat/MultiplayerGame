// game.js (module)
import { db, dbRef, dbGet, dbOnValue, dbPush, dbUpdate } from './firebase.js';

const player = localStorage.getItem('player');
const code = localStorage.getItem('lobbyCode');
const mode = document.body.dataset.mode || 'classic';
if(!player || !code){ alert('Geen speler of lobby gevonden.'); location.href='index.html'; }

document.getElementById('me').textContent = player;
document.getElementById('lobbyId').textContent = code;

const gridSize = 15;
const ownBoardEl = document.getElementById('ownBoard');
const oppBoardEl = document.getElementById('oppBoard');
const turnPopup = document.getElementById('turnPopup');
const gameLog = document.getElementById('gameLog');

let role = null; // host / guest
let opponentRole = null;
let lobby = null;
let ownCells = [];
let ourShots = {};
let oppShots = {};
let turn = 'host';
let finished = false;

function makeGrid(container, clickable){
  container.innerHTML = '';
  const g = document.createElement('div');
  g.className = 'board';
  g.style.gridTemplateColumns = `repeat(${gridSize}, 30px)`;
  for(let i=0;i<gridSize*gridSize;i++){
    const c = document.createElement('div');
    c.className = 'cell';
    c.dataset.i = i;
    if(clickable) c.addEventListener('click', ()=> onCellClick(i, c));
    g.appendChild(c);
  }
  container.appendChild(g);
}

makeGrid(ownBoardEl, false);
makeGrid(oppBoardEl, true);

// bepaal role
(async function determineRole(){
  const snap = await dbGet(dbRef(db, 'lobbies/' + code + '/players'));
  if(!snap.exists()) { alert('Lobby bestaat niet meer.'); location.href='index.html'; }
  const p = snap.val();
  if(p.host === player){ role = 'host'; opponentRole = 'guest'; }
  else if(p.guest === player){ role = 'guest'; opponentRole = 'host'; }
  else { alert('Je staat niet in deze lobby.'); location.href='index.html'; }
  init();
})();

function init(){
  dbOnValue(dbRef(db, 'lobbies/' + code), (snap)=>{
    if(!snap.exists()) return;
    lobby = snap.val();
    turn = lobby.turn || 'host';
    finished = (lobby.status === 'finished');
    updateTurnPopup();
    loadBoards();
    loadShots();
    if(finished){
      const winner = lobby.winner;
      appendLog('Spel afgelopen — winnaar: ' + (winner || 'onbekend'));
      turnPopup.textContent = 'Spel afgelopen — winnaar: ' + (winner || 'onbekend');
    }
  });

  dbOnValue(dbRef(db, 'lobbies/' + code + '/shots'), (snap)=>{
    // live update
    const shots = snap.val() || {};
    ourShots = {}; oppShots = {};
    Object.values(shots).forEach(entry=>{
      if(entry.byRole === role) ourShots[entry.index] = entry;
      else oppShots[entry.index] = entry;
    });
    renderOpponentBoard();
    renderOwnBoard();
  });

  document.getElementById('btnLeave')?.addEventListener('click', leave);
  document.getElementById('btnRestart')?.addEventListener('click', restart);
}

function loadBoards(){
  dbGet(dbRef(db, 'lobbies/' + code + '/boards')).then(snap=>{
    const b = snap.val() || {};
    ownCells = b?.[role]?.cells || [];
    renderOwnBoard();
  });
}

function loadShots(){
  dbGet(dbRef(db, 'lobbies/' + code + '/shots')).then(snap=>{
    const s = snap.val() || {};
    ourShots = {}; oppShots = {};
    Object.values(s).forEach(entry=>{
      if(entry.byRole === role) ourShots[entry.index] = entry;
      else oppShots[entry.index] = entry;
    });
    renderOpponentBoard();
    renderOwnBoard();
  });
}

function updateTurnPopup(){
  if(finished) { turnPopup.textContent = 'Spel afgelopen.'; return; }
  turnPopup.textContent = (turn === role) ? 'Jij bent aan de beurt!' : 'Wachten op tegenstander...';
}

// render own board (toon eigen schepen + hits)
function renderOwnBoard(){
  const cells = document.querySelectorAll('#ownBoard .cell');
  cells.forEach(c=>{
    const i = c.dataset.i;
    c.className = 'cell';
    c.textContent = '';
    if(ownCells.includes(parseInt(i))){ c.classList.add('own'); }
    if(oppShots[i]){
      if(oppShots[i].result === 'hit'){ c.classList.add('hit'); c.textContent = '✖'; }
      else { c.classList.add('miss'); c.textContent = '•'; }
    }
  });
}

// render opponent board (fog of war)
function renderOpponentBoard(){
  const cells = document.querySelectorAll('#oppBoard .cell');
  cells.forEach(c=>{
    const i = c.dataset.i;
    c.className = 'cell';
    c.textContent = '';
    if(ourShots[i]){
      if(ourShots[i].result === 'hit'){ c.classList.add('hit'); c.textContent = '✖'; }
      else { c.classList.add('miss'); c.textContent = '•'; }
    }
  });
}

let selectedPower = new Set();

async function onCellClick(index, el){
  if(finished) return;
  if(turn !== role) return alert('Niet jouw beurt!');
  if(ourShots[index]) return; // al geschoten
  if(mode === 'classic' || mode === 'streak'){
    await makeShot([index]);
  } else if(mode === 'power'){
    // toggle
    if(selectedPower.has(index)){ selectedPower.delete(index); renderOpponentBoard(); }
    else {
      if(selectedPower.size >= 3) return alert('Max 3 vakjes voor power.');
      selectedPower.add(index);
      el.classList.add('revealed');
      el.textContent = '?';
    }
    showPowerButtons();
  }
}

function showPowerButtons(){
  if(document.getElementById('powerBtns')) return;
  const panel = document.createElement('div');
  panel.id = 'powerBtns';
  panel.className = 'flex';
  const ok = document.createElement('button'); ok.textContent = 'Bevestig'; ok.className = 'small';
  const cancel = document.createElement('button'); cancel.textContent = 'Annuleer'; cancel.className = 'small';
  ok.onclick = async ()=>{
    if(selectedPower.size === 0) return alert('Kies minstens 1 vakje.');
    const arr = Array.from(selectedPower);
    selectedPower.clear();
    panel.remove();
    await makeShot(arr);
  };
  cancel.onclick = ()=>{
    selectedPower.clear();
    panel.remove();
    renderOpponentBoard();
  };
  panel.appendChild(ok); panel.appendChild(cancel);
  document.querySelector('.panel').appendChild(panel);
}

async function makeShot(indices){
  // schrijf shot entries (push) en bepaal resultaten
  const boardsSnap = await dbGet(dbRef(db, 'lobbies/' + code + '/boards'));
  const boards = boardsSnap.val() || {};
  if(!boards[opponentRole]) return alert('Tegenstander nog niet klaar.');
  const oppCells = boards[opponentRole].cells || [];
  const updates = {};
  const results = [];
  for(const idx of indices){
    const isHit = oppCells.includes(parseInt(idx));
    const res = isHit ? 'hit' : 'miss';
    results.push({ index: idx, result: res });
    const newKey = dbPush(dbRef(db, 'lobbies/' + code + '/shots')).key;
    updates[`lobbies/${code}/shots/${newKey}`] = { index: idx, byRole: role, result: res, ts: Date.now() };
  }
  await dbUpdate(dbRef(db, '/'), updates);

  // bepaal nieuwe turn
  if(mode === 'classic') turn = (turn === 'host') ? 'guest' : 'host';
  else if(mode === 'streak'){
    const anyHit = results.some(r=> r.result === 'hit');
    if(!anyHit) turn = (turn === 'host') ? 'guest' : 'host';
  } else if(mode === 'power'){
    turn = (turn === 'host') ? 'guest' : 'host';
  }
  await dbSetIfNeeded(`lobbies/${code}/turn`, turn);

  appendLog(`Je schoot op ${indices.join(', ')} => ${results.map(r=> r.result).join(', ')}`);

  // herlaad en check win
  await new Promise(r => setTimeout(r, 200));
  await checkWin();
}

async function dbSetIfNeeded(path, val){
  // helper: dbUpdate single pad
  const obj = {};
  obj[path] = val;
  // Using update at root because dbUpdate(dbRef(db,'/'), obj) expects full path as keys
  await dbUpdate(dbRef(db, '/'), obj);
}

function appendLog(t){
  const p = document.createElement('div'); p.textContent = t;
  gameLog.prepend(p);
}

async function checkWin(){
  const boardsSnap = await dbGet(dbRef(db, 'lobbies/' + code + '/boards'));
  const boards = boardsSnap.val() || {};
  if(!boards.host || !boards.guest) return;
  const hostCells = boards.host.cells || [];
  const guestCells = boards.guest.cells || [];

  const shotsSnap = await dbGet(dbRef(db, 'lobbies/' + code + '/shots'));
  const shots = shotsSnap.val() || {};
  const hitOnHost = new Set();
  const hitOnGuest = new Set();
  Object.values(shots).forEach(e=>{
    if(e.result !== 'hit') return;
    if(e.byRole === 'host') hitOnGuest.add(parseInt(e.index));
    else hitOnHost.add(parseInt(e.index));
  });

  const guestLost = guestCells.length>0 && guestCells.every(c => hitOnGuest.has(parseInt(c)));
  const hostLost  = hostCells.length>0 && hostCells.every(c => hitOnHost.has(parseInt(c)));
  if(guestLost || hostLost){
    finished = true;
    const winnerName = guestLost ? lobby.players.host : lobby.players.guest;
    await dbUpdate(dbRef(db, '/'), {
      [`lobbies/${code}/status`]: 'finished',
      [`lobbies/${code}/winner`]: winnerName
    });
    appendLog('Spel afgelopen — winnaar: ' + winnerName);
    turnPopup.textContent = 'Spel afgelopen — winnaar: ' + winnerName;
  }
}

async function leave(){
  if(!confirm('Weet je zeker dat je wil verlaten?')) return;
  // verwijder jezelf uit players (optioneel)
  const playersSnap = await dbGet(dbRef(db, 'lobbies/' + code + '/players'));
  const players = playersSnap.val() || {};
  if(players[role]) await dbUpdate(dbRef(db, '/'), { [`lobbies/${code}/players/${role}`]: null });
  localStorage.removeItem('lobbyCode');
  location.href = 'lobby.html';
}

async function restart(){
  if(!confirm('Start nieuwe lobby (je wordt host)?')) return;
  const newCode = Math.floor(1000 + Math.random()*9000).toString();
  const lobbyObj = { players: { host: player }, status: 'waiting', mode: mode, created: Date.now() };
  await dbUpdate(dbRef(db, '/'), { [`lobbies/${newCode}`]: lobbyObj });
  // remove self from old lobby for cleanliness
  await dbUpdate(dbRef(db, '/'), { [`lobbies/${code}/players/${role}`]: null });
  localStorage.setItem('lobbyCode', newCode);
  location.href = 'place-ships.html';
}
