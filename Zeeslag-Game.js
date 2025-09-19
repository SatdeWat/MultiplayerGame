// js/game.js
import { db } from "./firebase-config.js";
import { ref, get, set, onValue, push, update, child, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { loadLocalProfile, deriveDeterministicId } from "./app-auth.js";

const qs = new URLSearchParams(location.search);
const lobbyCode = qs.get('lobby');

const getEl = id => document.getElementById(id);
const profile = loadLocalProfile() || { name:'Gast', username:'gast', age:'', id: 'guest'+Math.floor(Math.random()*9999) };

const infoLobby = getEl('info-lobby'), infoPlayer = getEl('info-player'), infoTurn = getEl('info-turn'),
      boardMeEl = getEl('board-me'), boardOpEl = getEl('board-op'),
      btnRandom = getEl('btn-random'), btnReady = getEl('btn-ready'),
      timerWrap = getEl('placement-timer'), timerCountEl = getEl('timer-count'),
      cannonArea = getEl('cannon-area'), logEl = getEl('log');

let gameId = null, gameRef = null, mySlot = null, myId = profile.id, gamemode = 10;
let size = 10;
let myBoard = {}; // cell => 'empty'|'ship'|'hit'|'miss'|'sunk'
let oppBoard = {}; // revealed states
let placementTimer = null;
let placingTimeLeft = 30;
let canPlace = false;

function log(msg){ const p = document.createElement('div'); p.textContent = msg; logEl.prepend(p); }

function alpha(n){ return String.fromCharCode(65 + n); }
function cellName(r,c){ return `${alpha(r)}${c+1}`; }
function createGrid(el, n){
  el.innerHTML = '';
  el.classList.remove('cell-5','cell-10','cell-15');
  el.classList.add(`cell-${n}`);
  el.style.gridTemplateRows = `repeat(${n},1fr)`;
  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const cell = document.createElement('div');
      cell.className = 'tile sea';
      cell.dataset.r = r; cell.dataset.c = c; cell.dataset.cell = cellName(r,c);
      el.appendChild(cell);
    }
  }
}

function setSize(n){
  size = n;
  createGrid(boardMeEl, n);
  createGrid(boardOpEl, n);
  // reset in memory
  myBoard = {}; oppBoard = {};
  for(let r=0;r<size;r++) for(let c=0;c<size;c++) myBoard[cellName(r,c)] = 'empty';
}

function startPlacementTimer(){
  placingTimeLeft = 30;
  timerWrap.classList.remove('hidden');
  timerCountEl.textContent = placingTimeLeft;
  canPlace = true;
  placementTimer = setInterval(()=>{
    placingTimeLeft--;
    timerCountEl.textContent = placingTimeLeft;
    if (placingTimeLeft <= 0){
      clearInterval(placementTimer);
      canPlace = false;
      timerWrap.classList.add('hidden');
      autoReady();
    }
  }, 1000);
}

function stopPlacementTimer(){
  if (placementTimer) clearInterval(placementTimer);
  timerWrap.classList.add('hidden');
  canPlace = false;
}

function placeShipAt(cellId){
  if (!canPlace) return;
  // simple toggle single-cell ships for prototype
  if (myBoard[cellId] === 'ship') myBoard[cellId] = 'empty';
  else myBoard[cellId] = 'ship';
  renderBoards();
}

function renderBoards(){
  // own board
  Array.from(boardMeEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.classList.remove('ship','hit','miss');
    tile.classList.add('sea');
    if (myBoard[id] === 'ship') { tile.classList.add('ship'); }
    if (myBoard[id] === 'hit') { tile.classList.add('hit'); tile.innerHTML = '<div class="reveal">💥</div>'; }
    else if (myBoard[id] === 'miss') { tile.classList.add('miss'); tile.innerHTML = '<div class="reveal">🌊</div>'; }
    else tile.innerHTML = '';
  });

  // opponent board (only show hits/misses)
  Array.from(boardOpEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.classList.remove('ship','hit','miss');
    tile.classList.add('sea');
    if (oppBoard[id] === 'hit'){ tile.classList.add('hit'); tile.innerHTML = '<div class="reveal">🔥</div>'; }
    else if (oppBoard[id] === 'miss'){ tile.classList.add('miss'); tile.innerHTML = '<div class="reveal">🌊</div>'; }
    else tile.innerHTML = '';
  });
}

