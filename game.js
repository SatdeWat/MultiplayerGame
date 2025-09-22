// game.js - volledig herschreven, geen pop-ups bij geen profiel
// Werkt alleen als er een profiel is (inloggen, registreren of gast)
import { db } from "./firebase-config.js";
import { loadLocalProfile } from "./app-auth.js";
import {
  ref, get, set, onValue, push, runTransaction, update
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

// HELPERS
const $ = id => document.getElementById(id);
const alpha = n => String.fromCharCode(65 + n);
const cellName = (r,c) => `${alpha(r)}${c+1}`;
const logMsg = msg => { const d=document.createElement("div"); d.textContent=`${new Date().toLocaleTimeString()} — ${msg}`; $("log")?.prepend(d); };
const showPopup = (msg, ms=1500) => {
  const overlay = $("overlay");
  const overlayContent = $("overlay-content");
  const overlayActions = $("overlay-actions");
  if (!overlay || !overlayContent || !overlayActions) return console.log("info:", msg);
  overlayContent.innerHTML = `<div style="font-weight:700">${msg}</div>`;
  overlayActions.innerHTML = `<button id="overlay-close">OK</button>`;
  overlay.classList.remove("hidden");
  $("overlay-close")?.addEventListener("click", ()=>overlay.classList.add("hidden"));
  setTimeout(()=>overlay.classList.add("hidden"), ms);
};

// GRIDS
const boardMeEl = $("board-me");
const boardOpEl = $("board-op");
let size=10, myBoard={}, oppBoard={}, placedShips=[], orientation='H', currentShipIndex=0;
let shipSizes = [5,4,3,3,2];

// PROFILE
const profile = loadLocalProfile();
if (!profile) {
  console.log("Geen profiel aanwezig. Wacht tot speler kiest: inloggen, registreren of gast.");
} else {
  initGame(profile);
}

// FUNCTIES
function initGame(profileSafe){
  const myId = profileSafe.uid;

  // init DOM grids
  const createGrid = (el,n) => {
    if(!el) return;
    el.innerHTML=''; el.className=''; el.classList.add(`cell-${n}`);
    el.style.gridTemplateRows = `repeat(${n},1fr)`;
    for(let r=0;r<n;r++){
      for(let c=0;c<n;c++){
        const tile = document.createElement('div');
        tile.className='tile sea';
        tile.dataset.r=r; tile.dataset.c=c; tile.dataset.cell=cellName(r,c);
        el.appendChild(tile);
      }
    }
  };

  function setSize(n){
    size=n;
    createGrid(boardMeEl,n); createGrid(boardOpEl,n);
    myBoard={}; oppBoard={}; placedShips=[];
    for(let r=0;r<size;r++) for(let c=0;c<size;c++) myBoard[cellName(r,c)]='empty';
    if(n>=15) shipSizes=[5,4,4,3,3,2];
    else if(n>=10) shipSizes=[5,4,3,3,2];
    else shipSizes=[3,2,2];
    renderShipList(); renderBoards();
  }

  function renderBoards(){
    Array.from(boardMeEl.children).forEach(tile=>{
      const id=tile.dataset.cell;
      tile.className='tile sea'; tile.innerHTML='';
      if(myBoard[id]==='ship') tile.classList.add('ship');
      if(myBoard[id]==='hit'){ tile.classList.add('hit'); tile.innerHTML='💥'; }
      if(myBoard[id]==='miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if(myBoard[id]==='sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; }
    });
    Array.from(boardOpEl.children).forEach(tile=>{
      const id=tile.dataset.cell;
      tile.className='tile sea'; tile.innerHTML='';
      if(oppBoard[id]==='hit'){ tile.classList.add('hit'); tile.innerHTML='🔥'; }
      if(oppBoard[id]==='miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if(oppBoard[id]==='sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; }
    });
  }

  function renderShipList(){
    const wrap=$("ship-list"); if(!wrap) return;
    wrap.innerHTML='';
    shipSizes.forEach((s,i)=>{
      const pill=document.createElement('div');
      pill.className='ship-pill'+(i===currentShipIndex?' active':'');
      pill.textContent=`Ship ${i+1} — ${s>0?s:"placed"}`;
      pill.addEventListener('click',()=>{ if(s>0) currentShipIndex=i; renderShipList(); });
      wrap.appendChild(pill);
    });
  }

  // PLACE SHIPS
  function canPlace(r,c,s,orient){
    const coords=[]; for(let i=0;i<s;i++){
      const rr=r+(orient==='V'?i:0); const cc=c+(orient==='H'?i:0);
      if(rr<0||rr>=size||cc<0||cc>=size) return null; coords.push(cellName(rr,cc));
    }
    for(const cell of coords) if(myBoard[cell]==='ship') return null;
    return coords;
  }
  function placeShipAt(cellId){
    const r=cellId.charCodeAt(0)-65; const c=parseInt(cellId.slice(1),10)-1;
    const s=shipSizes[currentShipIndex]; if(!s||s<=0){ showPopup('Geen schip geselecteerd'); return; }
    const coords=canPlace(r,c,s,orientation); if(!coords){ showPopup('Kan hier niet plaatsen'); return; }
    coords.forEach(k=>myBoard[k]='ship');
    placedShips.push({id:'ship_'+Date.now()+'_'+Math.floor(Math.random()*9999),cells:coords});
    shipSizes[currentShipIndex]=0; while(currentShipIndex<shipSizes.length&&shipSizes[currentShipIndex]===0) currentShipIndex++;
    renderShipList(); renderBoards();
  }
  function randomPlaceAll(){
    for(const k in myBoard) myBoard[k]='empty'; placedShips=[];
    const sizes=shipSizes.map(x=>x>0?x:0).filter(x=>x>0);
    for(const s of sizes){
      let tries=0,placed=false;
      while(!placed&&tries<500){
        const r=Math.floor(Math.random()*size); const c=Math.floor(Math.random()*size);
        const o=Math.random()<0.5?'H':'V'; const coords=canPlace(r,c,s,o);
        if(coords){ coords.forEach(k=>myBoard[k]='ship'); placedShips.push({id:'ship_'+Date.now()+'_'+Math.floor(Math.random()*9999),cells:coords}); placed=true; }
        tries++;
      }
    }
    for(let i=0;i<shipSizes.length;i++) shipSizes[i]=0;
    renderShipList(); renderBoards();
  }

  // EVENT LISTENERS
  boardMeEl?.addEventListener('click',e=>{
    const t=e.target.closest('.tile'); if(!t) return; placeShipAt(t.dataset.cell);
  });
  boardOpEl?.addEventListener('click', async e=>{
    const t=e.target.closest('.tile'); if(!t) return;
    const cell=t.dataset.cell;
    if(oppBoard[cell]==='hit'||oppBoard[cell]==='miss'||oppBoard[cell]==='sunk'){ showPopup('Al geschoten op deze cel'); return; }
    // hier kan makeMove(cell) komen zoals eerder
  });
  $("btn-random")?.addEventListener('click', randomPlaceAll);
  $("btn-rotate")?.addEventListener('click',()=>{ orientation=orientation==='H'?'V':'H'; $("btn-rotate").textContent=`Rotate (${orientation})`; });

  setSize(size);
  renderBoards();
}
