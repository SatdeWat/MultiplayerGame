// game.js
// Complete, werkende lobby + multiplayer client logic voor Zeeslag.
// Vervang ALLES in je huidige game.js met deze code.
// Verwacht: ./firebase-config.js export const db
//           ./app-auth.js exports loadLocalProfile, ensureUserProfileOnDb, incrementGameResults
// Firebase v9 modular imports:
import { db } from "./firebase-config.js";
import { loadLocalProfile, ensureUserProfileOnDb, incrementGameResults } from "./app-auth.js";
import { ref, get, set, onValue, onChildAdded, push, runTransaction, update } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* ---------- Utilities ---------- */
const $ = id => document.getElementById(id);
const alpha = n => String.fromCharCode(65 + n);
const cellName = (r,c) => `${alpha(r)}${c+1}`;
const makeCode = (len=6) => { const chars="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s=""; for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s; };
const pageForMode = gm => gm === 'power' ? 'game_power.html' : gm === 'streak' ? 'game_streak.html' : gm === 'salvo' ? 'game_salvo.html' : 'game_classic.html';

function showToast(msg, t=1800){
  let el = document.getElementById('app-toast');
  if (!el){
    el = document.createElement('div'); el.id='app-toast'; el.className='card';
    el.style.position='fixed'; el.style.right='18px'; el.style.bottom='18px'; el.style.zIndex=99999;
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.display='block';
  setTimeout(()=> el.style.display='none', t);
}
function showOverlay(html){
  let o = document.querySelector('.overlay');
  if (!o){
    o = document.createElement('div'); o.className='overlay';
    o.innerHTML = `<div class="overlay-inner"><div id="overlay-inner-content">${html}</div><div style="margin-top:12px"><button id="overlay-ok">OK</button></div></div>`;
    document.body.appendChild(o);
    document.getElementById('overlay-ok').addEventListener('click', ()=> o.classList.add('hidden'));
  } else {
    o.classList.remove('hidden'); document.getElementById('overlay-inner-content').innerHTML = html;
  }
}

/* simple debounce for rendering */
function debounce(fn, wait=80){
  let t=null;
  return (...args)=>{ if(t) clearTimeout(t); t=setTimeout(()=> { t=null; fn(...args); }, wait); };
}

/* ---------- Lobby: place ships + ready ---------- */
/* This code expects your lobby.html to contain:
   - element ids: lobby-code-display, btn-copy-lobby, lobby-players, btn-leave-lobby
   - placement UI: board-me (class board), btn-random-place, btn-rotate (optional), btn-ready
   If your page uses different ids, adapt them or tell me and I'll adjust.
*/

async function initLobbyBehavior(){
  // run only on lobby.html
  const path = location.pathname.split('/').pop();
  if (path !== 'lobby.html') return;

  const qs = new URLSearchParams(location.search);
  const code = qs.get('code') || qs.get('lobby');
  if (!code){ showOverlay('Geen lobby-code opgegeven.'); return; }

  const profile = loadLocalProfile();
  if (!profile){ showOverlay('Je moet ingelogd zijn of als gast spelen.'); return; }
  await ensureUserProfileOnDb(profile.uid, profile).catch(()=>{});

  const lobbyRef = ref(db, `lobbies/${code}`);
  const codeDisplay = $('lobby-code-display'); if (codeDisplay) codeDisplay.textContent = code;
  const copyBtn = $('btn-copy-lobby'); if (copyBtn) copyBtn.onclick = ()=> navigator.clipboard?.writeText(code).then(()=> showToast('Lobby code gekopieerd'));
  const leaveBtn = $('btn-leave-lobby'); if (leaveBtn) leaveBtn.onclick = async ()=>{
    // remove from players list & maybe cleanup
    const lobbySnap = await get(lobbyRef); if (!lobbySnap.exists()){ location.href='home.html'; return; }
    const gameId = lobbySnap.val().gameId; if (gameId) await set(ref(db, `games/${gameId}/players/${profile.uid}`), null);
    location.href='home.html';
  };

  // Placement UI elements (optional - graceful fallback)
  const boardMe = $('board-me');
  const btnRandomPlace = $('btn-random-place');
  const btnRotate = $('btn-rotate');
  const btnReady = $('btn-ready');
  const shipsListEl = $('ship-list');
  const readyBadgeMe = $('ready-badge-me');
  const readyBadgeOp = $('ready-badge-op');

  // State for placing locally (before save)
  let gameId = null;
  let size = 15;
  let shipSizes = [5,4,3,2]; // default for 15x15
  let orientation = 'H';
  let myBoardLocal = {};
  let myShipsLocal = []; // {id,cells,size}
  let currentShipIndex = 0;

  const renderBoards = debounce(()=>{
    if (!boardMe) return;
    Array.from(boardMe.children).forEach(tile=>{
      const id = tile.dataset.cell;
      tile.className = 'tile sea';
      tile.innerHTML = '';
      const st = myBoardLocal[id] || 'empty';
      if (st === 'ship') { tile.classList.add('ship'); }
      if (st === 'hit'){ tile.classList.add('hit'); tile.innerHTML='🔥'; }
      if (st === 'miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if (st === 'sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; }
    });
  }, 40);

  function createGrid(el,n){
    if (!el) return;
    el.innerHTML = ''; el.classList.remove('cell-10','cell-15','cell-20');
    el.classList.add(`cell-${n}`);
    el.style.gridTemplateRows = `repeat(${n},1fr)`;
    for (let r=0;r<n;r++) for (let c=0;c<n;c++){
      const cell = document.createElement('div'); cell.className='tile sea'; cell.dataset.r=r; cell.dataset.c=c; cell.dataset.cell = cellName(r,c);
      el.appendChild(cell);
    }
  }

  // set sizes based on lobby.game.size (mapping handled later)
  function setShipSizesForBoard(n){
    size = n;
    createGrid(boardMe, size);
    myBoardLocal = {};
    myShipsLocal = [];
    currentShipIndex = 0;
    orientation = 'H';
    if (size === 10) shipSizes = [5,4,3];
    else if (size === 15) shipSizes = [5,4,3,2];
    else if (size === 20) shipSizes = [5,4,4,3,3,2];
    else shipSizes = [5,4,3,2];
    // fill board cells
    for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoardLocal[cellName(r,c)]='empty';
    renderShipList();
    renderBoards();
  }

  function renderShipList(){
    if (!shipsListEl) return;
    shipsListEl.innerHTML = '';
    shipSizes.forEach((s,i)=>{
      const pill = document.createElement('div'); pill.className='ship-pill' + (i===currentShipIndex ? ' active' : ''); pill.textContent = `Ship ${i+1} — ${s>0?s:'placed'}`;
      pill.onclick = ()=> { if (s>0) { currentShipIndex = i; renderShipList(); } };
      shipsListEl.appendChild(pill);
    });
  }

  function canPlaceLocal(r,c,s,orient){
    const coords=[];
    for (let i=0;i<s;i++){
      const rr = r + (orient === 'V' ? i : 0);
      const cc = c + (orient === 'H' ? i : 0);
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) return null;
      coords.push(cellName(rr,cc));
    }
    for (const k of coords) if (myBoardLocal[k] === 'ship') return null;
    return coords;
  }

  function placeShipLocalAtCell(cellId){
    const r = cellId.charCodeAt(0) - 65, c = parseInt(cellId.slice(1),10)-1;
    const s = shipSizes[currentShipIndex];
    if (!s || s <= 0) { showToast('Geen schip geselecteerd'); return; }
    const coords = canPlaceLocal(r,c,s,orientation);
    if (!coords){ showToast('Kan hier niet plaatsen'); return; }
    coords.forEach(k => myBoardLocal[k] = 'ship');
    myShipsLocal.push({ id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), cells: coords.slice(), size: s });
    shipSizes[currentShipIndex] = 0;
    while (currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++;
    renderShipList(); renderBoards();
  }

  function randomPlaceLocalAll(){
    // simple random placement tries
    for (const k in myBoardLocal) myBoardLocal[k] = 'empty';
    myShipsLocal = [];
    const sizes = shipSizes.slice();
    for (let i=0;i<sizes.length;i++){
      const s = sizes[i];
      let placed=false, tries=0;
      while(!placed && tries < 5000){
        const r = Math.floor(Math.random()*size), c = Math.floor(Math.random()*size);
        const o = Math.random() < 0.5 ? 'H' : 'V';
        const coords = canPlaceLocal(r,c,s,o);
        if (coords){ coords.forEach(k => myBoardLocal[k] = 'ship'); myShipsLocal.push({id:'rs_'+Date.now()+'_'+i, cells:coords.slice(), size:s}); placed=true; }
        tries++;
      }
    }
    shipSizes = shipSizes.map(_=>0);
    renderShipList(); renderBoards();
  }

  // If UI buttons exist wire up
  if (btnRandomPlace) btnRandomPlace.onclick = ()=> { randomPlaceLocalAll(); showToast('Random geplaatst'); };
  if (btnRotate) btnRotate.onclick = ()=> { orientation = orientation === 'H' ? 'V' : 'H'; if (btnRotate) btnRotate.textContent = `Rotate (${orientation})`; };

  // clicking on own board to place ships
  if (boardMe) boardMe.addEventListener('click', e => {
    const t = e.target.closest('.tile'); if (!t) return;
    placeShipLocalAtCell(t.dataset.cell);
  });

  // Ready button -> write board & ships to DB and set players/{uid}/ready=true
  if (btnReady) btnReady.addEventListener('click', async () => {
    if (!gameId) {
      const l = await get(lobbyRef);
      if (!l.exists()){ showOverlay('Lobby niet gevonden'); return; }
      gameId = l.val().gameId;
    }
    // ensure all ships placed
    const remaining = shipSizes.filter(x => x>0);
    if (remaining.length) { showToast('Plaats al je schepen of gebruik Random'); return; }
    // Write board and ships to DB
    await set(ref(db, `games/${gameId}/players/${profile.uid}/board`), myBoardLocal);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ships`), myShipsLocal);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ready`), true);
    showToast('Je bord is opgeslagen en je bent klaar ✅');
    readyBadgeMe && (readyBadgeMe.textContent = '✔️ Klaar');

    // check if both players ready -> start game by setting status & turnUid
    const gSnap = await get(ref(db, `games/${gameId}`));
    if (!gSnap.exists()) return;
    const g = gSnap.val();
    const players = g.players || {};
    const ids = Object.keys(players);
    if (ids.length >= 2){
      // re-read players nodes to get their ready flags and boards
      let allReady = true;
      for (const id of ids){
        const p = players[id] || {};
        if (!p.ready) { allReady = false; break; }
        // also ensure boards exist for both
        const boardSnap = await get(ref(db, `games/${gameId}/players/${id}/board`));
        const shipsSnap = await get(ref(db, `games/${gameId}/players/${id}/ships`));
        if (!boardSnap.exists() || !shipsSnap.exists()){ allReady = false; break; }
      }
      if (allReady){
        // choose random starter
        const starter = ids[Math.floor(Math.random()*ids.length)];
        await set(ref(db, `games/${gameId}/status`), 'in_progress');
        await set(ref(db, `games/${gameId}/turnUid`), starter);
        showToast('Allemaal klaar — spel gestart!');
        // If mode is 'salvo' set initial shotsLeft = # ships per player
        const mode = g.gamemode || 'classic';
        if (mode === 'salvo'){
          for (const pid of ids){
            const shipSnap = await get(ref(db, `games/${gameId}/players/${pid}/ships`));
            const ships = shipSnap.exists() ? shipSnap.val() : [];
            await set(ref(db, `games/${gameId}/salvo/${pid}/shotsLeft`), (ships && ships.length) ? ships.length : 4);
          }
        }
      } else {
        showToast('Wacht op tegenstander...');
      }
    } else showToast('Wacht op tegenstander...');
  });

  // Listen for lobby/game updates to show players & ready state and to redirect when in_progress
  onValue(lobbyRef, async snap => {
    const l = snap.exists() ? snap.val() : null;
    if (!l){ showOverlay('Lobby verwijderd'); return; }
    gameId = l.gameId;
    // watch game players
    const gameRef = ref(db, `games/${gameId}`);
    onValue(gameRef, gsnap => {
      const g = gsnap.exists() ? gsnap.val() : null;
      if (!g) return;
      const players = g.players || {};
      // render players in lobby-players
      const playersEl = $('lobby-players');
      if (playersEl){
        playersEl.innerHTML = '';
        for (const pid in players){
          const p = players[pid];
          const name = p.username || pid;
          const ready = p.ready ? '✔️' : '';
          const line = document.createElement('div'); line.className='row'; line.style.justifyContent = 'space-between';
          const left = document.createElement('div'); left.textContent = name + (pid === profile.uid ? ' (Jij)' : '');
          const right = document.createElement('div'); right.textContent = ready;
          line.appendChild(left); line.appendChild(right);
          playersEl.appendChild(line);
        }
      }
      // redirect when status in_progress => to correct game page
      if (g.status === 'in_progress' || g.status === 'finished'){
        const page = pageForMode(g.gamemode || l.gamemode || 'classic');
        location.href = `${page}?lobby=${code}`;
      }
    });
  });
}

