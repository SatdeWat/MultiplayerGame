// lobby.js — regelt plaatsing schepen, ready en auto-start zodra beide spelers klaar zijn
import { db } from "./firebase-config.js"; // db
import { loadLocalProfile, ensureUserProfileOnDb } from "./app-auth.js"; // auth helpers
import { ref, get, set, onValue, update } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js"; // db functies

const $ = id => document.getElementById(id); // helper
const alpha = n => String.fromCharCode(65 + n); // 0->A
const cellName = (r,c) => `${alpha(r)}${c+1}`; // A1

function shortPopup(msg){ const el = document.getElementById('short-popup'); if (!el) return; el.textContent = msg; el.style.display = 'block'; setTimeout(()=> el.style.display='none', 3000); } // 3s popup

document.addEventListener('DOMContentLoaded', async ()=>{ // start
  const profile = loadLocalProfile(); if (!profile) { location.href='index.html'; return; } // redirect als niet ingelogd
  await ensureUserProfileOnDb(profile.uid, profile).catch(()=>{}); // ensure profiel in DB

  const qs = new URLSearchParams(location.search); const code = qs.get('code') || qs.get('lobby'); if (!code){ shortPopup('Geen lobby code'); return; } // require code
  $('lobby-code-display').textContent = code; // toon code

  const lobbyRef = ref(db, `lobbies/${code}`); // referentie lobby
  const lobbySnap = await get(lobbyRef); if (!lobbySnap.exists()){ shortPopup('Lobby niet gevonden'); return; } // check lobby
  const gameId = lobbySnap.val().gameId; // gameId

  // DOM
  const boardMe = $('board-me'), boardOp = $('board-op'), shipListEl = $('ship-list'), logEl = $('log');
  const btnRandom = $('btn-random-place'), btnRotate = $('btn-rotate'), btnReady = $('btn-ready'), btnStart = $('start-game-btn');

  // local state
  let size = lobbySnap.val().size || 15; // size from lobby
  let gamemode = lobbySnap.val().gamemode || 'classic'; // mode
  let shipSizes = size === 10 ? [5,4,3] : size === 15 ? [5,4,3,2] : [5,4,4,3,3,2]; // ships per size
  let myBoard = {}; let myShips = []; let orientation = 'H'; let currentShipIndex = 0;

  // build grid
  function createGrid(el,n){ el.innerHTML = ''; el.classList.remove('cell-10','cell-15','cell-20'); el.classList.add(`cell-${n}`); el.style.gridTemplateRows = `repeat(${n},1fr)`; for(let r=0;r<n;r++) for(let c=0;c<n;c++){ const tile = document.createElement('div'); tile.className='tile sea'; tile.dataset.cell = cellName(r,c); el.appendChild(tile); } }
  createGrid(boardMe,size); createGrid(boardOp,size); // create both

  // init myBoard
  for(let r=0;r<size;r++) for(let c=0;c<size;c++) myBoard[cellName(r,c)] = 'empty'; // empty

  // render boards
  function renderBoards(){
    // my board
    Array.from(boardMe.children).forEach(tile => {
      const id = tile.dataset.cell; tile.className = 'tile sea'; tile.innerHTML = '';
      const st = myBoard[id] || 'empty';
      if (st === 'ship') tile.classList.add('ship');
      if (st === 'hit'){ tile.classList.add('hit'); tile.innerHTML = '🔥'; }
      if (st === 'miss'){ tile.classList.add('miss'); tile.innerHTML = '🌊'; }
      if (st === 'sunk'){ tile.classList.add('sunk'); tile.innerHTML = '☠️'; }
    });
    // opponent board placeholder (we only show hits/misses later)
    Array.from(boardOp.children).forEach(tile => { const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML=''; });
  }

  renderBoards(); // initial render

  // ship list render
  function renderShipList(){
    shipListEl.innerHTML = ''; shipSizes.forEach((s,i)=>{ const pill = document.createElement('div'); pill.className='ship-pill' + (i===currentShipIndex ? ' active' : ''); pill.textContent = `Ship ${i+1} — ${s>0?s:'placed'}`; pill.onclick = ()=>{ if (s>0) currentShipIndex = i; renderShipList(); }; shipListEl.appendChild(pill); });
  }
  renderShipList();

  // helpers to check & place
  function canPlace(r,c,s,orient){
    const coords = []; for(let i=0;i<s;i++){ const rr = r + (orient==='V'?i:0), cc = c + (orient==='H'?i:0); if(rr<0||rr>=size||cc<0||cc>=size) return null; coords.push(cellName(rr,cc)); }
    for(const k of coords) if (myBoard[k] === 'ship') return null; return coords;
  }
  function placeAt(cellId){
    const r = cellId.charCodeAt(0)-65, c = parseInt(cellId.slice(1),10)-1; const s = shipSizes[currentShipIndex]; if(!s||s<=0){ shortPopup('Geen schip geselecteerd'); return; }
    const coords = canPlace(r,c,s,orientation); if(!coords){ shortPopup('Kan hier niet plaatsen'); return; } coords.forEach(k=> myBoard[k] = 'ship'); myShips.push({ id:'s_'+Date.now(), cells:coords, size:s }); shipSizes[currentShipIndex]=0; while(currentShipIndex<shipSizes.length && shipSizes[currentShipIndex]===0) currentShipIndex++; renderShipList(); renderBoards();
  }

  // random placement
  function randomPlaceAll(){
    for(const k in myBoard) myBoard[k] = 'empty'; myShips = []; const sizes = shipSizes.slice();
    for(let i=0;i<sizes.length;i++){ const s = sizes[i]; let placed=false, tries=0; while(!placed && tries<5000){ const r=Math.floor(Math.random()*size), c=Math.floor(Math.random()*size), o=Math.random()<0.5?'H':'V'; const coords = canPlace(r,c,s,o); if(coords){ coords.forEach(k=> myBoard[k]='ship'); myShips.push({id:'rs_'+Date.now()+'_'+i,cells:coords,size:s}); placed=true; } tries++; } }
    shipSizes = shipSizes.map(_=>0); renderShipList(); renderBoards();
  }

  // UI hooks
  boardMe.addEventListener('click', e => { const t = e.target.closest('.tile'); if(!t) return; placeAt(t.dataset.cell); }); // klik om te plaatsen
  btnRandom && (btnRandom.onclick = ()=> { randomPlaceAll(); shortPopup('Random geplaatst'); }); // random knop
  btnRotate && (btnRotate.onclick = ()=> { orientation = orientation==='H'?'V':'H'; btnRotate.textContent = `Rotate (${orientation})`; }); // rotate knop

  // ready: schrijf board + ships naar DB en zet ready=true
  $('btn-ready').addEventListener('click', async ()=> {
    const remaining = shipSizes.filter(x=>x>0); if (remaining.length){ shortPopup('Plaats alle schepen of gebruik Random'); return; } // check
    await set(ref(db, `games/${gameId}/players/${profile.uid}/board`), myBoard); // schrijf board
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ships`), myShips); // schrijf ships
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ready`), true); // klaar
    $('ready-badge-me').textContent = '✔️ Klaar'; // visueel
    btnRandom && (btnRandom.style.display='none'); btnRotate && (btnRotate.style.display='none'); $('btn-ready').style.display='none'; // verberg controls
    shortPopup('Je bent klaar, wacht op tegenstander'); // popup
  });

  // luister naar players node om spelerslijst en status te updaten en auto-starten
  onValue(ref(db, `games/${gameId}`), async snap => {
    const g = snap.exists()? snap.val() : null; if(!g) return;
    const players = g.players || {}; // alle spelers
    const playersEl = $('lobby-players'); playersEl.innerHTML = ''; // leeg
    for(const pid in players){ const p = players[pid]; const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.padding='6px 0'; row.innerHTML = `<div>${p.username}${pid===profile.uid?' (Jij)':''}</div><div>${p.ready? '✔️':'—'}</div>`; playersEl.appendChild(row); }
    // auto-start: als minimaal 2 spelers en alle players ready=true en hebben board+ships nodes -> start spel
    const pids = Object.keys(players);
    if (pids.length >= 2){
      let allOk = true;
      for (const pid of pids){
        const pp = players[pid];
        if (!pp.ready){ allOk = false; break; } // niet klaar
        const bSnap = await get(ref(db, `games/${gameId}/players/${pid}/board`)); const sSnap = await get(ref(db, `games/${gameId}/players/${pid}/ships`));
        if (!bSnap.exists() || !sSnap.exists()){ allOk = false; break; } // board/ships nog niet opgeslagen
      }
      if (allOk && g.status !== 'in_progress'){
        const starter = pids[Math.floor(Math.random()*pids.length)]; // kies starter
        await set(ref(db, `games/${gameId}/status`), 'in_progress'); // set status
        await set(ref(db, `games/${gameId}/turnUid`), starter); // set beurt
        shortPopup('Spel gestart!'); // kort popup
      }
    }
    // redirect to game page when status in_progress
    if (g.status === 'in_progress'){ const page = g.gamemode === 'power' ? 'game_power.html' : g.gamemode === 'streak' ? 'game_streak.html' : 'game_classic.html'; location.href = `${page}?lobby=${code}`; }
  });

  // force start button - alleen host
  $('start-game-btn').addEventListener('click', async ()=> {
    const l = await get(ref(db, `lobbies/${code}`)); if (!l.exists()) return; if (l.val().owner !== profile.uid) return shortPopup('Alleen host kan forceren'); // alleen host
    await set(ref(db, `games/${gameId}/status`), 'in_progress'); const playersSnap = await get(ref(db, `games/${gameId}/players`)); const pids = Object.keys(playersSnap.val()||{}); if (pids.length) await set(ref(db, `games/${gameId}/turnUid`), pids[ Math.floor(Math.random()*pids.length) ]); shortPopup('Host heeft gestart');
  });

  // leave lobby
  $('btn-leave-lobby').addEventListener('click', async ()=> { await set(ref(db, `games/${gameId}/players/${profile.uid}`), null); shortPopup('Je hebt de lobby verlaten'); setTimeout(()=> location.href='home.html',600); });
});