/* Random placement: for simplicity place random single-cell ships count = Math.floor(size*0.1 * size) */
function randomPlace(){
  // clear
  for(let k in myBoard) myBoard[k] = 'empty';
  const count = Math.max(1, Math.floor(size * 0.75)); // around size ships
  const cells = Object.keys(myBoard);
  for(let i=0;i<count;i++){
    const c = cells[Math.floor(Math.random()*cells.length)];
    myBoard[c] = 'ship';
  }
  renderBoards();
}

async function saveBoardToDB(){
  if (!gameId) return;
  const playersRef = ref(db, `games/${gameId}/players/${myId}`);
  await set(ref(db, `games/${gameId}/players/${myId}/board`), myBoard);
  await set(ref(db, `games/${gameId}/players/${myId}/ready`), true);
  stopPlacementTimer();
}

/* Launch cannon animation from cannon to tile */
function fireAnimation(targetTile, callback){
  const shot = document.createElement('img');
  shot.src = 'assets/shot.svg';
  shot.className = 'shot';
  cannonArea.appendChild(shot);
  // compute positions
  const cannonRect = document.getElementById('cannon').getBoundingClientRect();
  const targetRect = targetTile.getBoundingClientRect();
  const parentRect = cannonArea.getBoundingClientRect();
  const startX = cannonRect.left + cannonRect.width/2 - parentRect.left;
  const startY = cannonRect.top + cannonRect.height/2 - parentRect.top;
  const endX = targetRect.left + targetRect.width/2 - parentRect.left;
  const endY = targetRect.top + targetRect.height/2 - parentRect.top;
  shot.style.left = startX + 'px';
  shot.style.top = startY + 'px';
  // animate using transform
  const dx = endX - startX;
  const dy = endY - startY;
  requestAnimationFrame(()=>{
    shot.style.transform = `translate(${dx}px, ${dy}px) scale(0.8)`;
  });
  setTimeout(()=>{
    shot.classList.add('hide');
    setTimeout(()=>{ shot.remove(); if (callback) callback(); }, 250);
  }, 750);
}

/* handle clicking opponent tile to make a move */
async function handleOpClick(event){
  if (!event.target.classList.contains('tile')) return;
  const cell = event.target.dataset.cell;
  // basic check: only allow when it's your turn
  const gameSnapshot = await get(ref(db, `games/${gameId}`));
  const gameVal = gameSnapshot.val();
  if (!gameVal) return;
  if (gameVal.turnUid !== myId){ alert('Niet jouw beurt'); return; }
  // prevent double clicking same cell
  if (oppBoard[cell] === 'hit' || oppBoard[cell] === 'miss'){ alert('Al geschoten op deze cel'); return; }

  // write move to DB using transaction to avoid race
  const movesRef = ref(db, `games/${gameId}/moves`);
  const newMoveRef = push(movesRef);
  await set(newMoveRef, { by: myId, cell, timestamp: Date.now() });

  // The move result will be computed by clients via listening -> for our simple approach, the clients check opponent board and set result locally by writing result node
  // Here we let the owner of the target player's board process (simple approach)
}

