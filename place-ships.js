// place-ships.js
import { db, dbRef, dbGet, dbSet, dbOnValue } from './firebase.js';

const player = localStorage.getItem('player');
const code = localStorage.getItem('lobbyCode');
if(!player || !code) { alert('Geen speler of lobby.'); location.href='index.html'; }

document.getElementById('me').textContent = player;
document.getElementById('lobbyId').textContent = code;

const size = 15;
const boardContainer = document.getElementById('boardContainer');
const boardGrid = document.createElement('div');
boardGrid.className = 'board';
boardGrid.style.gridTemplateColumns = `repeat(${size}, 30px)`;
boardContainer.appendChild(boardGrid);

let placedShips = [];
let occupied = new Set();

for(let i=0;i<size*size;i++){
  const c = document.createElement('div');
  c.className = 'cell';
  c.dataset.i = i;
  c.addEventListener('click', ()=> cellClick(i));
  c.addEventListener('contextmenu', (e)=> { e.preventDefault(); removeCell(i); });
  boardGrid.appendChild(c);
}

function idxToRC(i){ return { r: Math.floor(i/size), c: i%size }; }
function rcToIdx(r,c){ return r*size + c; }

function cellClick(i){
  const orient = document.getElementById('orient').value;
  const shipLen = parseInt(document.getElementById('sizeSelect').value,10);
  const rc = idxToRC(i);
  const coords = [];
  for(let k=0;k<shipLen;k++){
    const r = orient==='h' ? rc.r : rc.r + k;
    const c = orient==='h' ? rc.c + k : rc.c;
    if(r<0||r>=size||c<0||c>=size){ showPlaceMsg('Past niet op bord'); return; }
    coords.push(rcToIdx(r,c));
  }
  for(const pos of coords) if(occupied.has(pos)){ showPlaceMsg('Botsing met bestaand schip'); return; }
  placedShips.push(coords);
  coords.forEach(x=> occupied.add(x));
  renderBoard();
  showPlaceMsg('Schip geplaatst (grootte '+shipLen+')');
}

function removeCell(i){
  // verwijder schip als i in een schip zit
  for(let si=0; si<placedShips.length; si++){
    const ship = placedShips[si];
    if(ship.includes(i)){
      ship.forEach(x=> occupied.delete(x));
      placedShips.splice(si,1);
      renderBoard();
      showPlaceMsg('Schip verwijderd');
      return;
    }
  }
  showPlaceMsg('Geen schip op dit vak.');
}

function renderBoard(){
  document.querySelectorAll('#boardContainer .cell').forEach(n=>{
    n.classList.remove('own');
    n.textContent = '';
  });
  placedShips.forEach((ship,si)=>{
    ship.forEach(idx=>{
      const el = document.querySelector(`.cell[data-i='${idx}']`);
      el.classList.add('own');
      el.textContent = (si+1);
    });
  });
}

document.getElementById('undo').addEventListener('click', ()=>{
  const last = placedShips.pop();
  if(last){ last.forEach(x=> occupied.delete(x)); renderBoard(); showPlaceMsg('Laatste verwijderd'); }
});
document.getElementById('reset').addEventListener('click', ()=> { placedShips=[]; occupied.clear(); renderBoard(); showPlaceMsg('Bord gereset'); });

function showPlaceMsg(t){ placeStatus.textContent = t; setTimeout(()=> placeStatus.textContent = '', 3000); }

document.getElementById('save').addEventListener('click', async ()=>{
  if(placedShips.length === 0) return showPlaceMsg('Plaats eerst minstens 1 schip!');
  const flat = [].concat(...placedShips);
  const playersSnap = await dbGet(dbRef(db, 'lobbies/' + code + '/players'));
  const players = playersSnap.val();
  let role = null;
  if(players.host === player) role = 'host';
  else if(players.guest === player) role = 'guest';
  if(!role) return alert('Je staat niet meer in de lobby. Log opnieuw in.');
  await dbSet(dbRef(db, `lobbies/${code}/boards/${role}`), { cells: flat });
  showPlaceMsg('Opgeslagen. Wachten op tegenstander...');
  dbOnValue(dbRef(db, 'lobbies/' + code + '/boards'), (snap)=>{
    const val = snap.val() || {};
    if(val.host && val.guest){
      dbSet(dbRef(db, 'lobbies/' + code + '/status'), 'started');
      // redirect naar juiste pagina (mode)
      dbGet(dbRef(db, 'lobbies/' + code + '/mode')).then(msnap=>{
        const mode = msnap.val() || 'classic';
        if(mode === 'classic') location.href = 'game-classic.html';
        else if(mode === 'streak') location.href = 'game-streak.html';
        else location.href = 'game-power.html';
      });
    }
  });
});
