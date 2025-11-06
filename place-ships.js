// place-ships.js
import { db, dbRef, dbGet, dbSet, dbOnValue } from './firebase.js';

const player = localStorage.getItem('player');
const lobbyCode = localStorage.getItem('lobbyCode');
if(!lobbyCode) { alert('Geen lobby'); location.href='index.html' }
document.getElementById('meLabel').textContent = player || 'Gast';

const boardWrap = document.getElementById('boardWrap');
const orient = document.getElementById('orient');
const shipSizeSelect = document.getElementById('shipSize');
const shipSetList = document.getElementById('shipSetList');
const placeMsg = document.getElementById('placeMsg');

let lobbyData = null;
let gridSize = 15;
let shipSet = [];
let placedShips = []; // arrays of indices
let occupied = new Set();

async function init(){
  const snap = await dbGet(dbRef(db, `lobbies/${lobbyCode}`));
  if(!snap.exists()) { alert('Lobby bestaat niet'); location.href='index.html' }
  lobbyData = snap.val();
  gridSize = lobbyData.size || 15;
  shipSet = lobbyData.shipSet || [5,4,3,2];
  renderShipSet();
  makeGrid();
  // populate shipSizeSelect
  shipSizeSelect.innerHTML = '';
  const counts = {};
  shipSet.forEach(s=> counts[s] = (counts[s] || 0) + 1);
  Object.keys(counts).sort((a,b)=>b-a).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s + ' (' + counts[s] + 'x)';
    shipSizeSelect.appendChild(opt);
  });
}
function renderShipSet(){
  shipSetList.textContent = 'Schepen: ' + shipSet.join(', ');
}

function makeGrid(){
  boardWrap.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'board';
  grid.style.gridTemplateColumns = `repeat(${gridSize}, 34px)`;
  grid.dataset.size = gridSize;
  for(let i=0;i<gridSize*gridSize;i++){
    const c = document.createElement('div');
    c.className = 'cell';
    c.dataset.i = i;
    c.addEventListener('click', ()=> onCellClick(i));
    c.addEventListener('contextmenu', (e)=> { e.preventDefault(); onCellRight(i); });
    grid.appendChild(c);
  }
  boardWrap.appendChild(grid);
}

function idxToRC(i){ return { r: Math.floor(i/gridSize), c: i%gridSize }; }
function rcToIdx(r,c){ return r*gridSize + c; }

function onCellClick(i){
  const sLen = parseInt(shipSizeSelect.value,10);
  const o = orient.value;
  const rc = idxToRC(i);
  const coords = [];
  for(let k=0;k<sLen;k++){
    const r = o==='h' ? rc.r : rc.r + k;
    const c = o==='h' ? rc.c + k : rc.c;
    if(r<0||r>=gridSize||c<0||c>=gridSize){ showMsg('Past niet op bord'); return; }
    coords.push(rcToIdx(r,c));
  }
  for(const pos of coords) if(occupied.has(pos)){ showMsg('Botsing met bestaand schip'); return; }
  placedShips.push(coords);
  coords.forEach(x=> occupied.add(x));
  renderPlaced();
  showMsg('Schip geplaatst: ' + sLen);
}

function onCellRight(i){
  // remove ship if cell part of it
  for(let si=0;si<placedShips.length;si++){
    if(placedShips[si].includes(i)){
      const ship = placedShips.splice(si,1)[0];
      ship.forEach(x=> occupied.delete(x));
      renderPlaced();
      showMsg('Schip verwijderd');
      return;
    }
  }
  showMsg('Geen schip op dit vak.');
}

function renderPlaced(){
  const cells = document.querySelectorAll('#boardWrap .cell');
  cells.forEach(c => { c.classList.remove('own'); c.textContent=''; });
  placedShips.forEach((ship,idx)=>{
    ship.forEach(i=>{
      const el = document.querySelector(`.cell[data-i='${i}']`);
      if(el){ el.classList.add('own'); el.textContent = (idx+1); }
    });
  });
}

document.getElementById('undo').addEventListener('click', ()=>{
  const last = placedShips.pop();
  if(last){ last.forEach(x=> occupied.delete(x)); renderPlaced(); showMsg('Undo'); }
});
document.getElementById('reset').addEventListener('click', ()=> { placedShips=[]; occupied.clear(); renderPlaced(); showMsg('Reset'); });
document.getElementById('btnCancel').addEventListener('click', ()=> { localStorage.removeItem('lobbyCode'); location.href='index.html' });

function showMsg(t){ placeMsg.textContent = t; setTimeout(()=> placeMsg.textContent = '', 2500); }

// Save ships -> write to lobby boards under host/guest and wait for opponent
document.getElementById('saveShips').addEventListener('click', async ()=>{
  if(placedShips.length === 0) return showMsg('Plaats eerst minstens 1 schip');
  // flatten
  const flat = [].concat(...placedShips);
  const playersSnap = await dbGet(dbRef(db, `lobbies/${lobbyCode}/players`));
  const players = playersSnap.val();
  let role = null;
  if(players.host === player) role = 'host';
  else if(players.guest === player) role = 'guest';
  if(!role) return alert('Je bent niet meer in de lobby');
  await dbSet(dbRef(db, `lobbies/${lobbyCode}/boards/${role}`), { cells: flat });
  showMsg('Opgeslagen. Wachten op tegenstander...');
  // listen for both boards
  dbOnValue(dbRef(db, `lobbies/${lobbyCode}/boards`), (snap)=>{
    const val = snap.val() || {};
    if(val.host && val.guest){
      dbSet(dbRef(db, `lobbies/${lobbyCode}/status`), 'started');
      localStorage.setItem('lobbyCode', lobbyCode);
      // redirect to unified game page with data-mode and size encoded in lobby
      setTimeout(()=> location.href = 'game.html', 800);
    }
  });
});

init();
