// game.js (Vervanging: voorkomt pop-up spam bij ontbrekend profiel)
// Belangrijk: plak dit volledig in je repo als js/game.js (of root als je dat daar hebt)

import { db } from "./firebase-config.js";
import { loadLocalProfile } from "./app-auth.js";
import {
  ref, get, set, onValue, push, runTransaction, update
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* ======== SAFETY CHECK (NO POPUPS/ALERTS) ========
   - Als er geen profiel is: éénmaal redirecten naar index.html (non-blocking).
   - Daarna stopt het script (geen alerts, geen overlays, geen loop).
   - Hierdoor kun je altijd inloggen op index.html zonder spam.
==================================================*/
const profile = loadLocalProfile();
let ZS_NO_PROFILE = false;
if (!profile) {
  // probeer éénmalig te redirecten (alleen als we niet al op index staan)
  const path = (location.pathname || "").toLowerCase();
  const alreadyIndex = path.endsWith("index.html") || path === "/" || path === "";
  const alreadyRedirected = sessionStorage.getItem("zs_redirected_once");
  if (!alreadyIndex && !alreadyRedirected) {
    try {
      sessionStorage.setItem("zs_redirected_once", "1");
      // non-blocking redirect (geen alerts)
      window.location.href = "index.html";
    } catch (e) {
      console.warn("Redirect naar index mislukt (ignored):", e);
    }
  } else {
    // blijf op pagina en stop script; geen popups
    console.warn("Geen profiel gevonden — game script stopt zonder popups.");
  }
  ZS_NO_PROFILE = true;
}

/* --- rest van de variabelen; veilig met mogelijk ontbrekend profile --- */
const qs = new URLSearchParams(location.search);
const lobbyCode = qs.get("lobby");
const profileSafe = profile || null; // kan null zijn als geen profiel
const myId = profileSafe ? profileSafe.uid : null;

const $ = id => document.getElementById(id);
const boardMeEl = $("board-me"), boardOpEl = $("board-op");
const infoLobby = $("info-lobby"), infoPlayer = $("info-player"), infoTurn = $("info-turn");
const btnRandom = $("btn-random"), btnReady = $("btn-ready"), btnRotate = $("btn-rotate");
const readyBadgeMe = $("ready-badge-me"), readyBadgeOp = $("ready-badge-op");
const overlay = $("overlay"), overlayContent = $("overlay-content"), overlayActions = $("overlay-actions");
const logEl = $("log"), headerSub = $("header-sub");
const cannonArea = $("cannon-area");

let gameId = null, size = 10, myBoard = {}, oppBoard = {}, placing = true;
let orientation = 'H', shipSizes = [5,4,3,3,2], placedShips = [];
let currentShipIndex = 0;

/* helper functies */
function log(msg){ const d = document.createElement("div"); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; if(logEl) logEl.prepend(d); else console.log(msg); }
function alpha(n){ return String.fromCharCode(65+n); }
function cellName(r,c){ return `${alpha(r)}${c+1}`; }
function showPopupTemp(text, ms = 1500){
  // geen blocking alerts — we tonen enkel een kort overlay als die bestaat,
  // maar we doen niets wat het UI blokkeert. Als overlay element ontbreekt, console.log.
  if (overlay && overlayContent && overlayActions) {
    overlayContent.innerHTML = `<div style="font-weight:700">${text}</div>`;
    overlayActions.innerHTML = `<button id="overlay-close">OK</button>`;
    overlay.classList.remove("hidden");
    const btn = document.getElementById("overlay-close");
    if (btn) btn.onclick = () => overlay.classList.add("hidden");
    setTimeout(()=>{ if (overlay) overlay.classList.add("hidden"); }, ms);
  } else {
    console.log("info:", text);
  }
}

/* grid en render */
function createGrid(el, n){
  if(!el) return;
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

function renderBoards(){
  if(boardMeEl) Array.from(boardMeEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.className = 'tile sea';
    tile.innerHTML = '';
    if (myBoard[id] === 'ship') tile.classList.add('ship');
    if (myBoard[id] === 'hit') { tile.classList.add('hit'); tile.innerHTML = '💥'; }
    if (myBoard[id] === 'miss') { tile.classList.add('miss'); tile.innerHTML = '🌊'; }
    if (myBoard[id] === 'sunk') { tile.classList.add('sunk'); tile.innerHTML = '☠️'; }
  });
  if(boardOpEl) Array.from(boardOpEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.className = 'tile sea';
    tile.innerHTML = '';
    if (oppBoard[id] === 'hit'){ tile.classList.add('hit'); tile.innerHTML = '🔥'; }
    if (oppBoard[id] === 'miss'){ tile.classList.add('miss'); tile.innerHTML = '🌊'; }
    if (oppBoard[id] === 'sunk'){ tile.classList.add('sunk'); tile.innerHTML = '☠️'; }
  });
}

