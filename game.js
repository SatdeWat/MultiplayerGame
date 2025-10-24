// game.js
import { db } from "./firebase-config.js";
import { loadLocalProfile } from "./app-auth.js";
import {
  ref, get, set, onValue, push, runTransaction
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const qs = new URLSearchParams(location.search);
const lobbyCode = qs.get("lobby");
const profile = loadLocalProfile() || { username:"Gast", id:`guest${Math.floor(Math.random()*9999)}` };

const $ = id => document.getElementById(id);
const boardMeEl = $("board-me"), boardOpEl = $("board-op");
const infoLobby = $("info-lobby"), infoPlayer = $("info-player"), infoTurn = $("info-turn");
const btnRandom = $("btn-random"), btnReady = $("btn-ready"), btnRotate = $("btn-rotate");
const cannonArea = $("cannon-area"), logEl = $("log"), headerSub = $("header-sub");

const modal = createModalElements();

let gameId = null;
let size = 10;
let myId = profile.id;
let myBoard = {}, oppBoard = {}; // cell states
let placing = true;
let orientation = "H";
let shipSizes = [5,4,3,3,2];
let currentShipIndex = 0;
let shipsMeta = []; // array of arrays (cells) for our ships

// image URLs
const CANNON_URL = "https://cdn-icons-png.flaticon.com/512/3369/3369660.png";
const SHOT_URL = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRsonFTFUeLaut_val1poYgUuCph8s9N2FJBg&s";

/* helpers */
function log(msg){ const d = document.createElement("div"); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }
function alpha(n){ return String.fromCharCode(65 + n); }
function cellName(r,c){ return `${alpha(r)}${c+1}`; }

function createGrid(el, n){
  el.innerHTML = "";
  el.classList.remove("cell-5","cell-10","cell-15");
  el.classList.add(`cell-${n}`);
  el.style.gridTemplateRows = `repeat(${n},1fr)`;
  for (let r=0;r<n;r++){
    for (let c=0;c<n;c++){
      const tile = document.createElement("div");
      tile.className = "tile sea";
      tile.dataset.r = r; tile.dataset.c = c; tile.dataset.cell = cellName(r,c);
      el.appendChild(tile);
    }
  }
}

function setSize(n){
  size = n;
  createGrid(boardMeEl, n);
  createGrid(boardOpEl, n);
  myBoard = {}; oppBoard = {};
  for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoard[cellName(r,c)] = "empty";
  if (n>=15) shipSizes = [5,4,4,3,3,2];
  else if (n>=10) shipSizes = [5,4,3,3,2];
  else shipSizes = [3,2,2];
  // reset shipsMeta
  shipsMeta = shipSizes.map(s => s>0 ? null : null);
  renderShipList();
  renderBoards();
}

function renderBoards(){
  Array.from(boardMeEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.className = "tile sea";
    tile.innerHTML = "";
    if (myBoard[id] === "ship") { tile.classList.add("ship"); }
    if (myBoard[id] === "hit") { tile.classList.add("hit"); tile.innerHTML = "💥"; }
    if (myBoard[id] === "miss") { tile.classList.add("miss"); tile.innerHTML = "🌊"; }
  });
  Array.from(boardOpEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.className = "tile sea";
    tile.innerHTML = "";
    if (oppBoard[id] === "hit"){ tile.classList.add("hit"); tile.innerHTML = "🔥"; }
    if (oppBoard[id] === "miss"){ tile.classList.add("miss"); tile.innerHTML = "🌊"; }
    if (oppBoard[id] === "sunk"){ tile.classList.add("sunk"); tile.innerHTML = "☠️"; }
  });
}

function renderShipList(){
  const wrap = $("ship-list");
  wrap.innerHTML = "";
  shipSizes.forEach((s,i)=>{
    const pill = document.createElement("div");
    pill.className = "ship-pill" + (i === currentShipIndex ? " active" : "");
    pill.textContent = `Ship ${i+1} — ${s>0?s:"placed"}`;
    pill.addEventListener("click", ()=>{ if (s>0) currentShipIndex = i; renderShipList(); });
    wrap.appendChild(pill);
  });
}

/* placement utils */
function canPlace(startR,startC,sizeShip,orient){
  let coords = [];
  for (let i=0;i<sizeShip;i++){
    const r = startR + (orient==="V"?i:0);
    const c = startC + (orient==="H"?i:0);
    if (r<0 || r>=size || c<0 || c>=size) return null;
    coords.push(cellName(r,c));
  }
  for (const cell of coords) if (myBoard[cell] === "ship") return null;
  return coords;
}

