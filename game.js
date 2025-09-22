// game.js
import { db } from "./firebase-config.js";
import { loadLocalProfile } from "./app-auth.js";
import {
  ref, get, set, onValue, push, runTransaction, update
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const qs = new URLSearchParams(location.search);
const lobbyCode = qs.get("lobby");
const profile = loadLocalProfile();
if (!profile){ alert('Je moet eerst inloggen.'); location.href = 'index.html'; }

const $ = id => document.getElementById(id);
const boardMeEl = $("board-me"), boardOpEl = $("board-op");
const infoLobby = $("info-lobby"), infoPlayer = $("info-player"), infoTurn = $("info-turn");
const btnRandom = $("btn-random"), btnReady = $("btn-ready"), btnRotate = $("btn-rotate");
const readyBadgeMe = $("ready-badge-me"), readyBadgeOp = $("ready-badge-op");
const overlay = $("overlay"), overlayContent = $("overlay-content"), overlayActions = $("overlay-actions");
const logEl = $("log"), headerSub = $("header-sub");

let gameId = null, size = 10, myId = profile.uid, myBoard = {}, oppBoard = {}, placing = true;
let orientation = 'H', shipSizes = [5,4,3,3,2], placedShips = []; // placedShips = [{id, cells: []}, ...]
let currentShipIndex = 0;

/* UI helpers */
function log(msg){ const d = document.createElement("div"); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }
function alpha(n){ return String.fromCharCode(65+n); }
function cellName(r,c){ return `${alpha(r)}${c+1}`; }
function showOverlay(html, actionsHtml){
  overlayContent.innerHTML = html;
  overlayActions.innerHTML = actionsHtml || '<button id="overlay-close">OK</button>';
  overlay.classList.remove('hidden');
  // attach default close
  const close = document.getElementById('overlay-close');
  if (close) close.onclick = ()=> overlay.classList.add('hidden');
}
function showPopupTemp(html, ms=1800){
  showOverlay(html, '<button id="overlay-close">OK</button>');
  setTimeout(()=> overlay.classList.add('hidden'), ms);
}

/* Grid creation */
function createGrid(el, n){
  el.innerHTML = '';
  el.classList.remove('cell-5','cell-10','cell-15');
  el.classList.add(`cell-${n}`);
  el.style.gridTemplateRows = `repeat(${n},1fr)`;
  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const tile = document.createElement('div');
      tile.className = 'tile sea';
      tile.dataset.r = r; tile.dataset.c = c; tile.dataset.cell = cellName(r,c);
      el.appendChild(tile);
    }
  }
}

/* setSize & board reset */
function setSize(n){
  size = n;
  createGrid(boardMeEl, n);
  createGrid(boardOpEl, n);
  myBoard = {}; oppBoard = {}; placedShips = [];
  for(let r=0;r<size;r++) for(let c=0;c<size;c++) myBoard[cellName(r,c)] = 'empty';
  if (n>=15) shipSizes = [5,4,4,3,3,2];
  else if (n>=10) shipSizes = [5,4,3,3,2];
  else shipSizes = [3,2,2];
  renderShipList(); renderBoards();
}

/* render */
function renderBoards(){
  Array.from(boardMeEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.className = 'tile sea';
    tile.innerHTML = '';
    if (myBoard[id] === 'ship') tile.classList.add('ship');
    if (myBoard[id] === 'hit') { tile.classList.add('hit'); tile.innerHTML = '💥'; }
    if (myBoard[id] === 'miss') { tile.classList.add('miss'); tile.innerHTML = '🌊'; }
    if (myBoard[id] === 'sunk') { tile.classList.add('hit'); tile.innerHTML = '☠️'; }
  });

  Array.from(boardOpEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.className = 'tile sea';
    tile.innerHTML = '';
    if (oppBoard[id] === 'hit'){ tile.classList.add('hit'); tile.innerHTML = '🔥'; }
    if (oppBoard[id] === 'miss'){ tile.classList.add('miss'); tile.innerHTML = '🌊'; }
    if (oppBoard[id] === 'sunk'){ tile.classList.add('hit'); tile.innerHTML = '☠️'; }
  });
}