/* Listen for moves and process them */
function listenMoves(){
  const movesRef = ref(db, `games/${gameId}/moves`);
  onValue(movesRef, async snap=>{
    const moves = snap.val() || {};
    // pick last move
    const keys = Object.keys(moves);
    if (keys.length === 0) return;
    const last = moves[keys[keys.length -1]];
    if (!last._processed){
      // process: determine result by checking boards
      const by = last.by, cell = last.cell;
      // find target player (the opponent of 'by')
      const g = (await get(ref(db, `games/${gameId}`))).val();
      if (!g) return;
      const players = g.players || {};
      let targetId = null;
      for (let pid in players) if (pid !== by) targetId = pid;
      if (!targetId) return;
      const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
      const targetBoard = targetBoardSnap.val() || {};
      const result = (targetBoard[cell] === 'ship') ? 'hit' : 'miss';

      // mark on DB: moves/{key}/result and update target player's board if hit
      const moveKey = keys[keys.length-1];
      await update(ref(db, `games/${gameId}/moves/${moveKey}`), { result });

      if (result === 'hit'){
        await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), 'hit');
        // optionally check for sunk / loss...
      } else {
        await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), 'miss');
      }

      // change turn to other player
      await set(ref(db, `games/${gameId}/turnUid`), targetId);
    }

    // update local view of moves to animate
    // For simplicity animate last move
    const lastCell = last.cell;
    // find DOM tile in opponent board if this client is the shooter, else in own board
    let targetTile = null;
    if (last.by === myId){
      targetTile = boardOpEl.querySelector(`[data-cell="${lastCell}"]`);
    } else {
      targetTile = boardMeEl.querySelector(`[data-cell="${lastCell}"]`);
    }
    if (targetTile){
      fireAnimation(targetTile, ()=> {
        // after animation, refresh boards from DB
        refreshBoardsFromDB();
      });
    } else {
      refreshBoardsFromDB();
    }
  });
}

/* refresh boards from DB: read both players boards and update local view */
async function refreshBoardsFromDB(){
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val();
  if (!g) return;
  infoTurn.textContent = g.turnUid === myId ? 'Jij' : 'Tegenstander';
  // update players
  const players = g.players || {};
  for (let pid in players){
    if (pid === myId){
      const b = players[pid].board || {};
      myBoard = Object.assign(myBoard, b);
      mySlot = players[pid].slot;
    } else {
      const b = players[pid].board || {};
      // only reveal hits/misses to opponent
      for (let k in b){
        if (b[k] === 'hit' || b[k] === 'miss') oppBoard[k] = b[k];
      }
    }
  }
  renderBoards();
}

/* Start game: called when page loads and game exists */
async function init(){
  if (!lobbyCode) { alert('Geen lobby code. Ga terug naar lobby.'); return; }
  getEl('info-lobby').textContent = lobbyCode;
  getEl('info-player').textContent = profile.name;

  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()) { alert('Lobby niet gevonden'); return; }
  const lobby = lobbySnap.val();
  gameId = lobby.gameId;
  gamemode = parseInt(lobby.gamemode || 10,10);
  setSize(gamemode);
  gameRef = ref(db, `games/${gameId}`);

  // add presence: if we are not already in players, ensure our player data is present
  const meRef = ref(db, `games/${gameId}/players/${myId}`);
  const meSnap = await get(meRef);
  if (!meSnap.exists()){
    // try to join as slot 1 if vacancy
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    let slot = 1;
    if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
    await set(meRef, { name: profile.name, slot, ready:false });
  }

  // render UI and events
  boardMeEl.addEventListener('click', e=>{
    if (!e.target.classList.contains('tile')) return;
    const cell = e.target.dataset.cell;
    placeShipAt(cell);
  });
  boardOpEl.addEventListener('click', handleOpClick);
  btnRandom.addEventListener('click', randomPlace);
  btnReady.addEventListener('click', saveBoardToDB);

  // start placement timer automatically when both players joined and not ready
  onValue(ref(db, `games/${gameId}/players`), snap=>{
    const players = snap.val() || {};
    const count = Object.keys(players).length;
    if (count >= 2){
      // if both players are present, each client starts placement timer if they haven't placed
      const me = players[myId] || {};
      if (!me.ready && !canPlace){
        startPlacementTimer();
      }
    }
  });

  // listen moves
  listenMoves();

  // listen board changes for realtime update
  onValue(ref(db, `games/${gameId}`), snap=>{
    const g = snap.val();
    if (!g) return;
    // update turn showing
    infoTurn.textContent = g.turnUid === myId ? 'Jij' : 'Tegenstander';
    // refresh boards
    refreshBoardsFromDB();
  });

  renderBoards();
}

init();