function renderShipList(){
  const wrap = $("ship-list");
  if(!wrap) return;
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
  const shipId = 'ship_' + Date.now() + '_' + Math.floor(Math.random()*9999);
  placedShips.push({ id: shipId, cells: coords });
  shipSizes[currentShipIndex] = 0;
  while(currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++;
  renderShipList(); renderBoards();
}

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
      if (coords){ coords.forEach(k=> myBoard[k]='ship'); placedShips.push({id:'ship_'+Date.now()+'_'+Math.floor(Math.random()*9999), cells:coords}); placed=true; }
      tries++;
    }
  }
  for(let i=0;i<shipSizes.length;i++) shipSizes[i]=0;
  renderShipList(); renderBoards();
}

async function saveBoard(){
  if (!gameId) return;
  await set(ref(db, `games/${gameId}/players/${myId}/board`), myBoard);
  await set(ref(db, `games/${gameId}/players/${myId}/ships`), placedShips);
  await set(ref(db, `games/${gameId}/players/${myId}/ready`), true);
  placing = false;
  if (readyBadgeMe) readyBadgeMe.textContent = '✔️ Klaar';
  showPopupTemp('Je staat klaar — wacht op tegenstander...');
  log('Board opgeslagen.');
}

/* cannon animation */
function fireAnimation(targetTile, cb){
  const img = document.createElement('img');
  img.src = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRsonFTFUeLaut_val1poYgUuCph8s9N2FJBg&s';
  img.className = 'shot';
  if (cannonArea) cannonArea.appendChild(img);
  const cannonEl = document.getElementById('cannon');
  const cannonRect = cannonEl ? cannonEl.getBoundingClientRect() : {left:20, top:0, width:80, height:40};
  const targetRect = targetTile.getBoundingClientRect();
  const parentRect = cannonArea.getBoundingClientRect();
  const startX = cannonRect.left + cannonRect.width/2 - parentRect.left;
  const startY = cannonRect.top + cannonRect.height/2 - parentRect.top;
  const endX = targetRect.left + targetRect.width/2 - parentRect.left;
  const endY = targetRect.top + targetRect.height/2 - parentRect.top;
  img.style.left = startX + 'px'; img.style.top = startY + 'px';
  const dx = endX - startX, dy = endY - startY;
  requestAnimationFrame(()=>{ img.style.transform = `translate(${dx}px, ${dy}px) rotate(10deg) scale(0.9)`; });
  setTimeout(()=>{ img.classList.add('hide'); setTimeout(()=>{ img.remove(); if (cb) cb(); },220); },780);
}

/* sunk logic */
function getShipContainingCell(ships, cell){
  for(const s of ships) if (Array.isArray(s.cells) && s.cells.includes(cell)) return s;
  return null;
}

function animateShipSunk(cells){
  cells.forEach(cell=>{
    const tile = document.querySelector(`#board-me [data-cell="${cell}"]`) || document.querySelector(`#board-op [data-cell="${cell}"]`);
    if (!tile) return;
    tile.classList.add('sunk-pop');
    setTimeout(()=> tile.classList.remove('sunk-pop'), 1200);
  });
}