/* ship-list UI */
function renderShipList(){
  const wrap = $("ship-list");
  wrap.innerHTML = '';
  shipSizes.forEach((s,i)=>{
    const pill = document.createElement('div');
    pill.className = 'ship-pill' + (i===currentShipIndex ? ' active' : '');
    pill.textContent = `Ship ${i+1} — ${s>0?s:"placed"}`;
    pill.addEventListener('click', ()=>{ if (s>0) currentShipIndex = i; renderShipList(); });
    wrap.appendChild(pill);
  });
}

/* placement helpers */
function canPlace(startR,startC,sizeShip,orient){
  const coords = [];
  for(let i=0;i<sizeShip;i++){
    const r = startR + (orient==='V'?i:0);
    const c = startC + (orient==='H'?i:0);
    if (r<0 || r>=size || c<0 || c>=size) return null;
    coords.push(cellName(r,c));
  }
  for(const cell of coords) if (myBoard[cell] === 'ship') return null;
  return coords;
}

function placeShipAt(cellId){
  if (!placing) return;
  const r = cellId.charCodeAt(0)-65;
  const c = parseInt(cellId.slice(1),10)-1;
  const s = shipSizes[currentShipIndex];
  if (!s || s<=0){ showPopupTemp('Geen schip geselecteerd'); return; }
  const coords = canPlace(r,c,s,orientation);
  if (!coords){ showPopupTemp('Kan hier niet plaatsen'); return; }
  coords.forEach(k=> myBoard[k] = 'ship');
  // store placed ship
  const shipId = 'ship_' + Date.now() + '_' + Math.floor(Math.random()*9999);
  placedShips.push({ id: shipId, cells: coords });
  shipSizes[currentShipIndex] = 0;
  while(currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++;
  renderShipList(); renderBoards();
}

/* random place that also records placedShips */
function randomPlaceAll(){
  for(const k in myBoard) myBoard[k] = 'empty';
  placedShips = [];
  const sizes = shipSizes.map(x=>x).filter(x=>x>0);
  for(const s of sizes){
    let tries = 0, placed=false;
    while(!placed && tries<500){
      const r = Math.floor(Math.random()*size);
      const c = Math.floor(Math.random()*size);
      const o = Math.random()<0.5 ? 'H':'V';
      const coords = canPlace(r,c,s,o);
      if (coords){
        coords.forEach(k=> myBoard[k]='ship');
        placedShips.push({ id: 'ship_'+Date.now()+'_'+Math.floor(Math.random()*9999), cells: coords });
        placed=true;
      }
      tries++;
    }
  }
  for(let i=0;i<shipSizes.length;i++) shipSizes[i]=0;
  renderShipList(); renderBoards();
}

/* save board + ships to DB and mark ready */
async function saveBoard(){
  if (!gameId) return;
  await set(ref(db, `games/${gameId}/players/${myId}/board`), myBoard);
  await set(ref(db, `games/${gameId}/players/${myId}/ships`), placedShips);
  await set(ref(db, `games/${gameId}/players/${myId}/ready`), true);
  placing = false;
  readyBadgeMe.textContent = '✔️ Klaar';
  showPopupTemp('Je staat klaar — wacht op tegenstander...');
  log('Board opgeslagen.');
}

/* cannon animation */
function fireAnimation(targetTile, cb){
  const img = document.createElement('img');
  img.src = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRsonFTFUeLaut_val1poYgUuCph8s9N2FJBg&s';
  img.className = 'shot';
  cannonArea.appendChild(img);
  const cannonRect = document.getElementById('cannon') ? document.getElementById('cannon').getBoundingClientRect() : {left:20, top:0, width:80, height:40};
  const targetRect = targetTile.getBoundingClientRect();
  const parentRect = cannonArea.getBoundingClientRect();
  const startX = cannonRect.left + cannonRect.width/2 - parentRect.left;
  const startY = cannonRect.top + cannonRect.height/2 - parentRect.top;
  const endX = targetRect.left + targetRect.width/2 - parentRect.left;
  const endY = targetRect.top + targetRect.height/2 - parentRect.top;
  img.style.left = startX + 'px'; img.style.top = startY + 'px';
  const dx = endX - startX, dy = endY - startY;
  requestAnimationFrame(()=> img.style.transform = `translate(${dx}px, ${dy}px) rotate(10deg) scale(0.9)`);
  setTimeout(()=>{ img.classList.add('hide'); setTimeout(()=>{ img.remove(); if (cb) cb(); },220); },780);
}

/* check ship sunk: if cell in one ship -> check all its cells are 'hit' */
function getShipContainingCell(ships, cell){
  for(const s of ships) if (s.cells.includes(cell)) return s;
  return null;
}

/* when a ship is sunk: animate pop on all its tiles and mark as 'sunk' */
function animateShipSunk(cells){
  // simple pop: scale up and pulse
  cells.forEach(cell=>{
    const tile = document.querySelector(`#board-me [data-cell="${cell}"]`) || document.querySelector(`#board-op [data-cell="${cell}"]`);
    if (!tile) return;
    tile.classList.add('sunk-pop');
    setTimeout(()=> tile.classList.remove('sunk-pop'), 1200);
  });
}

/* make move using transaction on target cell */
async function makeMove(cell){
  if (!gameId) return;
  // get game + opponent id
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val();
  if (!g) return;
  const players = g.players || {};
  let targetId = null;
  for(const pid in players) if (pid !== myId) targetId = pid;
  if (!targetId){ alert('Geen tegenstander'); return; }

  try {
    // push move record
    const mv = push(ref(db, `games/${gameId}/moves`));
    await set(mv, { by: myId, cell, ts: Date.now(), status: 'processing' });

    // run transaction on target player's board cell
    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, current=>{
      if (!current || current === 'empty') return 'miss';
      if (current === 'ship') return 'hit';
      return; // already resolved
    });

    const resSnap = await get(cellRef);
    const result = resSnap.val();
    await set(ref(db, `games/${gameId}/moves/${mv.key}/result`), result);

    // if hit -> check if ship sunk
    if (result === 'hit'){
      // get target ships
      const shipsSnap = await get(ref(db, `games/${gameId}/players/${targetId}/ships`));
      const ships = shipsSnap.exists() ? shipsSnap.val() : [];
      // ships is an array of objects; iterate
      const shipObj = getShipContainingCell(ships, cell);
      if (shipObj){
        // check board cells for that ship
        let allHit = true;
        for(const c of shipObj.cells){
          const stateSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board/${c}`));
          const st = stateSnap.exists() ? stateSnap.val() : 'empty';
          if (st !== 'hit') { allHit = false; break; }
        }
        if (allHit){
          // mark those cells as sunk (for target player's board)
          const updates = {};
          for(const c of shipObj.cells){
            updates[`games/${gameId}/players/${targetId}/board/${c}`] = 'sunk';
            // also reveal to opponent (so oppBoard shows sunk)
            updates[`games/${gameId}/players/${myId}/revealed/${c}`] = 'sunk';
          }
          await update(ref(db, `/`), updates);
          // add a move note
          await set(ref(db, `games/${gameId}/moves/${mv.key}/sunkShipId`), shipObj.id);
        }
      }
    } else {
      // miss
      await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), 'miss');
    }

    // set next turn to target (switch)
    await set(ref(db, `games/${gameId}/turnUid`), targetId);

    // after move, check for victory: if target has any 'ship' left?
    const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
    const tboard = targetBoardSnap.exists() ? targetBoardSnap.val() : {};
    const hasShipLeft = Object.values(tboard).some(v => v === 'ship');
    if (!hasShipLeft){
      // current player (myId) wins
      await set(ref(db, `games/${gameId}/status`), 'finished');
      await set(ref(db, `games/${gameId}/winner`), myId);
      // update stats if winner is not guest
      const winnerProfileSnap = await get(ref(db, `users/${myId}/profile`));
      if (winnerProfileSnap.exists()){
        // increment wins atomically
        const winsRef = ref(db, `users/${myId}/stats/wins`);
        await runTransaction(winsRef, cur => (cur||0) + 1);
      }
    }

  } catch(e){
    console.error('move error', e);
    showPopupTemp('Kon zet niet doen: ' + (e.message || e));
  }
}

/* listen for moves and animate */
function listenMoves(){
  onValue(ref(db, `games/${gameId}/moves`), async snap=>{
    const moves = snap.val() || {};
    const keys = Object.keys(moves);
    if (!keys.length) return;
    const last = moves[keys[keys.length-1]];
    // animate appropriate tile
    const tileSel = (last.by === myId) ? `#board-op [data-cell="${last.cell}"]` : `#board-me [data-cell="${last.cell}"]`;
    const tile = document.querySelector(tileSel);
    if (tile){
      fireAnimation(tile, async ()=>{
        // after animation refresh boards which will show hits/misses/sunk
        await refreshBoards();
        // if last move contained sunkShipId -> animate sunk
        if (last.sunkShipId){
          // fetch ships for appropriate player
          const target = (last.by === myId) ? (await get(ref(db, `games/${gameId}/players/${(await get(ref(db, `games/${gameId}`))).val().players ? Object.keys((await get(ref(db, `games/${gameId}/players`))).val())[1] : null`))) : null;
          // simpler: fetch both players ships and find ship with id
          const pSnap = await get(ref(db, `games/${gameId}/players`));
          const playersObj = pSnap.val() || {};
          for(const pid in playersObj){
            const shipsSnap = await get(ref(db, `games/${gameId}/players/${pid}/ships`));
            if (!shipsSnap.exists()) continue;
            const ships = shipsSnap.val() || [];
            const ship = ships.find(s=> s.id === last.sunkShipId);
            if (ship){
              animateShipSunk(ship.cells);
              showPopupTemp(`Ship gezonken!`);
              break;
            }
          }
        }
      });
    } else {
      await refreshBoards();
    }
  });
}

/* refresh boards from DB (player boards + revealed info) */
async function refreshBoards(){
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val() || {};
  infoTurn.textContent = (g.turnUid === myId) ? 'Jij' : 'Tegenstander';
  readyBadgeMe.textContent = ''; readyBadgeOp.textContent = '';
  const players = g.players || {};
  for(const pid in players){
    const p = players[pid];
    if (pid === myId){
      const b = p.board || {};
      for(const k in b) myBoard[k] = b[k];
      if (p.ready) readyBadgeMe.textContent = '✔️ Klaar';
    } else {
      const b = p.board || {};
      for(const k in b){
        if (b[k] === 'hit' || b[k] === 'miss' || b[k] === 'sunk') oppBoard[k] = b[k];
      }
      if (p.ready) readyBadgeOp.textContent = '✔️ Klaar';
    }
  }

  renderBoards();

  // if game finished, show winner/loser overlay
  if (g.status === 'finished'){
    const winner = g.winner;
    if (winner === myId){
      showOverlay('<h2>Je hebt gewonnen! 🏆</h2><p>Gefeliciteerd!</p>', '<button id="overlay-close">OK</button>');
      // large win animation: we add a confetti-like simple effect (pulse)
      document.body.classList.add('win-anim');
      setTimeout(()=> document.body.classList.remove('win-anim'), 2500);
    } else {
      showOverlay('<h2>Je hebt verloren</h2><p>Volgende keer beter!</p>', '<button id="overlay-close">OK</button>');
      document.body.classList.add('lose-anim');
      setTimeout(()=> document.body.classList.remove('lose-anim'), 2500);
    }
  }
}

/* init flow */
async function init(){
  if (!lobbyCode){ alert('Geen lobby code.'); location.href='index.html'; return; }
  infoLobby.textContent = lobbyCode;
  infoPlayer.textContent = profile.username || profile.uid;
  // load lobby -> find gameId
  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()){ alert('Lobby niet gevonden'); location.href='index.html'; return; }
  const lobby = lobbySnap.val();
  gameId = lobby.gameId;
  setSize(lobby.gamemode || 10);

  // ensure player present in game players
  const meRef = ref(db, `games/${gameId}/players/${myId}`);
  const meSnap = await get(meRef);
  if (!meSnap.exists()){
    // join
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
    await set(meRef, { name: profile.username, slot, ready: false });
  }

  // UI events
  boardMeEl.addEventListener('click', e=>{
    const t = e.target.closest('.tile'); if (!t) return;
    placeShipAt(t.dataset.cell);
  });

  boardOpEl.addEventListener('click', async e=>{
    const t = e.target.closest('.tile'); if (!t) return;
    const cell = t.dataset.cell;
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val();
    if (!g) return;
    if (g.turnUid !== myId){ showPopupTemp('Niet jouw beurt'); return; }
    if (oppBoard[cell] === 'hit' || oppBoard[cell] === 'miss' || oppBoard[cell] === 'sunk'){ showPopupTemp('Al geschoten op deze cel'); return; }
    // proceed: push move via makeMove()
    await makeMove(cell);
  });

  btnRandom.addEventListener('click', ()=> randomPlaceAll());
  btnReady.addEventListener('click', async ()=>{
    // save board and ships to DB
    await saveBoard();
    // check if both ready -> start game and set turn
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    const players = playersSnap.val() || {};
    const ids = Object.keys(players);
    if (ids.length >= 2){
      const bothReady = ids.every(id => players[id].ready);
      if (bothReady){
        const starter = ids[Math.floor(Math.random()*ids.length)];
        await set(ref(db, `games/${gameId}/status`), 'in_progress');
        await set(ref(db, `games/${gameId}/turnUid`), starter);
        showOverlay('<h2>Game start!</h2><p>Veel succes — de game begint nu.</p>', '<button id="overlay-close">Ok</button>');
      } else {
        showPopupTemp('Wachten op tegenstander...');
      }
    } else {
      showPopupTemp('Wachten op een speler om te joinen...');
    }
  });

  btnRotate.addEventListener('click', ()=>{ orientation = orientation === 'H' ? 'V' : 'H'; btnRotate.textContent = `Rotate (${orientation})`; });

  // listen game players changes (show ready badges)
  onValue(ref(db, `games/${gameId}/players`), async snap=>{
    const players = snap.val() || {};
    // if both present and ready, starting logic is in btnReady above and DB listener below
    // update local ready badges
    for(const pid in players){
      const p = players[pid];
      if (pid === myId){
        if (p.ready) readyBadgeMe.textContent = '✔️ Klaar';
      } else {
        if (p.ready) readyBadgeOp.textContent = '✔️ Klaar';
      }
    }
  });

  // main game listener: status changes, turn changes, etc
  onValue(ref(db, `games/${gameId}`), async snap=>{
    const g = snap.val();
    if (!g) return;
    // if status changed to in_progress and we weren't placing -> show start popup
    if (g.status === 'in_progress') {
      // shows start popup if we just switched to in_progress
      headerSub.textContent = `Gamemode: ${size}×${size}`;
    }
    // if finished -> show winner/loser handled by refreshBoards
    await refreshBoards();
  });

  listenMoves();
  renderBoards();
}

init();