function placeShipAt(cellId){
  if (!placing) return;
  const r = cellId.charCodeAt(0) - 65;
  const c = parseInt(cellId.slice(1),10) - 1;
  const s = shipSizes[currentShipIndex];
  if (!s || s<=0) { log("Geen schip geselecteerd of al geplaatst."); return; }
  const coords = canPlace(r,c,s,orientation);
  if (!coords){ popup("Kan hier niet plaatsen.", 1500); return; }
  coords.forEach(k => myBoard[k] = "ship");
  shipsMeta[currentShipIndex] = coords.slice();
  shipSizes[currentShipIndex] = 0;
  // advance to next unplaced
  while (currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++;
  renderShipList(); renderBoards();
}

function randomPlaceAll(){
  for (const k in myBoard) myBoard[k] = "empty";
  const sizes = shipSizes.map(x=>x).filter(x=>x>0);
  shipsMeta = [];
  for (const s of sizes){
    let tries = 0; let placed = false;
    while (!placed && tries < 1000){
      const r = Math.floor(Math.random()*size), c = Math.floor(Math.random()*size);
      const o = Math.random()<0.5 ? "H" : "V";
      const coords = canPlace(r,c,s,o);
      if (coords){ coords.forEach(k=> myBoard[k]="ship"); placed = true; shipsMeta.push(coords.slice()); }
      tries++;
    }
  }
  // fill shipSizes to zero to mark placed
  for (let i=0;i<shipSizes.length;i++) shipSizes[i]=0;
  renderShipList(); renderBoards();
}

async function saveBoard(){
  if (!gameId) return;
  // ensure shipsMeta filled: convert to consistent array
  const shipsArray = shipsMeta.filter(Boolean).map(arr => ({ cells: arr, sunk: false }));
  await set(ref(db, `games/${gameId}/players/${myId}/board`), myBoard);
  await set(ref(db, `games/${gameId}/players/${myId}/ships`), shipsArray);
  await set(ref(db, `games/${gameId}/players/${myId}/ready`), true);
  placing = false;
  // show local check overlay
  overlayCheck(boardMeEl);
  log("Board opgeslagen en gemarkeerd als ready.");
}

/* overlay check */
function overlayCheck(el){
  el.classList.add("overlay-ready");
  setTimeout(()=> el.classList.remove("overlay-ready"), 1200);
}

/* animation: shot flying from cannon to target tile */
function fireAnimation(targetTile, cb){
  const img = document.createElement("img");
  img.src = SHOT_URL;
  img.className = "shot";
  cannonArea.appendChild(img);

  const cannonRect = document.querySelector("#cannon") ? document.querySelector("#cannon").getBoundingClientRect() : {left:20, top:0, width:80, height:40};
  const targetRect = targetTile.getBoundingClientRect();
  const parentRect = cannonArea.getBoundingClientRect();
  const startX = cannonRect.left + cannonRect.width/2 - parentRect.left;
  const startY = cannonRect.top + cannonRect.height/2 - parentRect.top;
  const endX = targetRect.left + targetRect.width/2 - parentRect.left;
  const endY = targetRect.top + targetRect.height/2 - parentRect.top;

  img.style.left = startX + "px"; img.style.top = startY + "px";
  const dx = endX - startX, dy = endY - startY;
  requestAnimationFrame(()=> { img.style.transform = `translate(${dx}px, ${dy}px) rotate(10deg) scale(0.9)`; });
  setTimeout(()=>{ img.classList.add("hide"); setTimeout(()=>{ img.remove(); if (cb) cb(); }, 220); }, 780);
}

/* makeMove: transaction on target cell and additional sink/game detection */
async function makeMove(cell){
  if (!gameId) return;
  // find target player
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val();
  if (!g) return;
  const players = g.players || {};
  let targetId = null;
  for (const pid in players) if (pid !== myId) targetId = pid;
  if (!targetId) { popup("Geen tegenstander."); return; }

  try {
    // push move record
    const mvRef = ref(db, `games/${gameId}/moves`);
    const m = push(mvRef);
    await set(m, { by: myId, cell, ts: Date.now(), status: "processing" });

    // transaction on target cell
    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    const tx = await runTransaction(cellRef, current => {
      if (!current || current === "empty") return "miss";
      if (current === "ship") return "hit";
      return; // already hit/miss -> abort
    });

    const result = tx.snapshot.val();
    await set(ref(db, `games/${gameId}/moves/${m.key}/result`), result);

    // After marking hit/miss: if hit, check if a ship got sunk
    let sunkInfo = null;
    if (result === "hit") {
      // read opponent ships
      const shipsSnap = await get(ref(db, `games/${gameId}/players/${targetId}/ships`));
      const ships = shipsSnap.exists() ? shipsSnap.val() : [];
      // find which ship contains this cell
      let shipsUpdated = false;
      for (let i=0;i<ships.length;i++){
        const ship = ships[i];
        if (!ship) continue;
        if ((ship.cells || []).includes(cell)) {
          // we now check all cells' state
          const statusChecks = await Promise.all(ship.cells.map(async c => {
            const cs = await get(ref(db, `games/${gameId}/players/${targetId}/board/${c}`));
            return cs.exists() ? cs.val() === "hit" : false;
          }));
          const allHit = statusChecks.every(x=>x);
          if (allHit && !ship.sunk) {
            // mark ship sunk
            ship.sunk = true;
            sunkInfo = { shipIndex: i, cells: ship.cells };
            shipsUpdated = true;
            // write back ships array
            await set(ref(db, `games/${gameId}/players/${targetId}/ships`), ships);
            // set those opp cells to 'sunk' on public oppBoard view (optional)
            for (const c of ship.cells) {
              await set(ref(db, `games/${gameId}/players/${targetId}/board/${c}`), "hit"); // already hit
            }
          }
          break;
        }
      }
      if (sunkInfo) {
        await set(ref(db, `games/${gameId}/moves/${m.key}/sunk`), sunkInfo);
      }
    }

    // change turn to other player
    await set(ref(db, `games/${gameId}/turnUid`), targetId);

    log(`Je schoot op ${cell} -> ${result}`);
  } catch(e){ console.error(e); popup("Kon zet niet uitvoeren: " + e.message); }
}

/* listen moves (animate + refresh boards + special popups/animations) */
function listenMoves(){
  const movesRef = ref(db, `games/${gameId}/moves`);
  onValue(movesRef, async snap=>{
    const mObj = snap.val() || {};
    const keys = Object.keys(mObj);
    if (!keys.length) return;
    const last = mObj[keys[keys.length - 1]];
    if (!last) return;
    const tileSel = (last.by === myId) ? `#board-op [data-cell="${last.cell}"]` : `#board-me [data-cell="${last.cell}"]`;
    const targetTile = document.querySelector(tileSel);
    if (targetTile) {
      fireAnimation(targetTile, async ()=>{
        await refreshBoards();
        // if sunk info present, show sink animation / popup
        if (last.sunk) {
          if (last.by === myId) {
            popup(`Je hebt een schip verslagen!`, 2200);
            // highlight sunk cells on opponent board
            last.sunk.cells.forEach(c=>{
              const t = document.querySelector(`#board-op [data-cell="${c}"]`);
              if (t) t.classList.add("sunk");
            });
          } else {
            popup(`Jouw schip is gezonken!`, 2200);
            // highlight sunk on our board
            last.sunk.cells.forEach(c=>{
              const t = document.querySelector(`#board-me [data-cell="${c}"]`);
              if (t) t.classList.add("sunk");
            });
          }
        }
        // check for endgame
        await checkGameOver();
      });
    } else {
      await refreshBoards();
      await checkGameOver();
    }
  });
}

async function refreshBoards(){
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val() || {};
  infoTurn.textContent = (g.turnUid === myId) ? "Jij" : "Tegenstander";
  const players = g.players || {};
  for (const pid in players){
    if (pid === myId){
      const b = players[pid].board || {};
      for (const k in b) myBoard[k] = b[k];
    } else {
      const b = players[pid].board || {};
      for (const k in b) if (b[k] === "hit" || b[k] === "miss") oppBoard[k] = b[k];
      // if ships with sunk statuses exist, mark oppBoard cells as sunk for UI:
      const shipsSnap = await get(ref(db, `games/${gameId}/players/${pid}/ships`));
      const ships = shipsSnap.exists() ? shipsSnap.val() : [];
      for (const s of ships || []) if (s && s.sunk) { (s.cells||[]).forEach(c => oppBoard[c] = "sunk"); }
    }
  }
  renderBoards();
}

/* check if a player has lost all ships -> finish game and update leaderboard */
async function checkGameOver(){
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val() || {};
  const players = g.players || {};
  let winner = null;
  for (const pid in players) {
    const shipsSnap = await get(ref(db, `games/${gameId}/players/${pid}/ships`));
    const ships = shipsSnap.exists() ? shipsSnap.val() : [];
    const allSunk = ships.length > 0 && ships.every(s => s && s.sunk);
    if (allSunk) {
      // the other player wins
      for (const oth in players) if (oth !== pid) winner = oth;
      // set game finished
      await set(ref(db, `games/${gameId}/status`), "finished");
      await set(ref(db, `games/${gameId}/winnerUid`), winner);
      // announce
      if (winner === myId) {
        winnerAnimation();
        await updateWins(myId);
      } else {
        loserAnimation();
      }
      // show final popup
      const msg = (winner === myId) ? "Gefeliciteerd — je hebt gewonnen!" : "Helaas, je hebt verloren.";
      popup(msg, 4000);
      break;
    }
  }
}

/* Update wins in users DB (only for non-guests) */
async function updateWins(uid){
  // try to increment profile wins if user exists in DB
  try {
    const profileSnap = await get(ref(db, `users/${uid}/profile`));
    if (!profileSnap.exists()) return;
    const w = profileSnap.val().wins || 0;
    await set(ref(db, `users/${uid}/profile/wins`), w + 1);
  } catch(e){ console.warn("Update wins failed", e); }
}

/* Simple animations */
function winnerAnimation(){
  const el = document.createElement("div");
  el.className = "end-anim winner";
  el.textContent = "WIN!";
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 3500);
}
function loserAnimation(){
  const el = document.createElement("div");
  el.className = "end-anim loser";
  el.textContent = "LOSE!";
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 3500);
}