/* makeMove with transactions */
async function makeMove(cell){
  if (!gameId) return;
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val();
  if (!g) return;
  const players = g.players || {};
  let targetId = null;
  for(const pid in players) if (pid !== myId) targetId = pid;
  if (!targetId){ showPopupTemp('Geen tegenstander'); return; }

  try {
    const mv = push(ref(db, `games/${gameId}/moves`));
    await set(mv, { by: myId, cell, ts: Date.now(), status: 'processing' });

    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, current=>{
      if (!current || current === 'empty') return 'miss';
      if (current === 'ship') return 'hit';
      return;
    });

    const resSnap = await get(cellRef);
    const result = resSnap.val();
    await set(ref(db, `games/${gameId}/moves/${mv.key}/result`), result);

    if (result === 'hit'){
      const shipsSnap = await get(ref(db, `games/${gameId}/players/${targetId}/ships`));
      const ships = shipsSnap.exists() ? shipsSnap.val() : [];
      const shipObj = getShipContainingCell(ships, cell);
      if (shipObj){
        let allHit = true;
        for(const c of shipObj.cells){
          const st = (await get(ref(db, `games/${gameId}/players/${targetId}/board/${c}`))).val();
          if (st !== 'hit' && st !== 'sunk') { allHit = false; break; }
        }
        if (allHit){
          const updates = {};
          for(const c of shipObj.cells){
            updates[`games/${gameId}/players/${targetId}/board/${c}`] = 'sunk';
            updates[`games/${gameId}/players/${myId}/revealed/${c}`] = 'sunk';
          }
          await update(ref(db, `/`), updates);
          await set(ref(db, `games/${gameId}/moves/${mv.key}/sunkShipId`), shipObj.id);
        }
      }
    } else {
      await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), 'miss');
    }

    await set(ref(db, `games/${gameId}/turnUid`), targetId);

    const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
    const tboard = targetBoardSnap.exists() ? targetBoardSnap.val() : {};
    const hasShipLeft = Object.values(tboard).some(v => v === 'ship');
    if (!hasShipLeft){
      await set(ref(db, `games/${gameId}/status`), 'finished');
      await set(ref(db, `games/${gameId}/winner`), myId);
      const winnerProfileSnap = await get(ref(db, `users/${myId}/profile`));
      if (winnerProfileSnap.exists()){
        const winsRef = ref(db, `users/${myId}/stats/wins`);
        await runTransaction(winsRef, cur => (cur||0) + 1);
      }
    }

  } catch(e){
    console.error('move error', e);
    showPopupTemp('Kon zet niet doen: ' + (e.message || e));
  }
}

