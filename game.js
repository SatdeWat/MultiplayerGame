// game.js — volledige game flow, no spamming popups
// game.js — compleet: classic & power modes, ready flow, shot rules, sunk, powermove
import { db } from "./firebase-config.js";
import { loadLocalProfile, incrementWinsForUid } from "./app-auth.js";
import {
  ref, get, set, onValue, push, runTransaction, update
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { ref, get, set, onValue, update, push, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* --------- Config & helpers --------- */
const CANNON_URL = "https://cdn-icons-png.flaticon.com/512/3369/3369660.png";
const SHOT_URL = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRsonFTFUeLaut_val1poYgUuCph8s9N2FJBg&s";
const $ = id => document.getElementById(id);
const alpha = n => String.fromCharCode(65 + n);
const cellName = (r,c) => `${alpha(r)}${c+1}`;
const profile = loadLocalProfile();

// Safety: if no profile -> show message inline and stop (no popups)
if (!profile) {
  const status = $("status-msg");
  if (status) status.textContent = "Je moet inloggen of als gast inloggen om te spelen.";
  // stop executing game logic
  throw new Error("No profile");
}
if (!profile) { $("status-msg") && ($("status-msg").textContent = "Log in of speel als gast."); throw "No profile"; }

const qs = new URLSearchParams(location.search);
const lobbyCode = qs.get("lobby");
if (!lobbyCode) { $("status-msg").textContent = "Geen lobby code"; throw "No lobby code"; }
if (!lobbyCode) { $("status-msg") && ($("status-msg").textContent = "Geen lobby code"); throw "No lobby"; }

const infoLobby = $("info-lobby"), infoPlayer = $("info-player"), infoTurn = $("info-turn");
const boardMeEl = $("board-me"), boardOpEl = $("board-op");
const shipListEl = $("ship-list");
const btnRandom = $("btn-random"), btnReady = $("btn-ready"), btnRotate = $("btn-rotate");
const readyBadgeMe = $("ready-badge-me"), readyBadgeOp = $("ready-badge-op");
// UI elems
const infoLobby = $("info-lobby"), infoPlayer = $("info-player"), infoTurn = $("info-turn"), infoPower = $("info-power");
const boardMeEl = $("board-me"), boardOpEl = $("board-op"), shipListEl = $("ship-list");
const btnRandom = $("btn-random"), btnRotate = $("btn-rotate"), btnReady = $("btn-ready"), btnPower = $("btn-power");
const readyBadgeMe = $("ready-badge-me"), readyBadgeOp = $("ready-badge-op"), logEl = $("log");
const overlay = $("overlay"), overlayContent = $("overlay-content"), overlayActions = $("overlay-actions");
const logEl = $("log"), leaderboardEl = $("leaderboard");

let gameId = null;
let gamemode = "classic"; // 'classic' or 'power'
let size = 10;
let myId = profile.uid;
let myBoard = {}, oppBoard = {};
let shipSizes = [5,4,3,3,2];
let placedShips = []; // {id, cells}
let myBoard = {}, oppBoard = {}; // local caches
let shipSizes = [5,4,3]; // default small set - will be overwritten per size selection
let placedShips = [];
let currentShipIndex = 0;
let orientation = "H";

/* UI logging */
function log(msg){ const d=document.createElement("div"); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }

/* overlay (non-blocking) */
function showOverlay(msg, actionsHTML="") {
  if (!overlay) return console.log("overlay:", msg);
let orientation = 'H';
let ready = false;
let myTurn = false;
let powerCount = 0; // number of powermoves available (power mode only)
let opponentId = null;

function log(msg){ const d = document.createElement('div'); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }
function showOverlay(msg, actionsHTML = `<button id="overlay-close">OK</button>`) {
  if (!overlay) return console.log(msg);
overlayContent.innerHTML = msg;
  overlayActions.innerHTML = actionsHTML || `<button id="overlay-close">OK</button>`;
  overlay.classList.remove("hidden");
  const close = document.getElementById("overlay-close");
  if (close) close.onclick = () => overlay.classList.add("hidden");
  overlayActions.innerHTML = actionsHTML;
  overlay.classList.remove('hidden');
  const btn = document.getElementById('overlay-close');
  if (btn) btn.onclick = ()=> overlay.classList.add('hidden');
}

/* grid creation & rendering */
// grid helpers
function createGrid(el, n){
  el.innerHTML = "";
  el.classList.remove("cell-5","cell-10","cell-15");
  el.innerHTML = '';
  el.classList.remove('cell-5','cell-10','cell-15','cell-20');
el.classList.add(`cell-${n}`);
el.style.gridTemplateRows = `repeat(${n},1fr)`;
  for (let r=0;r<n;r++){
    for (let c=0;c<n;c++){
      const tile = document.createElement("div");
      tile.className = "tile sea";
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
  createGrid(boardMeEl,n);
  createGrid(boardOpEl,n);
  myBoard = {}; oppBoard = {};
function setSizeAndMode(gm, s){
  gamemode = gm;
  size = s;
  createGrid(boardMeEl, size);
  createGrid(boardOpEl, size);
placedShips = [];
currentShipIndex = 0;
  orientation = "H";
  if (n>=15) shipSizes = [5,4,4,3,3,2];
  else if (n>=10) shipSizes = [5,4,3,3,2];
  else shipSizes = [3,2,2];
  for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoard[cellName(r,c)] = "empty";
  renderShipList(); renderBoards();
  orientation = 'H';
  myBoard = {}; oppBoard = {};
  if (gamemode === 'power' && size === 20) {
    // bigger ship set for large map
    shipSizes = [5,4,4,3,3,2];
  } else {
    // normal: three ships sizes (as requested)
    if (size <= 5) shipSizes = [3,2,2];
    else shipSizes = [5,4,3];
  }
  for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoard[cellName(r,c)] = 'empty';
  renderShipList();
  renderBoards();
  updateUI();
}

function renderBoards(){
  Array.from(boardMeEl.children).forEach(tile=>{
  if (boardMeEl) Array.from(boardMeEl.children).forEach(tile=>{
const id = tile.dataset.cell;
    tile.className = "tile sea";
    tile.innerHTML = "";
    if (myBoard[id] === "ship") tile.classList.add("ship");
    if (myBoard[id] === "hit") { tile.classList.add("hit"); tile.innerHTML = "💥"; }
    if (myBoard[id] === "miss") { tile.classList.add("miss"); tile.innerHTML = "🌊"; }
    if (myBoard[id] === "sunk") { tile.classList.add("sunk"); tile.innerHTML = "☠️"; }
    tile.className = 'tile sea';
    tile.innerHTML = '';
    if (myBoard[id] === 'ship') tile.classList.add('ship');
    if (myBoard[id] === 'hit') { tile.classList.add('hit'); tile.innerHTML = '💥'; }
    if (myBoard[id] === 'miss') { tile.classList.add('miss'); tile.innerHTML = '🌊'; }
    if (myBoard[id] === 'sunk') { tile.classList.add('sunk'); tile.innerHTML = '☠️'; }
});
  Array.from(boardOpEl.children).forEach(tile=>{
  if (boardOpEl) Array.from(boardOpEl.children).forEach(tile=>{
const id = tile.dataset.cell;
    tile.className = "tile sea";
    tile.innerHTML = "";
    if (oppBoard[id] === "hit") { tile.classList.add("hit"); tile.innerHTML = "🔥"; }
    if (oppBoard[id] === "miss") { tile.classList.add("miss"); tile.innerHTML = "🌊"; }
    if (oppBoard[id] === "sunk") { tile.classList.add("sunk"); tile.innerHTML = "☠️"; }
    tile.className = 'tile sea'; tile.innerHTML = '';
    if (oppBoard[id] === 'hit') { tile.classList.add('hit'); tile.innerHTML = '🔥'; }
    if (oppBoard[id] === 'miss') { tile.classList.add('miss'); tile.innerHTML = '🌊'; }
    if (oppBoard[id] === 'sunk') { tile.classList.add('sunk'); tile.innerHTML = '☠️'; }
});
}

/* ship list */
function renderShipList(){
  shipListEl.innerHTML = "";
  shipListEl.innerHTML = '';
shipSizes.forEach((s,i)=>{
    const pill = document.createElement("div");
    pill.className = "ship-pill" + (i===currentShipIndex ? " active" : "");
    pill.textContent = `Ship ${i+1} — ${s>0?s:"placed"}`;
    pill.addEventListener("click", ()=>{ if (s>0) currentShipIndex = i; renderShipList(); });
    const pill = document.createElement('div');
    pill.className = 'ship-pill' + (i === currentShipIndex ? ' active' : '');
    pill.textContent = `Ship ${i+1} — ${s>0 ? s : 'placed'}`;
    pill.onclick = ()=> { if (s>0) currentShipIndex = i; renderShipList(); };
shipListEl.appendChild(pill);
});
}

/* placement utils */
function canPlace(startR,startC,sizeShip,orient){
function canPlace(r,c,s,orient){
const coords = [];
  for (let i=0;i<sizeShip;i++){
    const r = startR + (orient==="V"?i:0);
    const c = startC + (orient==="H"?i:0);
    if (r<0 || r>=size || c<0 || c>=size) return null;
    coords.push(cellName(r,c));
  for (let i=0;i<s;i++){
    const rr = r + (orient === 'V' ? i : 0);
    const cc = c + (orient === 'H' ? i : 0);
    if (rr < 0 || rr >= size || cc < 0 || cc >= size) return null;
    coords.push(cellName(rr,cc));
}
  for (const cell of coords) if (myBoard[cell] === "ship") return null;
  for (const k of coords) if (myBoard[k] === 'ship') return null;
return coords;
}

function placeShipAt(cellId){
const r = cellId.charCodeAt(0) - 65;
const c = parseInt(cellId.slice(1),10) - 1;
const s = shipSizes[currentShipIndex];
  if (!s || s<=0) { log("Geen schip geselecteerd"); return; }
  if (!s || s <= 0) { log('Geen schip geselecteerd'); return; }
const coords = canPlace(r,c,s,orientation);
  if (!coords){ log("Kan hier niet plaatsen"); return; }
  coords.forEach(k => myBoard[k] = "ship");
  placedShips.push({ id: 'ship_' + Date.now() + '_' + Math.floor(Math.random()*9999), cells: coords });
  if (!coords) { log('Kan hier niet plaatsen'); return; }
  coords.forEach(k => myBoard[k] = 'ship');
  placedShips.push({ id: 'ship_' + Date.now() + '_' + Math.floor(Math.random()*9999), cells: coords, size: s });
shipSizes[currentShipIndex] = 0;
while (currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++;
renderShipList(); renderBoards();
}

function randomPlaceAll(){
  for (const k in myBoard) myBoard[k] = "empty";
  for (const k in myBoard) myBoard[k] = 'empty';
placedShips = [];
  const sizes = shipSizes.map(x=>x).filter(x=>x>0);
  const sizes = shipSizes.slice().filter(x => x>0);
for (const s of sizes){
let tries = 0, placed = false;
while (!placed && tries < 1000){
      const r = Math.floor(Math.random()*size), c = Math.floor(Math.random()*size);
      const o = Math.random()<0.5 ? "H" : "V";
      const r = Math.floor(Math.random() * size);
      const c = Math.floor(Math.random() * size);
      const o = Math.random() < 0.5 ? 'H' : 'V';
const coords = canPlace(r,c,s,o);
      if (coords){ coords.forEach(k=> myBoard[k] = "ship"); placedShips.push({id:'ship_'+Date.now()+'_'+Math.floor(Math.random()*9999), cells: coords}); placed = true; }
      if (coords){ coords.forEach(k => myBoard[k] = 'ship'); placedShips.push({ id: 'ship_'+Date.now()+'_'+Math.floor(Math.random()*9999), cells: coords, size: s }); placed = true; }
tries++;
}
}
for (let i=0;i<shipSizes.length;i++) shipSizes[i] = 0;
renderShipList(); renderBoards();
}

/* save board to DB and set ready */
async function saveBoard(){
/* DB helpers */
async function ensureJoinedGame(){
  // read lobby to find gameId
  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()) throw new Error("Lobby niet gevonden");
  const lobby = lobbySnap.val();
  gameId = lobby.gameId;
  gamemode = lobby.gamemode || 'classic';
  size = lobby.size || (gamemode === 'power' ? 20 : 10);
  setSizeAndMode(gamemode, size);
  // ensure player entry exists
  const playerRef = ref(db, `games/${gameId}/players/${myId}`);
  const pSnap = await get(playerRef);
  if (!pSnap.exists()){
    // figure out slot index
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    let slot = 1;
    if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
    await set(playerRef, { username: profile.username, ready: false, slot });
  }
  // find opponent id (if present)
  const playersSnap2 = await get(ref(db, `games/${gameId}/players`));
  const playersObj = playersSnap2.exists() ? playersSnap2.val() : {};
  for (const pid in playersObj) if (pid !== myId) opponentId = pid;
}

/* Save boards & ready to DB */
async function saveBoardAndReady(){
if (!gameId) return;
await set(ref(db, `games/${gameId}/players/${myId}/board`), myBoard);
await set(ref(db, `games/${gameId}/players/${myId}/ships`), placedShips);
await set(ref(db, `games/${gameId}/players/${myId}/ready`), true);
  $("ready-badge-me").textContent = "✔️ Klaar";
  log("Board opgeslagen (ready).");
  $('ready-badge-me').textContent = '✔️ Klaar';
  log('Je bent klaar — wacht op tegenstander');
}

/* animation: shot flying */
function fireAnimation(targetTile, cb){
  const img = document.createElement("img");
  img.src = SHOT_URL;
  img.className = "shot";
  const area = $("cannon-area");
  if (!area) { if(cb) cb(); return; }
  area.appendChild(img);
  const cannonEl = document.querySelector("#cannon");
  const cannonRect = cannonEl ? cannonEl.getBoundingClientRect() : { left: 20, top: 20, width: 60, height: 40 };
  const targetRect = targetTile.getBoundingClientRect();
  const parentRect = area.getBoundingClientRect();
  const startX = cannonRect.left + cannonRect.width/2 - parentRect.left;
  const startY = cannonRect.top + cannonRect.height/2 - parentRect.top;
  const endX = targetRect.left + targetRect.width/2 - parentRect.left;
  const endY = targetRect.top + targetRect.height/2 - parentRect.top;
  img.style.left = startX + "px"; img.style.top = startY + "px";
  const dx = endX - startX, dy = endY - startY;
  requestAnimationFrame(()=> { img.style.transform = `translate(${dx}px, ${dy}px) rotate(10deg) scale(0.9)`; });
  setTimeout(()=> { img.classList.add("hide"); setTimeout(()=> { img.remove(); if (cb) cb(); }, 220); }, 780);
}

/* moves: transaction on target cell */
/* shot logic:
   - If hit -> do not switch turn (same player continues)
   - If miss -> switch turn
   - When ship sunk -> mark sunk and if gamemode power -> give powermove to shooter
*/
async function makeMove(cell){
if (!gameId) return;
  // get opponent id
const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val();
  if (!g) return;
  const g = gSnap.val() || {};
const players = g.players || {};
let targetId = null;
for (const pid in players) if (pid !== myId) targetId = pid;
  if (!targetId) { log("Geen tegenstander"); return; }

  try {
    const mvRef = push(ref(db, `games/${gameId}/moves`));
    await set(mvRef, { by: myId, cell, ts: Date.now(), status: "processing" });

    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, current => {
      if (!current || current === "empty") return "miss";
      if (current === "ship") return "hit";
      return; // already resolved
    });
  if (!targetId) { log('Geen tegenstander'); return; }

  // create move entry
  const mvRef = push(ref(db, `games/${gameId}/moves`));
  await set(mvRef, { by: myId, cell, ts: Date.now(), status: 'processing' });

  // transaction on target board cell
  const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
  await runTransaction(cellRef, cur => {
    if (!cur || cur === 'empty') return 'miss';
    if (cur === 'ship') return 'hit';
    return; // already decided
  });

    const resSnap = await get(cellRef);
    const result = resSnap.val();
    await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), result);

    if (result === "hit"){
      // check sunk
      const shipsSnap = await get(ref(db, `games/${gameId}/players/${targetId}/ships`));
      const ships = shipsSnap.exists() ? shipsSnap.val() : [];
      const shipObj = ships.find(s => s.cells && s.cells.includes(cell));
      if (shipObj){
        let allHit = true;
        for (const c of shipObj.cells){
          const st = (await get(ref(db, `games/${gameId}/players/${targetId}/board/${c}`))).val();
          if (st !== "hit" && st !== "sunk") { allHit = false; break; }
  const resSnap = await get(cellRef);
  const result = resSnap.val();
  await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), result);
  log(`Je schoot op ${cell} => ${result}`);

  if (result === 'hit'){
    // check if a ship was sunk
    const shipsSnap = await get(ref(db, `games/${gameId}/players/${targetId}/ships`));
    const ships = shipsSnap.exists() ? shipsSnap.val() : [];
    const ship = ships.find(s => s.cells && s.cells.includes(cell));
    if (ship){
      let allHit = true;
      for (const c of ship.cells){
        const st = (await get(ref(db, `games/${gameId}/players/${targetId}/board/${c}`))).val();
        if (st !== 'hit' && st !== 'sunk') { allHit = false; break; }
      }
      if (allHit){
        // mark sunk cells
        const updates = {};
        for (const c of ship.cells){
          updates[`games/${gameId}/players/${targetId}/board/${c}`] = 'sunk';
          updates[`games/${gameId}/players/${myId}/revealed/${c}`] = 'sunk';
}
        if (allHit){
          // mark sunk
          const updates = {};
          for (const c of shipObj.cells){
            updates[`games/${gameId}/players/${targetId}/board/${c}`] = "sunk";
            updates[`games/${gameId}/players/${myId}/revealed/${c}`] = "sunk";
          }
          await update(ref(db, `/`), updates);
          await set(ref(db, `games/${gameId}/moves/${mvRef.key}/sunkShipId`), shipObj.id);
        await update(ref(db, `/`), updates);
        await set(ref(db, `games/${gameId}/moves/${mvRef.key}/sunkShipId`), ship.id);
        log('Ship gezonken!');
        // in power mode: grant powermove to shooter
        if (gamemode === 'power'){
          const powRef = ref(db, `games/${gameId}/players/${myId}/power`);
          await runTransaction(powRef, cur => (cur || 0) + 1);
}
}
    } else {
      await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), "miss");
}

    // do NOT switch turn on hit (player continues)
    await set(ref(db, `games/${gameId}/turnUid`), myId);
  } else {
    // miss: ensure stored
    await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), 'miss');
    // switch turn to opponent
await set(ref(db, `games/${gameId}/turnUid`), targetId);
  }

    // check victory
    const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
    const tboard = targetBoardSnap.exists() ? targetBoardSnap.val() : {};
    const hasShipLeft = Object.values(tboard).some(v => v === "ship");
    if (!hasShipLeft){
      await set(ref(db, `games/${gameId}/status`), "finished");
      await set(ref(db, `games/${gameId}/winner`), myId);
      // update leaderboard if winner is registered
      if (!profile.guest) await incrementWinsForUid(myId);
    }

  } catch (e){
    console.error("move error", e);
    log("Zet mislukt: " + (e.message || e));
  // check victory: does target have any 'ship' left?
  const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
  const targetBoard = targetBoardSnap.exists() ? targetBoardSnap.val() : {};
  const hasShipLeft = Object.values(targetBoard).some(v => v === 'ship');
  if (!hasShipLeft){
    await set(ref(db, `games/${gameId}/status`), 'finished');
    await set(ref(db, `games/${gameId}/winner`), myId);
    log('Je hebt gewonnen!');
    if (!profile.guest) await incrementWinsForUid(myId);
}
}

/* listen moves (animate) */
function listenMoves(){
  const movesRef = ref(db, `games/${gameId}/moves`);
  onValue(movesRef, async snap => {
    const m = snap.val() || {};
    const keys = Object.keys(m);
    if (!keys.length) return;
    const last = m[keys[keys.length - 1]];
    const tileSel = (last.by === myId) ? `#board-op [data-cell="${last.cell}"]` : `#board-me [data-cell="${last.cell}"]`;
    const targetTile = document.querySelector(tileSel);
    if (targetTile){
      fireAnimation(targetTile, async ()=> await refreshBoards());
    } else {
      await refreshBoards();
    }
  });
}

/* refresh boards and UI */
async function refreshBoards(){
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val() || {};
  infoTurn.textContent = (g.turnUid === myId) ? "Jij" : "Tegenstander";
  const players = g.players || {};
  for (const pid in players){
    if (pid === myId){
      const b = players[pid].board || {};
      for (const k in b) myBoard[k] = b[k];
      if (players[pid].ready) $("ready-badge-me").textContent = "✔️ Klaar";
    } else {
      const b = players[pid].board || {};
      for (const k in b) if (b[k] === "hit" || b[k] === "miss" || b[k] === "sunk") oppBoard[k] = b[k];
      if (players[pid].ready) $("ready-badge-op").textContent = "✔️ Klaar";
/* powershot: reveal 3x3 around chosen cell (only power mode & only if player has power >0) */
async function powerShot(centerCell){
  if (gamemode !== 'power') return;
  const powSnap = await get(ref(db, `games/${gameId}/players/${myId}/power`));
  const powCount = powSnap.exists() ? powSnap.val() : 0;
  if (powCount <= 0){ log('Geen powershots beschikbaar'); return; }
  // compute center coords
  const r = centerCell.charCodeAt(0) - 65;
  const c = parseInt(centerCell.slice(1),10) - 1;
  const cells = [];
  for (let dr = -1; dr <= 1; dr++){
    for (let dc = -1; dc <= 1; dc++){
      const rr = r + dr; const cc = c + dc;
      if (rr >= 0 && rr < size && cc >= 0 && cc < size) cells.push(cellName(rr,cc));
}
}
  renderBoards();

  // finished?
  if (g.status === "finished"){
    const winner = g.winner;
    if (winner === myId){
      showOverlay("<h2>Je hebt gewonnen! 🏆</h2>", `<button id="overlay-close">Sluit</button>`);
      document.body.classList.add('win-anim');
      setTimeout(()=> document.body.classList.remove('win-anim'), 2200);
    } else {
      showOverlay("<h2>Je hebt verloren</h2>", `<button id="overlay-close">Sluit</button>`);
      document.body.classList.add('lose-anim');
      setTimeout(()=> document.body.classList.remove('lose-anim'), 2200);
    }
  // For each cell, do same transaction as a normal shot (hit/miss)
  for (const cell of cells){
    const targetId = Object.keys((await get(ref(db, `games/${gameId}/players`))).val()).find(pid => pid !== myId);
    if (!targetId) continue;
    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, cur => {
      if (!cur || cur === 'empty') return 'miss';
      if (cur === 'ship') return 'hit';
      return;
    });
    // we don't change turn per cell; treat as one combined power move
}
  // consume one power
  await runTransaction(ref(db, `games/${gameId}/players/${myId}/power`), cur => Math.max((cur || 0) - 1, 0));
  await set(ref(db, `games/${gameId}/turnUid`), myId); // still your turn after power
  log('Powershot uitgevoerd!');
}

/* main init */
async function init(){
  infoLobby.textContent = lobbyCode;
  infoPlayer.textContent = profile.username || profile.uid;
  // load lobby => find gameId
/* listeners */
async function listenGame(){
  // find gameId first
const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()) { $("status-msg").textContent = "Lobby niet gevonden"; return; }
  if (!lobbySnap.exists()) { showOverlay('Lobby niet gevonden'); return; }
const lobby = lobbySnap.val();
gameId = lobby.gameId;
  setSize(lobby.gamemode || 10);
  gamemode = lobby.gamemode || 'classic';
  size = lobby.size || (gamemode === 'power' ? 20 : 10);
  setSizeAndMode(gamemode, size);
  infoLobby.textContent = lobbyCode;
  infoPlayer.textContent = profile.username || profile.uid;

  // ensure player in game node
  // ensure player exists
const meRef = ref(db, `games/${gameId}/players/${myId}`);
const meSnap = await get(meRef);
if (!meSnap.exists()){
@@ -338,91 +331,158 @@ async function init(){
await set(meRef, { username: profile.username, ready: false, slot });
}

  // local UI events
  boardMeEl.addEventListener("click", e => {
    const t = e.target.closest(".tile"); if (!t) return; placeShipAt(t.dataset.cell);
  });
  boardOpEl.addEventListener("click", async e => {
    const t = e.target.closest(".tile"); if (!t) return;
    const cell = t.dataset.cell;
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val();
    if (!g) return;
    if (g.turnUid !== myId){ showOverlay("Niet jouw beurt", `<button id="overlay-close">Ok</button>`); return; }
    if (oppBoard[cell] === "hit" || oppBoard[cell] === "miss" || oppBoard[cell] === "sunk"){ showOverlay("Al geschoten op deze cel", `<button id="overlay-close">Ok</button>`); return; }
    await makeMove(cell);
  // listen players
  onValue(ref(db, `games/${gameId}/players`), snap => {
    const players = snap.val() || {};
    ready = players[myId] && players[myId].ready;
    if (players[myId] && players[myId].power) powerCount = players[myId].power;
    // opponent id
    for (const pid in players) if (pid !== myId) opponentId = pid;
    // update ready badges
    if (players[myId] && players[myId].ready) $('ready-badge-me').textContent = '✔️ Klaar'; else $('ready-badge-me').textContent = '';
    for (const pid in players) if (pid !== myId) $('ready-badge-op').textContent = players[pid].ready ? '✔️ Klaar' : '';
    updateUI();
});

  btnRandom.addEventListener("click", randomPlaceAll);
  btnRotate.addEventListener("click", ()=>{ orientation = orientation === "H" ? "V" : "H"; btnRotate.textContent = `Rotate (${orientation})`; });
  btnReady.addEventListener("click", async ()=>{
    await saveBoard();
    // if both ready -> set in_progress
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val() || {};
    const players = g.players || {};
    const ids = Object.keys(players);
    if (ids.length >= 2){
      const bothReady = ids.every(id => players[id].ready);
      if (bothReady){
        const starter = ids[Math.floor(Math.random()*ids.length)];
        await set(ref(db, `games/${gameId}/status`), "in_progress");
        await set(ref(db, `games/${gameId}/turnUid`), starter);
        showOverlay("Game start! Veel succes", `<button id="overlay-close">Ok</button>`);
      } else {
        showOverlay("Wachten op tegenstander...", `<button id="overlay-close">Ok</button>`);
      }
    } else {
      showOverlay("Wachten op een speler om te joinen...", `<button id="overlay-close">Ok</button>`);
  // listen game status and turn
  onValue(ref(db, `games/${gameId}`), async snap => {
    const g = snap.val() || {};
    if (g.turnUid) infoTurn.textContent = (g.turnUid === myId) ? 'Jij' : 'Tegenstander';
    if (g.status === 'in_progress') {
      // ensure boards shown reflect DB
      await refreshBoards();
}
  });

  // listen for players changes
  onValue(ref(db, `games/${gameId}/players`), snap => {
    const players = snap.val() || {};
    // update ready badges and detect opponent
    for (const pid in players){
      if (pid !== myId) opponentId = pid;
      if (pid === myId){
        if (players[pid].ready) $("ready-badge-me").textContent = "✔️ Klaar";
    if (g.status === 'finished'){
      const winner = g.winner;
      if (winner === myId){
        showOverlay('<h2>Gefeliciteerd — gewonnen! 🏆</h2>', '<button id="overlay-close">Sluit</button>');
        document.body.classList.add('win-anim'); setTimeout(()=> document.body.classList.remove('win-anim'), 2200);
} else {
        if (players[pid].ready) $("ready-badge-op").textContent = "✔️ Klaar";
        showOverlay('<h2>Je hebt verloren</h2>', '<button id="overlay-close">Sluit</button>');
        document.body.classList.add('lose-anim'); setTimeout(()=> document.body.classList.remove('lose-anim'), 2200);
}
}
    await refreshBoards();
});

  // listen for game state changes
  onValue(ref(db, `games/${gameId}`), async snap => {
    const g = snap.val() || {};
    if (g.turnUid) infoTurn.textContent = (g.turnUid === myId) ? "Jij" : "Tegenstander";
    await refreshBoards();
  // listen moves for animation
  onValue(ref(db, `games/${gameId}/moves`), snap => {
    const moves = snap.val() || {};
    const keys = Object.keys(moves);
    if (!keys.length) return;
    const last = moves[keys[keys.length - 1]];
    // animate via CSS class or simple log (we removed cannon graphic)
    log(`Laatste zet: ${last.by} -> ${last.cell} (${last.result || '...'})`);
});

  listenMoves();
  await refreshBoards();
  loadLeaderboard();
  // enable powermove button when available
  onValue(ref(db, `games/${gameId}/players/${myId}/power`), snap => {
    const v = snap.val() || 0;
    powerCount = v;
    $('info-power').textContent = v;
    btnPower.disabled = (v <= 0);
  });
}

init();

/* Leaderboard loader */
async function loadLeaderboard(){
  const usersSnap = await get(ref(db, `users`));
  const users = usersSnap.exists() ? usersSnap.val() : {};
  const arr = [];
  for (const uid in users){
    const u = users[uid];
    const name = (u.profile && u.profile.username) ? u.profile.username : (u.profile && u.profile.name) ? u.profile.name : uid;
    const wins = (u.stats && typeof u.stats.wins !== "undefined") ? u.stats.wins : 0;
    arr.push({ name, wins });
/* refresh boards by reading DB */
async function refreshBoards(){
  if (!gameId) return;
  const playersSnap = await get(ref(db, `games/${gameId}/players`));
  const players = playersSnap.exists() ? playersSnap.val() : {};
  for (const pid in players){
    const p = players[pid];
    if (pid === myId){
      const b = p.board || {};
      for (const k in b) myBoard[k] = b[k];
    } else {
      const b = p.board || {};
      for (const k in b){
        if (b[k] === 'hit' || b[k] === 'miss' || b[k] === 'sunk') oppBoard[k] = b[k];
      }
    }
}
  arr.sort((a,b) => b.wins - a.wins);
  leaderboardEl.innerHTML = "";
  arr.slice(0,50).forEach((u,i)=>{
    const row = document.createElement("div");
    row.className = "leader-row";
    row.innerHTML = `<div class="leader-pos">${i+1}</div><div class="leader-name">${u.name}</div><div class="leader-wins">${u.wins} winst(en)</div>`;
    leaderboardEl.appendChild(row);
  });
  renderBoards();
}

/* UI updates */
function updateUI(){
  $('info-power') && ($('info-power').textContent = powerCount || 0);
  // power button availability
  btnPower.disabled = !(powerCount > 0);
  // whose turn highlight will be updated by refresh when turnUid is set
}

/* attach UI events */
boardMeEl?.addEventListener('click', e => {
  const t = e.target.closest('.tile'); if (!t) return;
  placeShipAt(t.dataset.cell);
});
boardOpEl?.addEventListener('click', async e => {
  const t = e.target.closest('.tile'); if (!t) return;
  const cell = t.dataset.cell;
  // only allow shooting when game in progress and it's your turn
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val() || {};
  if (g.status !== 'in_progress'){ showOverlay('Wacht tot het spel gestart is', '<button id="overlay-close">OK</button>'); return; }
  if (g.turnUid !== myId){ showOverlay('Niet jouw beurt', '<button id="overlay-close">OK</button>'); return; }
  const known = oppBoard[cell];
  if (known === 'hit' || known === 'miss' || known === 'sunk'){ showOverlay('Al geschoten op deze cel', '<button id="overlay-close">OK</button>'); return; }
  // make move
  await makeMove(cell);
});

btnRandom?.addEventListener('click', randomPlaceAll);
btnRotate?.addEventListener('click', ()=>{ orientation = orientation === 'H' ? 'V' : 'H'; btnRotate.textContent = `Rotate (${orientation})`; });
btnReady?.addEventListener('click', async ()=>{
  await saveBoardAndReady();
  // if both ready -> set status in_progress and pick random starter
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val() || {};
  const players = g.players || {};
  const ids = Object.keys(players);
  if (ids.length >= 2){
    const bothReady = ids.every(id => players[id].ready);
    if (bothReady){
      const starter = ids[Math.floor(Math.random()*ids.length)];
      await set(ref(db, `games/${gameId}/status`), 'in_progress');
      await set(ref(db, `games/${gameId}/turnUid`), starter);
      showOverlay('Game gestart! Veel succes', '<button id="overlay-close">Ok</button>');
    } else {
      showOverlay('Wachten op tegenstander', '<button id="overlay-close">OK</button>');
    }
  } else {
    showOverlay('Wachten op tegenstander om te joinen', '<button id="overlay-close">OK</button>');
  }
});

// powershot click: user picks a cell on opponent board to use power on next click
let awaitingPowerTarget = false;
btnPower?.addEventListener('click', ()=>{
  if (!btnPower || btnPower.disabled) return;
  awaitingPowerTarget = true;
  showOverlay('Klik op een cel bij de tegenstander om powershot uit te voeren', '<button id="overlay-close">Annuleer</button>');
  const cbtn = document.getElementById('overlay-close');
  if (cbtn) cbtn.onclick = ()=> { overlay.classList.add('hidden'); awaitingPowerTarget = false; };
});

// handle powershot target by listening to clicks (boardOp click handler will check awaitingPowerTarget)
boardOpEl?.addEventListener('click', async e => {
  if (!awaitingPowerTarget) return;
  const t = e.target.closest('.tile'); if(!t) return;
  const cell = t.dataset.cell;
  awaitingPowerTarget = false;
  overlay.classList.add('hidden');
  await powerShot(cell);
  // after powerShot, refresh boards
  await refreshBoards();
});

// initial start
(async ()=> {
  await ensureJoinedGame().catch(err=>{
    console.error(err);
    showOverlay('Kon niet joinen: ' + (err.message || err), '<button id="overlay-close">Ok</button>');
  });
  await listenGame();
  await refreshBoards();
})();
