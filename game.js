// game.js
import { db } from "./firebase-config.js";
import { loadLocalProfile } from "./app-auth.js";
import {
  ref, get, set, onValue, push, runTransaction
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const qs = new URLSearchParams(location.search);
const lobbyCode = qs.get("lobby");
const profile = loadLocalProfile() || { name:"Gast", username:"gast", age:"", id:`guest${Math.floor(Math.random()*9999)}` };

const $ = id => document.getElementById(id);
const boardMeEl = $("board-me"), boardOpEl = $("board-op");
const infoLobby = $("info-lobby"), infoPlayer = $("info-player"), infoTurn = $("info-turn");
const btnRandom = $("btn-random"), btnReady = $("btn-ready"), btnRotate = $("btn-rotate");
const timerWrap = $("placement-timer"), timerCountEl = $("timer-count");
const cannonArea = $("cannon-area"), logEl = $("log"), headerSub = $("header-sub");

let gameId = null;
let size = 10;
let myId = profile.id;
let myBoard = {}, oppBoard = {};
let placing = true;
let timer = null;
let timeLeft = 30;
let orientation = "H";
let shipSizes = [5,4,3,3,2];
let currentShipIndex = 0;

// image URLs (user provided)
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
  if (!coords){ log("Kan hier niet plaatsen."); return; }
  coords.forEach(k => myBoard[k] = "ship");
  shipSizes[currentShipIndex] = 0;
  // advance to next unplaced
  while (currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++;
  renderShipList(); renderBoards();
}

function randomPlaceAll(){
  for (const k in myBoard) myBoard[k] = "empty";
  const sizes = shipSizes.map(x=>x).filter(x=>x>0);
  for (const s of sizes){
    let tries = 0; let placed = false;
    while (!placed && tries < 1000){
      const r = Math.floor(Math.random()*size), c = Math.floor(Math.random()*size);
      const o = Math.random()<0.5 ? "H" : "V";
      const coords = canPlace(r,c,s,o);
      if (coords){ coords.forEach(k=> myBoard[k]="ship"); placed = true; }
      tries++;
    }
  }
  for (let i=0;i<shipSizes.length;i++) shipSizes[i]=0;
  renderShipList(); renderBoards();
}

async function saveBoard(){
  if (!gameId) return;
  await set(ref(db, `games/${gameId}/players/${myId}/board`), myBoard);
  await set(ref(db, `games/${gameId}/players/${myId}/ready`), true);
  placing = false;
  stopTimer();
  log("Board opgeslagen en gemarkeerd als ready.");
}

function startTimer(){
  timeLeft = 30; timerWrap.classList.remove("hidden"); timerCountEl.textContent = timeLeft;
  timer = setInterval(()=>{
    timeLeft--; timerCountEl.textContent = timeLeft;
    if (timeLeft <= 0){ clearInterval(timer); timer=null; timerWrap.classList.add("hidden"); randomPlaceAll(); saveBoard(); }
  },1000);
}
function stopTimer(){ if (timer) clearInterval(timer); timer=null; timerWrap.classList.add("hidden"); }

/* animation: shot flying from cannon to target tile */
function fireAnimation(targetTile, cb){
  const img = document.createElement("img");
  img.src = SHOT_URL;
  img.className = "shot";
  cannonArea.appendChild(img);

  const cannonEl = document.createElement("img");
  cannonEl.src = CANNON_URL; cannonEl.id = "tmp-cannon"; cannonEl.style.display = "none";
  // compute positions
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

/* moves: atomic update using runTransaction on target cell */
async function makeMove(cell){
  if (!gameId) return;
  // find target player
  const gSnap = await get(ref(db, `games/${gameId}`));
  const g = gSnap.val();
  if (!g) return;
  const players = g.players || {};
  let targetId = null;
  for (const pid in players) if (pid !== myId) targetId = pid;
  if (!targetId) { alert("Geen tegenstander."); return; }

  try {
    // push move record
    const mvRef = ref(db, `games/${gameId}/moves`);
    const m = push(mvRef);
    await set(m, { by: myId, cell, ts: Date.now(), status: "processing" });

    // transaction on target cell
    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, current => {
      if (!current || current === "empty") return "miss";
      if (current === "ship") return "hit";
      return; // already hit/miss -> abort
    });

    const resSnap = await get(cellRef);
    const result = resSnap.val();
    await set(ref(db, `games/${gameId}/moves/${m.key}/result`), result);
    // set next turn to other player
    await set(ref(db, `games/${gameId}/turnUid`), targetId);
    log(`Je schoot op ${cell} -> ${result}`);
  } catch(e){ console.error(e); alert("Kon zet niet uitvoeren: " + e.message); }
}

/* listen moves (animate + refresh boards) */
function listenMoves(){
  const movesRef = ref(db, `games/${gameId}/moves`);
  onValue(movesRef, async snap=>{
    const m = snap.val() || {};
    const keys = Object.keys(m);
    if (!keys.length) return;
    const last = m[keys[keys.length - 1]];
    const tileSel = (last.by === myId) ? `#board-op [data-cell="${last.cell}"]` : `#board-me [data-cell="${last.cell}"]`;
    const targetTile = document.querySelector(tileSel);
    if (targetTile) {
      fireAnimation(targetTile, async ()=> await refreshBoards());
    } else {
      await refreshBoards();
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
    }
  }
  renderBoards();
}

/* init flow */
async function init(){
  if (!lobbyCode) { alert("Geen lobby code! Ga terug."); return; }
  infoLobby.textContent = lobbyCode; infoPlayer.textContent = profile.name;
  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()) { alert("Lobby niet gevonden"); return; }
  const lobby = lobbySnap.val();
  gameId = lobby.gameId;
  setSize(lobby.gamemode || 10);

  // ensure player exists in game node
  const meRef = ref(db, `games/${gameId}/players/${myId}`);
  const meSnap = await get(meRef);
  if (!meSnap.exists()){
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
    await set(meRef, { name: profile.name, slot, ready: false });
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
    if (g.turnUid !== myId){ alert("Niet jouw beurt"); return; }
    if (oppBoard[cell] === "hit" || oppBoard[cell] === "miss"){ alert("Al geschoten op deze cel"); return; }
    await makeMove(cell);
  });

  btnRandom.addEventListener("click", randomPlaceAll);
  btnReady.addEventListener("click", saveBoard);
  btnRotate.addEventListener("click", ()=>{ orientation = orientation==="H"?"V":"H"; btnRotate.textContent = `Rotate (${orientation})`; });

  // start timer when both spelers aanwezig en niet ready
  onValue(ref(db, `games/${gameId}/players`), snap => {
    const players = snap.val() || {};
    const count = Object.keys(players).length;
    if (count >= 2) {
      const me = players[myId] || {};
      if (!me.ready && !timer) startTimer();
    }
  });

  onValue(ref(db, `games/${gameId}`), async snap => {
    const g = snap.val() || {};
    // auto-start when both ready
    const players = g.players || {};
    const ids = Object.keys(players || {});
    if (g.status === "waiting" && ids.length >= 2) {
      const bothReady = ids.every(id => players[id].ready);
      if (bothReady) {
        const starter = ids[Math.floor(Math.random()*ids.length)];
        await set(ref(db, `games/${gameId}/status`), "in_progress");
        await set(ref(db, `games/${gameId}/turnUid`), starter);
      }
    }
    infoTurn.textContent = (g.turnUid === myId) ? "Jij" : "Tegenstander";
    await refreshBoards();
  });

  listenMoves();
  renderBoards();
  headerSub.textContent = `Gamemode: ${size} × ${size} — Plaats je schepen binnen 30s of druk Random`;
}

init();
