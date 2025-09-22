// game.js — volledige game flow, no spamming popups
import { db } from "./firebase-config.js";
import { loadLocalProfile, incrementWinsForUid } from "./app-auth.js";
import {
  ref, get, set, onValue, push, runTransaction, update
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

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

const qs = new URLSearchParams(location.search);
const lobbyCode = qs.get("lobby");
if (!lobbyCode) { $("status-msg").textContent = "Geen lobby code"; throw "No lobby code"; }

const infoLobby = $("info-lobby"), infoPlayer = $("info-player"), infoTurn = $("info-turn");
const boardMeEl = $("board-me"), boardOpEl = $("board-op");
const shipListEl = $("ship-list");
const btnRandom = $("btn-random"), btnReady = $("btn-ready"), btnRotate = $("btn-rotate");
const readyBadgeMe = $("ready-badge-me"), readyBadgeOp = $("ready-badge-op");
const overlay = $("overlay"), overlayContent = $("overlay-content"), overlayActions = $("overlay-actions");
const logEl = $("log"), leaderboardEl = $("leaderboard");

let gameId = null;
let size = 10;
let myId = profile.uid;
let myBoard = {}, oppBoard = {};
let shipSizes = [5,4,3,3,2];
let placedShips = []; // {id, cells}
let currentShipIndex = 0;
let orientation = "H";

/* UI logging */
function log(msg){ const d=document.createElement("div"); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }

/* overlay (non-blocking) */
function showOverlay(msg, actionsHTML="") {
  if (!overlay) return console.log("overlay:", msg);
  overlayContent.innerHTML = msg;
  overlayActions.innerHTML = actionsHTML || `<button id="overlay-close">OK</button>`;
  overlay.classList.remove("hidden");
  const close = document.getElementById("overlay-close");
  if (close) close.onclick = () => overlay.classList.add("hidden");
}

/* grid creation & rendering */
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
  createGrid(boardMeEl,n);
  createGrid(boardOpEl,n);
  myBoard = {}; oppBoard = {};
  placedShips = [];
  currentShipIndex = 0;
  orientation = "H";
  if (n>=15) shipSizes = [5,4,4,3,3,2];
  else if (n>=10) shipSizes = [5,4,3,3,2];
  else shipSizes = [3,2,2];
  for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoard[cellName(r,c)] = "empty";
  renderShipList(); renderBoards();
}

function renderBoards(){
  Array.from(boardMeEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.className = "tile sea";
    tile.innerHTML = "";
    if (myBoard[id] === "ship") tile.classList.add("ship");
    if (myBoard[id] === "hit") { tile.classList.add("hit"); tile.innerHTML = "💥"; }
    if (myBoard[id] === "miss") { tile.classList.add("miss"); tile.innerHTML = "🌊"; }
    if (myBoard[id] === "sunk") { tile.classList.add("sunk"); tile.innerHTML = "☠️"; }
  });
  Array.from(boardOpEl.children).forEach(tile=>{
    const id = tile.dataset.cell;
    tile.className = "tile sea";
    tile.innerHTML = "";
    if (oppBoard[id] === "hit") { tile.classList.add("hit"); tile.innerHTML = "🔥"; }
    if (oppBoard[id] === "miss") { tile.classList.add("miss"); tile.innerHTML = "🌊"; }
    if (oppBoard[id] === "sunk") { tile.classList.add("sunk"); tile.innerHTML = "☠️"; }
  });
}

/* ship list */
function renderShipList(){
  shipListEl.innerHTML = "";
  shipSizes.forEach((s,i)=>{
    const pill = document.createElement("div");
    pill.className = "ship-pill" + (i===currentShipIndex ? " active" : "");
    pill.textContent = `Ship ${i+1} — ${s>0?s:"placed"}`;
    pill.addEventListener("click", ()=>{ if (s>0) currentShipIndex = i; renderShipList(); });
    shipListEl.appendChild(pill);
  });
}