/* ---------- Game page: process moves & render ---------- */
async function initGamePageBehavior(){
  const path = location.pathname.split('/').pop();
  const gamePages = ['game_classic.html','game_power.html','game_streak.html','game_salvo.html','game.html'];
  if (!gamePages.includes(path)) return;

  const qs = new URLSearchParams(location.search);
  const code = qs.get('lobby') || qs.get('code');
  if (!code){ showOverlay('Geen lobby-code gevonden in URL'); return; }
  const profile = loadLocalProfile();
  if (!profile){ showOverlay('Je moet ingelogd zijn of als gast spelen.'); return; }
  await ensureUserProfileOnDb(profile.uid, profile).catch(()=>{});

  // get gameId from lobby
  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if (!lobbySnap.exists()){ showOverlay('Lobby niet gevonden'); return; }
  const lobby = lobbySnap.val();
  const gameId = lobby.gameId;
  if (!gameId){ showOverlay('Geen game gekoppeld aan deze lobby'); return; }

  // DOM
  const boardMeEl = $('board-me'), boardOpEl = $('board-op'), logEl = $('log');
  const btnRandom = $('btn-random') || null, btnRotate = $('btn-rotate') || null, btnReady = $('btn-ready') || null;
  const infoTurn = $('info-turn'), infoPower = $('info-power'), shipListEl = $('ship-list');
  const readyBadgeMe = $('ready-badge-me'), readyBadgeOp = $('ready-badge-op');

  // Local state mirrors (authoritative state in DB)
  let size = lobby.size || 15;
  let myBoard = {};     // values: 'empty'|'ship'|'hit'|'miss'|'sunk'
  let oppBoard = {};    // only public values from opponent: 'hit'|'miss'|'sunk'
  let myShips = [];     // stored ships for our board
  let oppShips = [];    // not stored locally unless we read them
  let mode = lobby.gamemode || 'classic';
  let mySlotIndex = 0;
  let currentTurnUid = null;

  // render
  const renderBoards = debounce(()=>{
    if (boardMeEl) Array.from(boardMeEl.children).forEach(tile => {
      const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML='';
      const st = myBoard[id] || 'empty';
      if (st === 'ship') tile.classList.add('ship');
      if (st === 'hit'){ tile.classList.add('hit'); tile.innerHTML='🔥'; }
      if (st === 'miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if (st === 'sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; }
    });
    if (boardOpEl) Array.from(boardOpEl.children).forEach(tile => {
      const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML='';
      const st = oppBoard[id] || null;
      if (st === 'hit'){ tile.classList.add('hit'); tile.innerHTML='🔥'; }
      if (st === 'miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if (st === 'sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; }
    });
  }, 40);

  function log(msg){ if (!logEl) return; const d = document.createElement('div'); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }

  function createGrid(el,n){
    if (!el) return;
    el.innerHTML=''; el.classList.remove('cell-10','cell-15','cell-20');
    el.classList.add(`cell-${n}`); el.style.gridTemplateRows = `repeat(${n},1fr)`;
    for (let r=0;r<n;r++) for (let c=0;c<n;c++){
      const tile = document.createElement('div'); tile.className='tile sea'; tile.dataset.r=r; tile.dataset.c=c; tile.dataset.cell = cellName(r,c);
      el.appendChild(tile);
    }
  }

  // initialize local boards based on DB data
  async function refreshAuthoritative(){
    const gSnap = await get(ref(db, `games/${gameId}`));
    if (!gSnap.exists()) return;
    const g = gSnap.val();
    mode = g.gamemode || mode;
    const players = g.players || {};
    // determine opponent id
    let oppId = null;
    for (const pid in players) if (pid !== profile.uid) oppId = pid;
    // load my board & ships
    const mySnap = await get(ref(db, `games/${gameId}/players/${profile.uid}`));
    if (mySnap.exists()){
      const me = mySnap.val();
      myBoard = me.board || myBoard;
      myShips = me.ships || myShips;
    }
    // load opponent board partial
    if (oppId){
      const oppSnap = await get(ref(db, `games/${gameId}/players/${oppId}`));
      if (oppSnap.exists()){
        oppBoard = oppSnap.val().board || oppBoard;
        oppShips = oppSnap.val().ships || oppShips;
      }
    }
    renderBoards();
  }

  // create grids
  createGrid(boardMeEl, size);
  createGrid(boardOpEl, size);

  // helper: push a move and resolve cell via transaction on opponent board
  async function makeMove(cell){
    // safety: ensure game is in progress and it's our turn
    const gSnap = await get(ref(db, `games/${gameId}`));
    if (!gSnap.exists()) return showToast('Kon game data niet laden');
    const g = gSnap.val();
    if (g.status !== 'in_progress') return showToast('Spel is niet actief');
    if (g.turnUid !== profile.uid) return showToast('Niet jouw beurt');
    // find opponent id
    const players = g.players || {};
    let targetId = null; for (const pid in players) if (pid !== profile.uid) targetId = pid;
    if (!targetId) return showToast('Geen tegenstander');

    // push a move node (optimistic)
    const mvRef = push(ref(db, `games/${gameId}/moves`));
    await set(mvRef, { by: profile.uid, cell, ts: Date.now(), status: 'processing' });

    // transaction on target's board cell to mark hit/miss only if not already shot
    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, cur => {
      if (!cur || cur === 'empty') return 'miss';
      if (cur === 'ship') return 'hit';
      return; // already shot -> abort return undefined
    });

    const finalSnap = await get(cellRef);
    const finalVal = finalSnap.exists() ? finalSnap.val() : null;
    await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), finalVal);

    log(`Je schiet op ${cell} => ${finalVal}`);

    // if hit: check sunk
    if (finalVal === 'hit'){
      // read target ships once
      const shipsSnap = await get(ref(db, `games/${gameId}/players/${targetId}/ships`));
      const tShips = shipsSnap.exists() ? shipsSnap.val() : [];
      const hitShip = (tShips||[]).find(s => (s.cells || []).includes(cell));
      if (hitShip){
        // check all cells of ship are now hit or already sunk in DB
        let allHit = true;
        for (const c of hitShip.cells){
          const stSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board/${c}`));
          const st = stSnap.exists() ? stSnap.val() : 'empty';
          if (st !== 'hit' && st !== 'sunk'){ allHit = false; break; }
        }
        if (allHit){
          // mark all ship cells to 'sunk' (single update)
          const updates = {};
          for (const c of hitShip.cells){
            updates[`games/${gameId}/players/${targetId}/board/${c}`] = 'sunk';
            // optionally reveal to attacker in a revealed path
            updates[`games/${gameId}/players/${profile.uid}/revealed/${c}`] = 'sunk';
          }
          await update(ref(db, `/`), updates);
          await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), 'sunk');
          log('Ship gezonken!');
          // power reward for power mode
          if (g.gamemode === 'power' || mode === 'power'){
            await runTransaction(ref(db, `games/${gameId}/players/${profile.uid}/power`), cur => (cur||0) + 1);
          }
        }
      }
    }

    // Turn switching logic
    if (g.gamemode === 'salvo' || mode === 'salvo'){
      // decrement shotsLeft for this player; if >0 keep, else switch & set shotsLeft for opponent
      const shotsRef = ref(db, `games/${gameId}/salvo/${profile.uid}/shotsLeft`);
      await runTransaction(shotsRef, cur => Math.max((cur||1) - 1, 0));
      const after = await get(shotsRef); const left = after.exists() ? after.val() : 0;
      if (left > 0){
        // keep turn (set turnUid to ourselves)
        await set(ref(db, `games/${gameId}/turnUid`), profile.uid);
      } else {
        // compute opponent alive ships
        const alive = await countAliveShipsFor(targetId);
        await set(ref(db, `games/${gameId}/salvo/${targetId}/shotsLeft`), Math.max(alive,1));
        await set(ref(db, `games/${gameId}/turnUid`), targetId);
      }
    } else if (g.gamemode === 'streak' || mode === 'streak'){
      // streak: if hit/sunk keep turn, else switch
      const moveResult = finalVal;
      if (moveResult === 'hit' || moveResult === 'sunk'){
        await set(ref(db, `games/${gameId}/turnUid`), profile.uid);
      } else {
        await set(ref(db, `games/${gameId}/turnUid`), targetId);
      }
    } else {
      // classic & power: always switch after shot (power doesn't change immediate turn behavior)
      const result = finalVal;
      if (result === 'hit' && (g.gamemode === 'classic' || mode === 'classic')) {
        // some versions: classic always switch; user wanted "if you hit you still get another turn" for some modes only, but we keep default: classic -> switch
      }
      // find opponent and set turn
      await set(ref(db, `games/${gameId}/turnUid`), targetId);
    }

    // victory check
    const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
    const tboard = targetBoardSnap.exists() ? targetBoardSnap.val() : {};
    const hasShipLeft = Object.values(tboard).some(v => v === 'ship');
    if (!hasShipLeft){
      // target has no ship left => we win
      await set(ref(db, `games/${gameId}/status`), 'finished');
      await set(ref(db, `games/${gameId}/winner`), profile.uid);
      log('Je hebt gewonnen!');
      // increment stats via helper
      try{ await incrementGameResults(profile.uid, [targetId]); }catch(e){ console.warn('stats update failed', e); }
    }

    // authoritative refresh soon
    setTimeout(()=> refreshAuthoritative(), 220);
  }

  // helper: count alive ships for a uid
  async function countAliveShipsFor(uid){
    const shipsSnap = await get(ref(db, `games/${gameId}/players/${uid}/ships`));
    const boardSnap = await get(ref(db, `games/${gameId}/players/${uid}/board`));
    const ships = shipsSnap.exists() ? shipsSnap.val() : [];
    const board = boardSnap.exists() ? boardSnap.val() : {};
    let alive = 0;
    for (const sh of (ships || [])){
      let sunk = true;
      for (const c of (sh.cells || [])){
        const st = board[c] || 'empty';
        if (st !== 'sunk'){ sunk = false; break; }
      }
      if (!sunk) alive++;
    }
    return alive;
  }

  // Listen to moves (onChildAdded) to animate immediate results
  onChildAdded(ref(db, `games/${gameId}/moves`), async snap => {
    const mv = snap.val();
    if (!mv) return;
    // if this move is by me -> it will update oppBoard; else update myBoard
    if (mv.by === profile.uid){
      // attacker: show opponent revealed state for that cell (read authoritative board value)
      const oppId = Object.keys((await get(ref(db, `games/${gameId}/players`))).val() || {}).find(k => k !== profile.uid);
      if (!oppId) return;
      const cellValSnap = await get(ref(db, `games/${gameId}/players/${oppId}/board/${mv.cell}`));
      const val = cellValSnap.exists() ? cellValSnap.val() : mv.result;
      if (val === 'hit' || val === 'sunk') oppBoard[mv.cell] = val;
      else if (val === 'miss') oppBoard[mv.cell] = 'miss';
      else oppBoard[mv.cell] = val;
    } else {
      // opponent shot us
      const cellValSnap = await get(ref(db, `games/${gameId}/players/${profile.uid}/board/${mv.cell}`));
      const val = cellValSnap.exists() ? cellValSnap.val() : mv.result;
      if (val === 'hit' || val === 'sunk') myBoard[mv.cell] = val;
      else if (val === 'miss') myBoard[mv.cell] = 'miss';
      else myBoard[mv.cell] = val;
    }

    // sounds & render
    if (mv.result === 'hit') {/* optional sound */} 
    if (mv.result === 'sunk') {/* optional sound */}
    renderBoards();
  });

  // Listen to entire game node changes for status/turn/players etc.
  onValue(ref(db, `games/${gameId}`), async snap => {
    const g = snap.exists() ? snap.val() : null;
    if (!g) return;
    // turn update
    if (g.turnUid !== undefined){
      currentTurnUid = g.turnUid;
      if (infoTurn) infoTurn.textContent = `Beurt: ${currentTurnUid === profile.uid ? 'Jij' : 'Tegenstander'}`;
    }
    // status
    if (g.status === 'finished'){
      const winner = g.winner;
      const youWon = winner === profile.uid;
      if (youWon){
        showOverlay(`<div style="text-align:center"><h2>Je hebt gewonnen!</h2></div>`);
      } else {
        showOverlay(`<div style="text-align:center"><h2>Je hebt verloren</h2></div>`);
      }
      // update local boards one final time
      await refreshAuthoritative();
    }
    // players ready badges
    const players = g.players || {};
    if (players[profile.uid] && readyBadgeMe) readyBadgeMe.textContent = players[profile.uid].ready ? '✔️ Klaar' : '';
    for (const pid in players){
      if (pid !== profile.uid && readyBadgeOp) readyBadgeOp.textContent = players[pid].ready ? '✔️ Klaar' : '';
    }
  });

  // initial authoritative load
  await refreshAuthoritative();

  // UI interactions on boardOp (attack)
  if (boardOpEl) boardOpEl.addEventListener('click', async e => {
    const t = e.target.closest('.tile'); if (!t) return;
    const cell = t.dataset.cell;
    // check if already shot
    if (oppBoard[cell] === 'hit' || oppBoard[cell] === 'miss' || oppBoard[cell] === 'sunk') { showToast('Al geschoten'); return; }
    await makeMove(cell);
  });
}

/* ---------- Rematch watching + auto-creation ---------- */
// If both players wrote rematchRequests true under games/{gameId}/rematchRequests -> create new game with same players & update lobby.gameId
function watchRematch(gameId, lobbyCode){
  onValue(ref(db, `games/${gameId}/rematchRequests`), async snap => {
    const v = snap.exists() ? snap.val() : {};
    const keys = Object.keys(v);
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    const players = playersSnap.exists() ? playersSnap.val() : {};
    const pCount = Object.keys(players).length;
    if (pCount > 0 && keys.length >= pCount){
      // create new game
      const newGameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
      const newPlayers = {};
      for (const pid in players) newPlayers[pid] = { username: players[pid].username, ready:false, slot: players[pid].slot || 0, power:0 };
      await set(ref(db, `games/${newGameId}`), { players: newPlayers, status: 'waiting', gamemode: (await get(ref(db, `games/${gameId}/gamemode`))).val() || 'classic', size: (await get(ref(db, `games/${gameId}/size`))).val() || 15, createdAt: Date.now(), rematchOf: gameId });
      await set(ref(db, `lobbies/${lobbyCode}/gameId`), newGameId);
      // clear rematch requests
      await set(ref(db, `games/${gameId}/rematchRequests`), null);
      showToast('Rematch aangemaakt');
    }
  });
}

/* ---------- Bootstrapping on DOMContentLoaded ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  // init lobby placement + ready behaviour if on lobby.html
  try{ await initLobbyBehavior(); } catch(e){ console.warn('initLobbyBehavior error', e); }

  // init game page behaviour (moves/turns/rendering)
  try{ await initGamePageBehavior(); } catch(e){ console.warn('initGamePageBehavior error', e); }

  // If you are on a lobby page and there is a gameId, watch rematch
  const qs = new URLSearchParams(location.search);
  const code = qs.get('code') || qs.get('lobby') || qs.get('gamecode');
  if (code) {
    const lSnap = await get(ref(db, `lobbies/${code}`));
    if (lSnap.exists()){
      const gameId = lSnap.val().gameId;
      if (gameId) watchRematch(gameId, code);
    }
  }
});

/* ---------- Exports for other modules (optional) ---------- */
export { makeCode, pageForMode };
