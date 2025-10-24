// game.js (toevoeging bovenaan)
export function initGame({size:sz, mode:m}) {
  window.gameMode = m || "classic";
  window.boardSize = sz || 10;
  startGame();
}

// alles uit oude init() functie wordt in startGame() gezet
function startGame(){
  const size = window.boardSize;
  createGrid(boardMeEl,size);
  createGrid(boardOpEl,size);
  for(let r=0;r<size;r++) for(let c=0;c<size;c++){ myBoard[cellName(r,c)]="empty"; oppBoard[cellName(r,c)]="empty"; }
  renderBoards();
  renderShipList();

  boardMeEl.addEventListener("click",e=>{
    if(e.target.classList.contains("tile")) placeShipAt(e.target.dataset.cell);
  });
  btnRotate.onclick=()=>{ orientation=orientation==="H"?"V":"H"; showPopup("Orientation "+orientation); };
  btnRandom.onclick=randomPlaceAll;
  btnReady.onclick=saveBoard;

  // eventueel per mode
  if(window.gameMode==="streak"){ /* logica om door te blijven schieten bij hit */ }
  if(window.gameMode==="power"){ /* 15x15 board, evt extra features */ }

  showPopup("Mode: "+window.gameMode);
}

import { db } from "./firebase-config.js";
import { ref, set, get, onValue, runTransaction, push } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { loadLocalProfile, showPopup } from "./login.js";

const profile = loadLocalProfile();
const qs = new URLSearchParams(location.search); const lobbyCode = qs.get("lobby");

const $=id=>document.getElementById(id);
const boardMeEl=$("board-me"), boardOpEl=$("board-op");
const infoLobby=$("info-lobby"), infoPlayer=$("info-player"), infoTurn=$("info-turn");
const btnReady=$("btn-ready"), btnRotate=$("btn-rotate"), btnRandom=$("btn-random");
const headerSub=$("header-sub"), shipListEl=$("ship-list"), cannonArea=$("cannon-area"), logEl=$("log");

let gameId=null, size=10, myBoard={}, oppBoard={}, placing=true, orientation="H";
let shipSizes=[5,4,3,3,2], currentShipIndex=0;

function alpha(n){ return String.fromCharCode(65+n); }
function cellName(r,c){ return `${alpha(r)}${c+1}`; }
function createGrid(el,n){ el.innerHTML=""; el.className="board"; el.classList.add(`cell-${n}`); el.style.gridTemplateRows=`repeat(${n},1fr)`; for(let r=0;r<n;r++)for(let c=0;c<n;c++){ const tile=document.createElement("div"); tile.className="tile sea"; tile.dataset.r=r; tile.dataset.c=c; tile.dataset.cell=cellName(r,c); el.appendChild(tile); } }

function renderBoards(){
  Object.entries(myBoard).forEach(([id,val])=>{
    const tile=boardMeEl.querySelector(`[data-cell="${id}"]`);
    if(tile){ tile.className="tile sea"; tile.innerHTML=""; if(val==="ship") tile.classList.add("ship"); if(val==="hit"){tile.classList.add("hit");tile.innerHTML="💥";} if(val==="miss"){tile.classList.add("miss");tile.innerHTML="🌊";} }
  });
  Object.entries(oppBoard).forEach(([id,val])=>{
    const tile=boardOpEl.querySelector(`[data-cell="${id}"]`);
    if(tile){ tile.className="tile sea"; tile.innerHTML=""; if(val==="hit"){tile.classList.add("hit");tile.innerHTML="🔥";} if(val==="miss"){tile.classList.add("miss");tile.innerHTML="🌊";} }
  });
}

function renderShipList(){
  shipListEl.innerHTML="";
  shipSizes.forEach((s,i)=>{
    const pill=document.createElement("div"); pill.className="ship-pill"+(i===currentShipIndex?" active":"");
    pill.textContent=`Ship ${i+1} — ${s>0?s:"placed"}`; pill.addEventListener("click", ()=>{ if(s>0) currentShipIndex=i; renderShipList(); });
    shipListEl.appendChild(pill);
  });
}

function canPlace(r,c,s,o){ let coords=[]; for(let i=0;i<s;i++){ const rr=r+(o==="V"?i:0),cc=c+(o==="H"?i:0); if(rr>=size||cc>=size) return null; coords.push(cellName(rr,cc)); } if(coords.some(k=>myBoard[k]==="ship")) return null; return coords; }

function placeShipAt(cellId){ if(!placing) return; const r=cellId.charCodeAt(0)-65; const c=parseInt(cellId.slice(1),10)-1; const s=shipSizes[currentShipIndex]; if(!s||s<=0){ return showPopup("Geen schip geselecteerd"); } const coords=canPlace(r,c,s,orientation); if(!coords){ return showPopup("Kan hier niet plaatsen"); return; } coords.forEach(k=>myBoard[k]="ship"); shipSizes[currentShipIndex]=0; while(currentShipIndex<shipSizes.length&&shipSizes[currentShipIndex]===0) currentShipIndex++; renderShipList(); renderBoards(); }

function randomPlaceAll(){ for(const k in myBoard) myBoard[k]="empty"; shipSizes.map(x=>x).filter(x=>x>0).forEach(s=>{ let placed=false,tries=0; while(!placed&&tries<1000){ const r=Math.floor(Math.random()*size),c=Math.floor(Math.random()*size),o=Math.random()<0.5?"H":"V"; const coords=canPlace(r,c,s,o); if(coords){coords.forEach(k=>myBoard[k]="ship");placed=true;} tries++; } }); shipSizes=shipSizes.map(()=>0); renderShipList(); renderBoards(); }

async function saveBoard(){
  if(!gameId) return;
  await set(ref(db, `games/${gameId}/players/${profile.username}/board`), myBoard);
  await set(ref(db, `games/${gameId}/players/${profile.username}/ready`), true);
  placing=false;
  showPopup("Board klaar!");
}

async function init(){
  if(!lobbyCode){ showPopup("Geen lobby code!"); return; }
  infoLobby.textContent=lobbyCode; infoPlayer.textContent=profile.username;
  const lobbySnap=await get(ref(db, `lobbies/${lobbyCode}`));
  if(!lobbySnap.exists()){ showPopup("Lobby niet gevonden"); return; }
  const lobby=lobbySnap.val(); gameId=lobby.gameId; size=lobby.gamemode||10;
  createGrid(boardMeEl,size); createGrid(boardOpEl,size);
  for(let r=0;r<size;r++) for(let c=0;c<size;c++){ myBoard[cellName(r,c)]="empty"; oppBoard[cellName(r,c)]="empty"; }
  renderBoards(); renderShipList();

  boardMeEl.addEventListener("click",e=>{
    if(e.target.classList.contains("tile")) placeShipAt(e.target.dataset.cell);
  });
  btnRotate.onclick=()=>{ orientation=orientation==="H"?"V":"H"; showPopup("Orientation "+orientation); };
  btnRandom.onclick=randomPlaceAll;
  btnReady.onclick=saveBoard;

  onValue(ref(db, `games/${gameId}/players`), snap=>{
    const val=snap.val(); if(!val) return; Object.entries(val).forEach(([u,v])=>{
      if(v.ready) showPopup(u+" is ready"); if(v.board){ /* TODO: render opponent board when firing */ } });
  });
}

window.onload=init;
