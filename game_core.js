// game_core.js — shared game logic for classic / power / streak
import { db } from "./firebase-config.js";
import { loadLocalProfile, incrementWinsForUid } from "./app-auth.js";
import { ref, get, set, onValue, update, push, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const $ = id => document.getElementById(id);
const alpha = n => String.fromCharCode(65 + n);
const cellName = (r,c) => `${alpha(r)}${c+1}`;

export async function startGame({ mode }) {
  const profile = loadLocalProfile();
  if (!profile) { location.href = "index.html"; return; }

  const qs = new URLSearchParams(location.search);
  const lobbyCode = qs.get('lobby');
  if (!lobbyCode) { $('log') && ($('log').textContent = 'Geen lobby code'); return; }

  // UI references (common)
  const boardMeEl = $('board-me'), boardOpEl = $('board-op'), shipListEl = $('ship-list');
  const btnRandom = $('btn-random'), btnRotate = $('btn-rotate'), btnReady = $('btn-ready');
  const infoTurn = $('info-turn'), infoPower = $('info-power'), btnPower = $('btn-power');
  const readyBadgeMe = $('ready-badge-me'), readyBadgeOp = $('ready-badge-op'), logEl = $('log');

  // state
  let gameId = null;
  let size = 10;
  let myId = profile.uid;
  let myBoard = {}, oppBoard = {};
  let shipSizes = [5,4,3]; // default
  let placedShips = [];
  let currentShipIndex = 0;
  let orientation = 'H';
  let powerCount = 0;

  function log(msg){ if (!logEl) return; const d = document.createElement('div'); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }

  function createGrid(el, n){
    el.innerHTML = '';
    el.classList.remove('cell-5','cell-10','cell-15','cell-20');
    el.classList.add(`cell-${n}`);
    el.style.gridTemplateRows = `repeat(${n},1fr)`;
    for (let r=0;r<n;r++){
      for (let c=0;c<n;c++){
        const tile = document.createElement('div');
        tile.className = 'tile sea';
        tile.dataset.r = r; tile.dataset.c = c; tile.dataset.cell = cellName(r,c);
        el.appendChild(tile);
      }
    }
  }

  function renderBoards(){
    Array.from(boardMeEl.children).forEach(tile=>{
      const id = tile.dataset.cell;
      tile.className = 'tile sea'; tile.innerHTML = '';
      if (myBoard[id] === 'ship') tile.classList.add('ship');
      if (myBoard[id] === 'hit') { tile.classList.add('hit'); tile.innerHTML = '💥'; }
      if (myBoard[id] === 'miss') { tile.classList.add('miss'); tile.innerHTML = '🌊'; }
      if (myBoard[id] === 'sunk') { tile.classList.add('sunk'); tile.innerHTML = '☠️'; }
    });
    Array.from(boardOpEl.children).forEach(tile=>{
      const id = tile.dataset.cell;
      tile.className = 'tile sea'; tile.innerHTML = '';
      if (oppBoard[id] === 'hit') { tile.classList.add('hit'); tile.innerHTML = '🔥'; }
      if (oppBoard[id] === 'miss') { tile.classList.add('miss'); tile.innerHTML = '🌊'; }
      if (oppBoard[id] === 'sunk') { tile.classList.add('sunk'); tile.innerHTML = '☠️'; }
    });
  }

  function renderShipList(){
    if(!shipListEl) return;
    shipListEl.innerHTML = '';
    shipSizes.forEach((s,i)=>{
      const pill = document.createElement('div');
      pill.className = 'ship-pill' + (i===currentShipIndex ? ' active' : '');
      pill.textContent = `Ship ${i+1} — ${s>0?s:'placed'}`;
      pill.onclick = ()=> { if (s>0) { currentShipIndex = i; renderShipList(); } };
      shipListEl.appendChild(pill);
    });
  }

  function setSizesByChoice(s){
    size = s;
    createGrid(boardMeEl, size);
    createGrid(boardOpEl, size);
    const small = (size <= 5);
    if (mode === 'power' && size === 20) shipSizes = [5,4,4,3,3,2];
    else if (small) shipSizes = [3,2,2];
    else shipSizes = [5,4,3];
    placedShips = [];
    currentShipIndex = 0;
    orientation = 'H';
    myBoard = {}; oppBoard = {};
    for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoard[cellName(r,c)] = 'empty';
    renderShipList(); renderBoards();
  }

  function canPlace(r,c,s,orient){
    const coords = [];
    for (let i=0;i<s;i++){
      const rr = r + (orient === 'V' ? i : 0);
      const cc = c + (orient === 'H' ? i : 0);
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) return null;
      coords.push(cellName(rr,cc));
    }
    for (const k of coords) if (myBoard[k] === 'ship') return null;
    return coords;
  }

  function placeShipAt(cellId){
    const r = cellId.charCodeAt(0) - 65;
    const c = parseInt(cellId.slice(1),10) - 1;
    const s = shipSizes[currentShipIndex];
    if (!s || s<=0){ log('Geen schip geselecteerd'); return; }
    const coords = canPlace(r,c,s,orientation);
    if (!coords){ log('Kan hier niet plaatsen'); return; }
    coords.forEach(k => myBoard[k] = 'ship');
    placedShips.push({ id: 'ship_'+Date.now(), cells: coords, size: s });
    shipSizes[currentShipIndex] = 0;
    while (currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++;
    renderShipList(); renderBoards();
  }

  function randomPlaceAll(){
    for (const k in myBoard) myBoard[k] = 'empty';
    placedShips = [];
    const sizes = shipSizes.slice().filter(x=>x>0);
    for (const s of sizes){
      let tries = 0, placed = false;
      while (!placed && tries < 1000){
        const r = Math.floor(Math.random()*size), c = Math.floor(Math.random()*size);
        const o = Math.random()<0.5 ? 'H' : 'V';
        const coords = canPlace(r,c,s,o);
        if (coords){ coords.forEach(k=> myBoard[k] = 'ship'); placedShips.push({ id:'ship_'+Date.now()+'_'+Math.floor(Math.random()*9999), cells: coords, size: s }); placed = true; }
        tries++;
      }
    }
    for (let i=0;i<shipSizes.length;i++) shipSizes[i] = 0;
    renderShipList(); renderBoards();
  }

  // find gameId from lobby and join
  async function joinGameAndInit(){
    const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
    if (!lobbySnap.exists()) throw new Error('Lobby niet gevonden');
    const lobby = lobbySnap.val();
    gameId = lobby.gameId;
    // apply lobby size/gamemode if available
    const gm = lobby.gamemode || mode || 'classic';
    const sizeFromLobby = lobby.size || (gm === 'power' ? 20 : 10);
    setSizesByChoice(sizeFromLobby);
    // ensure player present
    const meRef = ref(db, `games/${gameId}/players/${profile.uid}`);
    const meSnap = await get(meRef);
    if (!meSnap.exists()){
      const playersSnap = await get(ref(db, `games/${gameId}/players`));
      let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
      await set(meRef, { username: profile.username, ready:false, slot });
    }
    // listen for players changes
    onValue(ref(db, `games/${gameId}/players`), snap=>{
      const players = snap.val() || {};
      // update ready badges & opponent presence
      if (players[profile.uid] && players[profile.uid].ready) readyBadgeMe.textContent = '✔️ Klaar'; else readyBadgeMe.textContent = '';
      let opp = null;
      for (const pid in players) if (pid !== profile.uid){ opp = players[pid]; }
      if (opp) readyBadgeOp.textContent = opp.ready ? '✔️ Klaar' : ''; else readyBadgeOp.textContent = '';
    });

    onValue(ref(db, `games/${gameId}`), async snap=>{
      const g = snap.val() || {};
      if (g.turnUid) infoTurn && (infoTurn.textContent = (g.turnUid === profile.uid ? 'Jij' : 'Tegenstander'));
      if (g.status === 'in_progress') await refreshBoards();
      if (g.status === 'finished'){
        const winner = g.winner;
        if (winner === profile.uid) { document.body.classList.add('win-anim'); setTimeout(()=>document.body.classList.remove('win-anim'),2000); alert('Je hebt gewonnen!'); }
        else { document.body.classList.add('lose-anim'); setTimeout(()=>document.body.classList.remove('lose-anim'),2000); alert('Je hebt verloren'); }
      }
    });
  }

  async function saveBoardReady(){
    if (!gameId) return;
    await set(ref(db, `games/${gameId}/players/${profile.uid}/board`), myBoard);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ships`), placedShips);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ready`), true);
    log('Board opgeslagen en ready');
    // check if both ready -> start
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
        log('Game gestart');
      } else {
        log('Wachten op tegenstander...');
      }
    } else {
      log('Wachten op tegenstander...');
    }
  }

  async function makeMove(cell){
    if (!gameId) return;
    // determine target id
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val() || {};
    const players = g.players || {};
    let targetId = null;
    for (const pid in players) if (pid !== profile.uid) targetId = pid;
    if (!targetId) { log('Geen tegenstander'); return; }

    const mvRef = push(ref(db, `games/${gameId}/moves`));
    await set(mvRef, { by: profile.uid, cell, ts: Date.now(), status: 'processing' });

    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, cur => {
      if (!cur || cur === 'empty') return 'miss';
      if (cur === 'ship') return 'hit';
      return; // already decided
    });
    const resSnap = await get(cellRef);
    const result = resSnap.val();
    await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), result);
    log(`Schot op ${cell} => ${result}`);

    if (result === 'hit'){
      // check sunk
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
          const updates = {};
          for (const c of ship.cells){
            updates[`games/${gameId}/players/${targetId}/board/${c}`] = 'sunk';
            updates[`games/${gameId}/players/${profile.uid}/revealed/${c}`] = 'sunk';
          }
          await update(ref(db, `/`), updates);
          await set(ref(db, `games/${gameId}/moves/${mvRef.key}/sunkShipId`), ship.id);
          log('Ship gezonken!');
          // power awarding
          if (mode === 'power'){
            await runTransaction(ref(db, `games/${gameId}/players/${profile.uid}/power`), cur => (cur||0) + 1);
            log('Power verdiend!');
          }
        }
      }
      // turn rule: streak mode and hit => keep turn; classic => switch; user requested variations:
      if (mode === 'streak') {
        await set(ref(db, `games/${gameId}/turnUid`), profile.uid); // keep turn on hit
      } else {
        // classic and power: on hit -> still allow same player (user earlier wanted both variants; final spec: classic = alternate always, streak = keep on hit, earlier user asked also mode where hit gives extra turn; I implement: classic always switches, streak keeps, power keeps on hit)
        if (mode === 'classic') {
          // in classic we switch on every shot regardless: so switch to other player
          await set(ref(db, `games/${gameId}/turnUid`), targetId);
        } else {
          // power: keep turn on hit
          await set(ref(db, `games/${gameId}/turnUid`), profile.uid);
        }
      }
    } else {
      // miss => set miss & switch to other
      await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), 'miss');
      await set(ref(db, `games/${gameId}/turnUid`), targetId);
    }

    // victory check
    const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
    const tboard = targetBoardSnap.exists() ? targetBoardSnap.val() : {};
    const hasShipLeft = Object.values(tboard).some(v => v === 'ship');
    if (!hasShipLeft){
      await set(ref(db, `games/${gameId}/status`), 'finished');
      await set(ref(db, `games/${gameId}/winner`), profile.uid);
      log('Je hebt gewonnen!');
      if (!profile.guest) await incrementWinsForUid(profile.uid);
    }
  }

  // powershot: only in power mode; reveal 3x3 and apply hits/misses; consumes 1 power and keeps turn
  async function powerShot(centerCell){
    if (mode !== 'power') return;
    const powSnap = await get(ref(db, `games/${gameId}/players/${profile.uid}/power`));
    const count = powSnap.exists() ? powSnap.val() : 0;
    if (count <= 0){ log('Geen powershots'); return; }
    const r = centerCell.charCodeAt(0) - 65;
    const c = parseInt(centerCell.slice(1),10) - 1;
    const cells = [];
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++){
      const rr = r+dr, cc = c+dc;
      if (rr>=0 && rr<size && cc>=0 && cc<size) cells.push(cellName(rr,cc));
    }
    // apply transactions for each cell
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    const playersObj = playersSnap.val() || {};
    let targetId = null;
    for (const pid in playersObj) if (pid !== profile.uid) targetId = pid;
    if (!targetId) return;
    for (const cell of cells){
      const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
      await runTransaction(cellRef, cur => {
        if (!cur || cur === 'empty') return 'miss';
        if (cur === 'ship') return 'hit';
        return;
      });
    }
    // consume one power
    await runTransaction(ref(db, `games/${gameId}/players/${profile.uid}/power`), cur => Math.max((cur||0)-1,0));
    await set(ref(db, `games/${gameId}/turnUid`), profile.uid); // keep turn
    log('Powershot uitgevoerd');
  }

  // refresh local boards from DB
  async function refreshBoards(){
    if (!gameId) return;
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    const players = playersSnap.exists() ? playersSnap.val() : {};
    for (const pid in players){
      const p = players[pid];
      if (pid === profile.uid){
        const b = p.board || {};
        for (const k in b) myBoard[k] = b[k];
      } else {
        const b = p.board || {};
        for (const k in b){
          if (b[k] === 'hit' || b[k] === 'miss' || b[k] === 'sunk') oppBoard[k] = b[k];
        }
      }
    }
    renderBoards();
  }

  // attach UI listeners
  boardMeEl?.addEventListener('click', e=>{
    const t = e.target.closest('.tile'); if (!t) return;
    placeShipAt(t.dataset.cell);
  });

  boardOpEl?.addEventListener('click', async e=>{
    const t = e.target.closest('.tile'); if (!t) return;
    const cell = t.dataset.cell;
    // if awaiting power target handled elsewhere
    // only allow shooting when game in_progress and your turn
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val() || {};
    if (!g) return;
    if (g.status !== 'in_progress'){ log('Wacht tot spel start'); return; }
    if (g.turnUid !== profile.uid){ log('Niet jouw beurt'); return; }
    const known = oppBoard[cell];
    if (known === 'hit' || known === 'miss' || known === 'sunk'){ log('Al geschoten'); return; }
    // if power mode and awaiting power selection state handled by overlay, but here we'll treat normal shot
    await makeMove(cell);
  });

  btnRandom?.addEventListener('click', randomPlaceAll);
  btnRotate?.addEventListener('click', ()=> { orientation = orientation === 'H' ? 'V' : 'H'; btnRotate.textContent = `Rotate (${orientation})`; });
  btnReady?.addEventListener('click', async ()=> {
    await saveBoardReady();
  });

  if (btnPower){
    btnPower.addEventListener('click', ()=> {
      // enable one-time overlay instruct and wait for click on boardOp to execute powerShot
      log('Klik op een cel bij tegenstander om powershot uit te voeren');
      const handler = async (e)=> {
        const t = e.target.closest('.tile'); if (!t) return;
        boardOpEl.removeEventListener('click', handler, true);
        await powerShot(t.dataset.cell);
        await refreshBoards();
      };
      boardOpEl.addEventListener('click', handler, true);
    });
  }

  // initialize flow
  await joinGameAndInit();
  // load initial boards
  await refreshBoards();

  // listen moves for updates
  onValue(ref(db, `games/${gameId}/moves`), snap => {
    const moves = snap.val() || {};
    const keys = Object.keys(moves);
    if (!keys.length) return;
    const last = moves[keys[keys.length-1]];
    log(`Move: ${last.by} -> ${last.cell} (${last.result || '...'})`);
    // refreshboards after small delay
    setTimeout(()=> refreshBoards(), 400);
  });

  // listen for power changes to enable/disable button
  onValue(ref(db, `games/${gameId}/players/${profile.uid}/power`), snap=>{
    const v = snap.val() || 0;
    powerCount = v;
    if (infoPower) infoPower.textContent = v;
    if (btnPower) btnPower.disabled = !(v>0);
  });

  // listen for game status/turn updates handled in joinGameAndInit via onValue
}