/* placement utils */
function canPlace(startR,startC,sizeShip,orient){
  const coords = [];
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
  const r = cellId.charCodeAt(0) - 65;
  const c = parseInt(cellId.slice(1),10) - 1;
  const s = shipSizes[currentShipIndex];
  if (!s || s<=0) { log("Geen schip geselecteerd"); return; }
  const coords = canPlace(r,c,s,orientation);
  if (!coords){ log("Kan hier niet plaatsen"); return; }
  coords.forEach(k => myBoard[k] = "ship");
  placedShips.push({ id: 'ship_' + Date.now() + '_' + Math.floor(Math.random()*9999), cells: coords });
  shipSizes[currentShipIndex] = 0;
  while (currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++;
  renderShipList(); renderBoards();
}

function randomPlaceAll(){
  for (const k in myBoard) myBoard[k] = "empty";
  placedShips = [];
  const sizes = shipSizes.map(x=>x).filter(x=>x>0);
  for (const s of sizes){
    let tries = 0, placed = false;
    while (!placed && tries < 1000){
      const r = Math.floor(Math.random()*size), c = Math.floor(Math.random()*size);
      const o = Math.random()<0.5 ? "H" : "V";
      const coords = canPlace(r,c,s,o);
      if (coords){ coords.forEach(k=> myBoard[k] = "ship"); placedShips.push({id:'ship_'+Date.now()+'_'+Math.floor(Math.random()*9999), cells: coords}); placed = true; }
      tries++;
    }
  }
  for (let i=0;i<shipSizes.length;i++) shipSizes[i] = 0;
  renderShipList(); renderBoards();
}

/* save board to DB and set ready */
async function saveBoard(){
  if (!gameId) return;
  await set(ref(db, `games/${gameId}/players/${myId}/board`), myBoard);
  await set(ref(db, `games/${gameId}/players/${myId}/ships`), placedShips);
  await set(ref(db, `games/${gameId}/players/${myId}/ready`), true);
  $("ready-badge-me").textContent = "✔️ Klaar";
  log("Board opgeslagen (ready).");
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
async function makeMove(cell){
  if (!gameId) return;
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val();
  if (!g) return;
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
        }
      }
    } else {
      await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), "miss");
    }

    await set(ref(db, `games/${gameId}/turnUid`), targetId);

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
  }
}

/* main init */
async function init(){
  infoLobby.textContent = lobbyCode;
  infoPlayer.textContent = profile.username || profile.uid;
  // load lobby => find gameId
  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()) { $("status-msg").textContent = "Lobby niet gevonden"; return; }
  const lobby = lobbySnap.val();
  gameId = lobby.gameId;
  setSize(lobby.gamemode || 10);

  // ensure player in game node
  const meRef = ref(db, `games/${gameId}/players/${myId}`);
  const meSnap = await get(meRef);
  if (!meSnap.exists()){
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
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
      } else {
        if (players[pid].ready) $("ready-badge-op").textContent = "✔️ Klaar";
      }
    }
  });

  // listen for game state changes
  onValue(ref(db, `games/${gameId}`), async snap => {
    const g = snap.val() || {};
    if (g.turnUid) infoTurn.textContent = (g.turnUid === myId) ? "Jij" : "Tegenstander";
    await refreshBoards();
  });

  listenMoves();
  await refreshBoards();
  loadLeaderboard();
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
  }
  arr.sort((a,b) => b.wins - a.wins);
  leaderboardEl.innerHTML = "";
  arr.slice(0,50).forEach((u,i)=>{
    const row = document.createElement("div");
    row.className = "leader-row";
    row.innerHTML = `<div class="leader-pos">${i+1}</div><div class="leader-name">${u.name}</div><div class="leader-wins">${u.wins} winst(en)</div>`;
    leaderboardEl.appendChild(row);
  });
}