/* UI modal/popup creation */
function createModalElements(){
  // small popup area for in-game messages
  const wrap = document.createElement("div");
  wrap.id = "in-game-modals";
  document.body.appendChild(wrap);
  return wrap;
}
function popup(text, ms=1500){
  const d = document.createElement("div");
  d.className = "in-game-popup";
  d.textContent = text;
  modal.appendChild(d);
  setTimeout(()=> { d.classList.add("fade"); setTimeout(()=> d.remove(), 400); }, ms);
}

/* init flow */
async function init(){
  if (!lobbyCode) { popup("Geen lobby code! Ga terug."); return; }
  infoLobby.textContent = lobbyCode; infoPlayer.textContent = profile.username || profile.id;
  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()) { popup("Lobby niet gevonden"); return; }
  const lobby = lobbySnap.val();
  gameId = lobby.gameId;
  setSize(lobby.gamemode || 10);

  // ensure player exists in game node
  const meRef = ref(db, `games/${gameId}/players/${myId}`);
  const meSnap = await get(meRef);
  if (!meSnap.exists()){
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
    await set(meRef, { username: profile.username, slot, ready: false });
  }

  // events
  boardMeEl.addEventListener("click", e => {
    const t = e.target.closest(".tile"); if (!t) return; placeShipAt(t.dataset.cell);
  });

  boardOpEl.addEventListener("click", async e => {
    const t = e.target.closest(".tile"); if (!t) return;
    const cell = t.dataset.cell;
    // check if your turn
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val();
    if (!g) return;
    if (g.turnUid !== myId){ popup("Niet jouw beurt"); return; }
    if (oppBoard[cell] === "hit" || oppBoard[cell] === "miss" || oppBoard[cell] === "sunk"){ popup("Al geschoten op deze cel"); return; }
    await makeMove(cell);
  });

  btnRandom.addEventListener("click", randomPlaceAll);
  btnReady.addEventListener("click", saveBoard);
  btnRotate.addEventListener("click", ()=>{ orientation = orientation==="H"?"V":"H"; btnRotate.textContent = `Rotate (${orientation})`; });

  // on players changes: show ready status and auto-start when both ready
  onValue(ref(db, `games/${gameId}/players`), async snap => {
    const players = snap.val() || {};
    const count = Object.keys(players).length;
    // show visual ready marks
    for (const pid in players) {
      if (pid === myId) {
        if (players[pid].ready) overlayCheck(boardMeEl);
      } else {
        if (players[pid].ready) overlayCheck(boardOpEl);
      }
    }
    // auto-start when both ready
    const ids = Object.keys(players || {});
    if (ids.length >= 2) {
      const bothReady = ids.every(id => players[id].ready);
      if (bothReady && (!gSnapshotCache || gSnapshotCache.status === "waiting")) {
        const starter = ids[Math.floor(Math.random()*ids.length)];
        await set(ref(db, `games/${gameId}/status`), "in_progress");
        await set(ref(db, `games/${gameId}/turnUid`), starter);
        popup("Game gestart!", 1800);
      }
    }
  });

  // listen changes to game node for updates
  let gSnapshotCache = null;
  onValue(ref(db, `games/${gameId}`), async snap => {
    const g = snap.val() || {};
    gSnapshotCache = g;
    infoTurn.textContent = (g.turnUid === myId) ? "Jij" : "Tegenstander";
    await refreshBoards();
  });

  listenMoves();
  renderBoards();
  headerSub.textContent = `Gamemode: ${size} × ${size} — Plaats je schepen en druk op 'Klaar' wanneer je klaar bent.`;
}

init();