/* moves listener */
function listenMoves(){
  onValue(ref(db, `games/${gameId}/moves`), async snap=>{
    const moves = snap.val() || {};
    const keys = Object.keys(moves);
    if (!keys.length) return;
    const last = moves[keys[keys.length-1]];
    const tileSel = (last.by === myId) ? `#board-op [data-cell="${last.cell}"]` : `#board-me [data-cell="${last.cell}"]`;
    const tile = document.querySelector(tileSel);
    if (tile){
      fireAnimation(tile, async ()=>{
        await refreshBoards();
        if (last.sunkShipId){
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

async function refreshBoards(){
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val() || {};
  if (infoTurn) infoTurn.textContent = (g.turnUid === myId) ? 'Jij' : 'Tegenstander';
  if (readyBadgeMe) readyBadgeMe.textContent = ''; if (readyBadgeOp) readyBadgeOp.textContent = '';
  const players = g.players || {};
  for(const pid in players){
    const p = players[pid];
    if (pid === myId){
      const b = p.board || {};
      for(const k in b) myBoard[k] = b[k];
      if (p.ready && readyBadgeMe) readyBadgeMe.textContent = '✔️ Klaar';
    } else {
      const b = p.board || {};
      for(const k in b) if (b[k] === 'hit' || b[k] === 'miss' || b[k] === 'sunk') oppBoard[k] = b[k];
      if (p.ready && readyBadgeOp) readyBadgeOp.textContent = '✔️ Klaar';
    }
  }
  renderBoards();

  if (g.status === 'finished'){
    const winner = g.winner;
    if (winner === myId){
      showPopupTemp('Je hebt gewonnen! 🎉', 3000);
      document.body.classList.add('win-anim'); setTimeout(()=> document.body.classList.remove('win-anim'), 2500);
    } else {
      showPopupTemp('Je hebt verloren', 3000);
      document.body.classList.add('lose-anim'); setTimeout(()=> document.body.classList.remove('lose-anim'), 2500);
    }
  }
}

/* init: IMPORTANT — stop immediately if we flagged ZS_NO_PROFILE (prevents spam) */
async function init(){
  if (ZS_NO_PROFILE) {
    // do not run any game logic — this prevents pop-up/redirect loops and locking UI
    console.warn('Game init aborted because no profile was found (ZS_NO_PROFILE = true).');
    return;
  }

  if (!lobbyCode) { showPopupTemp('Geen lobby code. Ga terug.'); return; }
  if (infoLobby) infoLobby.textContent = lobbyCode;
  if (infoPlayer) infoPlayer.textContent = profileSafe ? (profileSafe.username || profileSafe.uid) : 'Onbekend';

  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()){ showPopupTemp('Lobby niet gevonden'); return; }
  const lobby = lobbySnap.val();
  gameId = lobby.gameId;
  setSize(lobby.gamemode || 10);

  const meRef = ref(db, `games/${gameId}/players/${myId}`);
  const meSnap = await get(meRef);
  if (!meSnap.exists()){
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
    await set(meRef, { name: profileSafe.username || profileSafe.uid, slot, ready: false });
  }

  boardMeEl && boardMeEl.addEventListener('click', e=>{
    const t = e.target.closest('.tile'); if (!t) return; placeShipAt(t.dataset.cell);
  });

  boardOpEl && boardOpEl.addEventListener('click', async e=>{
    const t = e.target.closest('.tile'); if (!t) return;
    const cell = t.dataset.cell;
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val();
    if (!g) return;
    if (g.turnUid !== myId){ showPopupTemp('Niet jouw beurt'); return; }
    if (oppBoard[cell] === 'hit' || oppBoard[cell] === 'miss' || oppBoard[cell] === 'sunk'){ showPopupTemp('Al geschoten op deze cel'); return; }
    await makeMove(cell);
  });

  btnRandom && btnRandom.addEventListener('click', randomPlaceAll);
  btnReady && btnReady.addEventListener('click', async ()=>{
    await saveBoard();
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    const players = playersSnap.val() || {};
    const ids = Object.keys(players);
    if (ids.length >= 2){
      const bothReady = ids.every(id => players[id].ready);
      if (bothReady){
        const starter = ids[Math.floor(Math.random()*ids.length)];
        await set(ref(db, `games/${gameId}/status`), 'in_progress');
        await set(ref(db, `games/${gameId}/turnUid`), starter);
        showPopupTemp('Game start! Veel succes', 2000);
      } else {
        showPopupTemp('Wachten op tegenstander...');
      }
    } else {
      showPopupTemp('Wachten op een speler om te joinen...');
    }
  });
  btnRotate && btnRotate.addEventListener('click', ()=>{ orientation = orientation === 'H' ? 'V' : 'H'; btnRotate.textContent = `Rotate (${orientation})`; });

  onValue(ref(db, `games/${gameId}/players`), async snap=>{
    const players = snap.val() || {};
    for(const pid in players){
      const p = players[pid];
      if (pid === myId){
        if (p.ready && readyBadgeMe) readyBadgeMe.textContent = '✔️ Klaar';
      } else {
        if (p.ready && readyBadgeOp) readyBadgeOp.textContent = '✔️ Klaar';
      }
    }
  });

  onValue(ref(db, `games/${gameId}`), async snap=>{
    const g = snap.val();
    if (!g) return;
    if (g.status === 'in_progress') {
      headerSub && (headerSub.textContent = `Gamemode: ${size}×${size}`);
    }
    if (infoTurn) infoTurn.textContent = g.turnUid === myId ? 'Jij' : 'Tegenstander';
    await refreshBoards();
  });

  listenMoves();
  renderBoards();
}

init();
