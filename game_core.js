// game_core.js — complete & tested client core
// Verwacht: firebase-config.js exports `db` and app-auth.js exports loadLocalProfile & incrementGameResults
import { db } from "./firebase-config.js";
import { loadLocalProfile, ensureUserProfileOnDb, incrementGameResults } from "./app-auth.js";
import { ref, get, set, onValue, onChildAdded, push, runTransaction, update } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const $ = id => document.getElementById(id);
const alpha = n => String.fromCharCode(65 + n);
const cellName = (r,c) => `${alpha(r)}${c+1}`;

/* minimal audio */
class Snd {
  constructor(){ this.ctx=null; try { this.ctx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){ this.ctx = null; } }
  _play(f,type='sine',dur=0.08,g=0.12){ if(!this.ctx) return; const o=this.ctx.createOscillator(), gg=this.ctx.createGain(); o.type=type; o.frequency.value=f; gg.gain.value=g; o.connect(gg); gg.connect(this.ctx.destination); o.start(); gg.gain.exponentialRampToValueAtTime(0.0001,this.ctx.currentTime+dur); o.stop(this.ctx.currentTime+dur+0.02); }
  hit(){ this._play(420,'sawtooth',0.12,0.14) } miss(){ this._play(240,'sine',0.12,0.06) } sunk(){ this._play(140,'square',0.26,0.18) } win(){ this._play(880,'sine',0.18,0.18) } lose(){ this._play(150,'sine',0.18,0.12) }
}
const S = new Snd();

/* confetti */
function ensureConfetti(){
  let canvas = document.getElementById('confetti-canvas');
  if (!canvas){
    canvas = document.createElement('canvas'); canvas.id='confetti-canvas'; document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    function fit(){ canvas.width = innerWidth; canvas.height = innerHeight; } fit(); window.addEventListener('resize', fit);
    let parts=[];
    function spawn(){ for(let i=0;i<60;i++){ parts.push({x:innerWidth/2,y:120,vx:(Math.random()-0.5)*6,vy:Math.random()*-6-1,size:6+Math.random()*9,life:80+Math.random()*80,color:`hsl(${Math.floor(Math.random()*360)},70%,60%)`}); } }
    function step(){ ctx.clearRect(0,0,canvas.width,canvas.height); for(let i=parts.length-1;i>=0;i--){ const p=parts[i]; p.vy+=0.18; p.x+=p.vx; p.y+=p.vy; p.life--; ctx.fillStyle=p.color; ctx.fillRect(p.x,p.y,p.size,p.size*0.6); if(p.life<=0||p.y>canvas.height+50) parts.splice(i,1); } requestAnimationFrame(step); } step();
    return { spawn };
  }
  return { spawn: ()=>{} };
}
const conf = ensureConfetti();

function debounce(fn, wait=120){ let t=null; return (...args)=>{ if(t) clearTimeout(t); t=setTimeout(()=> { t=null; fn(...args); }, wait); }; }

export async function startGame({ mode }){
  const profile = loadLocalProfile();
  if (!profile) { location.href='index.html'; return; }
  // ensure user profile exists in DB (for leaderboard)
  ensureUserProfileOnDb(profile.uid, profile).catch(()=>{});

  const qs = new URLSearchParams(location.search);
  const lobbyCode = qs.get('lobby');
  if (!lobbyCode) { alert('Geen lobby code'); return; }

  // DOM refs (expected in page)
  const boardMeEl = $('board-me'), boardOpEl = $('board-op'), shipListEl = $('ship-list');
  const btnRandom = $('btn-random'), btnRotate = $('btn-rotate'), btnReady = $('btn-ready'), btnPower = $('btn-power');
  const infoTurn = $('info-turn'), infoPower = $('info-power'), logEl = $('log');
  const readyBadgeMe = $('ready-badge-me'), readyBadgeOp = $('ready-badge-op');

  // turn badge
  if (!document.getElementById('turn-badge-global')){
    const el = document.createElement('div'); el.style.display='flex'; el.style.justifyContent='center'; el.style.margin='10px 0';
    el.innerHTML = `<div id="turn-badge-global" class="turn-badge">Beurt: -</div>`;
    document.querySelector('main .topbar')?.after(el);
  }
  const turnBadge = document.getElementById('turn-badge-global');

  // state
  let gameId = null;
  let size = 15;
  let myBoard = {}, oppBoard = {};
  let shipSizes = [5,4,3,2];
  let placedShips = [];
  let currentShipIndex = 0;
  let orientation = 'H';
  let awaitingPowerTarget = false;
  let cleanupTimer = null;

  // render functions (debounced)
  const renderBoards = debounce(()=>{
    // my board
    if (boardMeEl) Array.from(boardMeEl.children).forEach(tile=>{
      const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML='';
      const st = myBoard[id] || 'empty';
      if (st === 'ship') tile.classList.add('ship');
      if (st === 'hit') { tile.classList.add('hit'); tile.innerHTML='💥'; }
      if (st === 'miss') { tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if (st === 'sunk') { tile.classList.add('sunk'); tile.innerHTML='☠️'; }
    });
    // opp board
    if (boardOpEl) Array.from(boardOpEl.children).forEach(tile=>{
      const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML='';
      const st = oppBoard[id] || null;
      if (st === 'hit') { tile.classList.add('hit'); tile.innerHTML='🔥'; }
      if (st === 'miss') { tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if (st === 'sunk') { tile.classList.add('sunk'); tile.innerHTML='☠️'; }
    });
  }, 60);

  function log(msg){ if (!logEl) return; const d=document.createElement('div'); d.textContent=`${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }

  function createGrid(el,n){
    el.innerHTML=''; el.classList.remove('cell-10','cell-15','cell-20');
    el.classList.add(`cell-${n}`);
    el.style.gridTemplateRows = `repeat(${n},1fr)`;
    for (let r=0;r<n;r++) for (let c=0;c<n;c++){
      const tile=document.createElement('div'); tile.className='tile sea'; tile.dataset.r=r; tile.dataset.c=c; tile.dataset.cell=cellName(r,c);
      el.appendChild(tile);
    }
  }

  // setSizes mapping per your request
  function setSizes(s){
    size = s;
    createGrid(boardMeEl, size);
    createGrid(boardOpEl, size);
    placedShips = []; currentShipIndex = 0; orientation = 'H';
    if (size === 10) shipSizes = [5,4,3];
    else if (size === 15) shipSizes = [5,4,3,2];
    else if (size === 20) shipSizes = [5,4,4,3,3,2];
    else shipSizes = [5,4,3,2];
    myBoard = {}; oppBoard = {};
    for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoard[cellName(r,c)]='empty';
    renderShipList(); renderBoards();
  }

  function renderShipList(){
    if (!shipListEl) return;
    shipListEl.innerHTML='';
    shipSizes.forEach((s,i)=>{
      const pill = document.createElement('div'); pill.className='ship-pill'+(i===currentShipIndex?' active':''); pill.textContent=`Ship ${i+1} — ${s>0?s:'placed'}`;
      pill.onclick = ()=>{ if (s>0){ currentShipIndex=i; renderShipList(); } };
      shipListEl.appendChild(pill);
    });
  }

  function canPlace(r,c,s,orient){
    const coords=[];
    for (let i=0;i<s;i++){
      const rr=r + (orient==='V'?i:0), cc=c + (orient==='H'?i:0);
      if (rr<0||rr>=size||cc<0||cc>=size) return null;
      coords.push(cellName(rr,cc));
    }
    for (const k of coords) if (myBoard[k]==='ship') return null;
    return coords;
  }

  function placeShipAt(cellId){
    const r = cellId.charCodeAt(0)-65, c = parseInt(cellId.slice(1),10)-1;
    const s = shipSizes[currentShipIndex];
    if (!s||s<=0){ log('Geen schip geselecteerd'); return; }
    const coords = canPlace(r,c,s,orientation);
    if (!coords){ log('Kan hier niet plaatsen'); return; }
    coords.forEach(k=> myBoard[k]='ship');
    placedShips.push({ id:'ship_'+Date.now(), cells:coords, size:s });
    shipSizes[currentShipIndex]=0;
    while(currentShipIndex<shipSizes.length && shipSizes[currentShipIndex]===0) currentShipIndex++;
    renderShipList(); renderBoards();
  }

  function randomPlaceAll(){
    for(const k in myBoard) myBoard[k]='empty';
    placedShips=[];
    const sizes = shipSizes.slice().filter(x=>x>0);
    for (const s of sizes){
      let tries=0, placed=false;
      while(!placed && tries<3000){
        const r=Math.floor(Math.random()*size), c=Math.floor(Math.random()*size);
        const o=Math.random()<0.5?'H':'V';
        const coords = canPlace(r,c,s,o);
        if (coords){ coords.forEach(k=> myBoard[k]='ship'); placedShips.push({id:'ship_'+Date.now(),cells:coords,size:s}); placed=true; }
        tries++;
      }
    }
    for (let i=0;i<shipSizes.length;i++) shipSizes[i]=0;
    renderShipList(); renderBoards();
  }

  // DB & listeners
  let currentLobbyGameId = null;

  onValue(ref(db, `lobbies/${lobbyCode}`), snap => {
    const lobby = snap.exists() ? snap.val() : null;
    if (!lobby) return;
    if (!currentLobbyGameId) currentLobbyGameId = lobby.gameId;
    else if (lobby.gameId && lobby.gameId !== currentLobbyGameId){
      // new game id -> redirect. pick correct game page by gamemode
      const gm = lobby.gamemode || mode || 'classic';
      const page = gm === 'power' ? 'game_power.html' : (gm === 'streak' ? 'game_streak.html' : (gm === 'salvo' ? 'game_salvo.html' : 'game_classic.html'));
      location.href = `${page}?lobby=${lobbyCode}`;
    }
  });

  async function initFromLobby(){
    const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
    if (!lobbySnap.exists()) throw new Error('Lobby niet gevonden');
    const lobby = lobbySnap.val();
    gameId = lobby.gameId;
    currentLobbyGameId = lobby.gameId;
    const sizeFromLobby = lobby.size || (lobby.gamemode==='power'?20:15);
    setSizes(sizeFromLobby);

    // ensure player node exists
    const meRef = ref(db, `games/${gameId}/players/${profile.uid}`);
    const meSnap = await get(meRef);
    if (!meSnap.exists()){
      const playersSnap = await get(ref(db, `games/${gameId}/players`));
      let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length===0) slot=0;
      await set(meRef, { username: profile.username, ready:false, slot, power:0 });
    }

    // players small listener for ready badges
    onValue(ref(db, `games/${gameId}/players`), snap => {
      const players = snap.val() || {};
      readyBadgeMe.textContent = players[profile.uid] && players[profile.uid].ready ? '✔️ Klaar' : '';
      let oppFound=false;
      for (const pid in players) if (pid !== profile.uid){ oppFound=true; readyBadgeOp.textContent = players[pid].ready ? '✔️ Klaar':''; }
      if (!oppFound) readyBadgeOp.textContent = '';
    });

    // onChildAdded moves (cheap)
    onChildAdded(ref(db, `games/${gameId}/moves`), async snap => {
      const mv = snap.val();
      if (!mv) return;
      // update local displayed boards quickly (authoritative refresh below)
      if (mv.by === profile.uid){
        oppBoard[mv.cell] = mv.result;
      } else {
        myBoard[mv.cell] = mv.result;
      }
      if (mv.result === 'hit') S.hit();
      if (mv.result === 'miss') S.miss();
      if (mv.result === 'sunk') S.sunk();
      renderBoards();
      setTimeout(()=> refreshBoards(), 300);
    });

    // listen status & turn
    onValue(ref(db, `games/${gameId}/status`), snap => {
      const status = snap.val();
      if (status === 'in_progress'){ if (cleanupTimer){ clearTimeout(cleanupTimer); cleanupTimer=null; } refreshBoards(); }
      if (status === 'finished') handleFinish();
    });
    onValue(ref(db, `games/${gameId}/turnUid`), snap => {
      const turnUid = snap.val();
      const mine = turnUid === profile.uid;
      if (turnBadge){ turnBadge.textContent = `Beurt: ${mine ? 'Jij' : 'Tegenstander'}`; if (mine) turnBadge.classList.add('pulse'); else turnBadge.classList.remove('pulse'); }
    });

    // power and salvo info
    onValue(ref(db, `games/${gameId}/players/${profile.uid}/power`), snap => { if (infoPower) infoPower.textContent = snap.val() || 0; if (btnPower) btnPower.disabled = !(snap.val()||0>0); });
    onValue(ref(db, `games/${gameId}/salvo/${profile.uid}/shotsLeft`), snap => { const v = snap.val() || 0; if (mode === 'salvo' && infoTurn){ // show in infoTurn briefly
      infoTurn.textContent = `Beurt: ${turnBadge.textContent.split(':')[1] || '-'} • Shots left: ${v}`; } });
  }

  // finish flow: award stats + show rematch overlay
  async function handleFinish(){
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.exists() ? gSnap.val() : {};
    if (!g) return;
    const winner = g.winner;
    const players = g.players || {};
    const losers = [];
    for (const pid in players) if (pid !== winner) losers.push(pid);
    if (winner === profile.uid){
      S.win(); conf.spawn();
      showRematch(true);
    } else {
      S.lose();
      showRematch(false);
    }
    // update stats: winner + losers
    try{
      await incrementGameResults(winner, losers);
    }catch(e){
      console.warn('stats update failed', e);
    }
    // cleanup old game after 2 minutes if no rematch
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(async ()=>{ try{ await set(ref(db, `lobbies/${lobbyCode}`), null); await set(ref(db, `games/${gameId}`), null); } catch(e){ console.warn(e); } }, 120000);
  }

  function showRematch(didWin){
    const html = `<div style="text-align:center"><h2>${didWin ? 'Je hebt gewonnen!' : 'Je hebt verloren'}</h2>
      <p>Klik Rematch — zodra beide spelers klikken start een nieuwe game met dezelfde lobby-code.</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:8px"><button id="rematch-yes">Rematch</button><button id="rematch-no" class="ghost">Terug</button></div></div>`;
    showOverlay(html);
    setTimeout(()=> {
      const yes = document.getElementById('rematch-yes'), no = document.getElementById('rematch-no');
      if (yes) yes.onclick = async ()=> { await set(ref(db, `games/${gameId}/rematchRequests/${profile.uid}`), true); showSmall('Rematch-request verzonden.'); };
      if (no) no.onclick = ()=> location.href='home.html';
    },50);
  }

  function showOverlay(innerHTML){
    let o = document.querySelector('.overlay');
    if (!o){ o = document.createElement('div'); o.className='overlay'; o.innerHTML = `<div class="overlay-inner"><div id="overlay-inner-content">${innerHTML}</div><div class="overlay-actions"><button id="overlay-close">OK</button></div></div>`; document.body.appendChild(o); document.getElementById('overlay-close').addEventListener('click', ()=> o.classList.add('hidden')); }
    else { o.classList.remove('hidden'); document.getElementById('overlay-inner-content').innerHTML = innerHTML; }
  }
  function showSmall(msg){ const o = document.querySelector('.overlay'); if (!o) alert(msg); else { o.classList.remove('hidden'); document.getElementById('overlay-inner-content').innerHTML = `<div>${msg}</div>`; setTimeout(()=> o.classList.add('hidden'),1300); } }

  // save board ready
  async function saveBoardReady(){
    if (!gameId) return;
    await set(ref(db, `games/${gameId}/players/${profile.uid}/board`), myBoard);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ships`), placedShips);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ready`), true);
    log('Je bent klaar');
    // check both ready and start
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.exists() ? gSnap.val() : {};
    const players = g.players || {};
    const ids = Object.keys(players);
    if (ids.length >= 2){
      const bothReady = ids.every(id => players[id].ready);
      if (bothReady){
        const starter = ids[Math.floor(Math.random()*ids.length)];
        // if salvo: initialize shotsLeft for both players (number of alive ships)
        if ((g.gamemode === 'salvo' || mode === 'salvo')){
          for (const pid of ids){
            const shipsSnap = await get(ref(db, `games/${gameId}/players/${pid}/ships`));
            const ships = shipsSnap.exists() ? shipsSnap.val() : [];
            const initial = ships.length || 4;
            await set(ref(db, `games/${gameId}/salvo/${pid}/shotsLeft`), initial);
          }
        }
        await set(ref(db, `games/${gameId}/status`), 'in_progress');
        await set(ref(db, `games/${gameId}/turnUid`), starter);
        log('Game gestart');
      } else log('Wacht op tegenstander...');
    } else log('Wacht op tegenstander...');
  }

  // count alive ships helper
  async function countAliveShipsFor(uid){
    const shipsSnap = await get(ref(db, `games/${gameId}/players/${uid}/ships`));
    const boardSnap = await get(ref(db, `games/${gameId}/players/${uid}/board`));
    const ships = shipsSnap.exists() ? shipsSnap.val() : [];
    const board = boardSnap.exists() ? boardSnap.val() : {};
    let alive = 0;
    for (const sh of (ships||[])){
      let sunk = true;
      for (const c of (sh.cells||[])){
        const st = board[c] || 'empty';
        if (st !== 'sunk') { sunk = false; break; }
      }
      if (!sunk) alive++;
    }
    return alive;
  }

  // makeMove
  async function makeMove(cell){
    if (!gameId) return;
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.exists() ? gSnap.val() : {};
    const players = g.players || {};
    let targetId = null;
    for (const pid in players) if (pid !== profile.uid) targetId = pid;
    if (!targetId){ log('Geen tegenstander'); return; }

    // push move
    const mvRef = push(ref(db, `games/${gameId}/moves`));
    await set(mvRef, { by: profile.uid, cell, ts: Date.now(), status:'processing' });

    // read target board & ships once
    const [boardSnap, shipsSnap] = await Promise.all([
      get(ref(db, `games/${gameId}/players/${targetId}/board`)),
      get(ref(db, `games/${gameId}/players/${targetId}/ships`))
    ]);
    const tBoard = boardSnap.exists() ? boardSnap.val() : {};
    const tShips = shipsSnap.exists() ? shipsSnap.val() : [];

    const cur = tBoard && tBoard[cell] ? tBoard[cell] : 'empty';
    const result = (cur === 'ship') ? 'hit' : 'miss';

    // transaction on single cell to avoid double-shoot
    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, c => {
      if (!c || c === 'empty') return result === 'hit' ? 'hit' : 'miss';
      return; // already shot
    });

    const finalSnap = await get(cellRef);
    const finalVal = finalSnap.val();
    await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), finalVal);

    log(`Schot op ${cell} => ${finalVal}`);

    // if hit -> check sunk
    if (finalVal === 'hit'){
      const ship = (tShips || []).find(s => (s.cells || []).includes(cell));
      if (ship){
        // check if all cells of ship are now hit/sunk
        let allHit = true;
        for (const c of ship.cells){
          const st = (c === cell) ? 'hit' : (tBoard[c] || 'empty');
          if (st !== 'hit' && st !== 'sunk'){ allHit = false; break; }
        }
        if (allHit){
          // set all cells to sunk in one update
          const updates = {};
          for (const c of ship.cells){ updates[`games/${gameId}/players/${targetId}/board/${c}`] = 'sunk'; updates[`games/${gameId}/players/${profile.uid}/revealed/${c}`] = 'sunk'; }
          await update(ref(db, `/`), updates);
          await set(ref(db, `games/${gameId}/moves/${mvRef.key}/sunkShipId`), ship.id || 'sunk');
          log('Ship gezonken!');
          S.sunk();
          // power reward
          if (mode === 'power') await runTransaction(ref(db, `games/${gameId}/players/${profile.uid}/power`), cur => (cur||0)+1);
          // mark move result as 'sunk' for UI (already set via board updates)
          await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), 'sunk');
        }
      }
    }

    // now decide turn switch rules
    if (g.gamemode === 'salvo' || mode === 'salvo'){
      // decrement shotsLeft, if still >0 keep turn, else set opponent shotsLeft and switch
      const shotsRef = ref(db, `games/${gameId}/salvo/${profile.uid}/shotsLeft`);
      await runTransaction(shotsRef, cur => Math.max((cur||1)-1,0));
      const after = await get(shotsRef);
      const left = after.exists() ? after.val() : 0;
      if (left > 0){
        await set(ref(db, `games/${gameId}/turnUid`), profile.uid);
      } else {
        const aliveOpponent = await countAliveShipsFor(targetId);
        await set(ref(db, `games/${gameId}/salvo/${targetId}/shotsLeft`), Math.max(aliveOpponent,1));
        await set(ref(db, `games/${gameId}/turnUid`), targetId);
      }
    } else if (g.gamemode === 'streak' || mode === 'streak'){
      if (finalVal === 'hit' || finalVal === 'sunk'){ await set(ref(db, `games/${gameId}/turnUid`), profile.uid); } else { await set(ref(db, `games/${gameId}/turnUid`), targetId); }
    } else {
      // classic & power: switch after each shot
      await set(ref(db, `games/${gameId}/turnUid`), targetId);
    }

    // check victory
    const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
    const tboard = targetBoardSnap.exists() ? targetBoardSnap.val() : {};
    const hasShipLeft = Object.values(tboard).some(v => v === 'ship');
    if (!hasShipLeft){
      await set(ref(db, `games/${gameId}/status`), 'finished');
      await set(ref(db, `games/${gameId}/winner`), profile.uid);
      log('Je hebt gewonnen!');
      S.win(); conf.spawn();
    }

    // authoritative refresh
    setTimeout(()=> refreshBoards(), 220);
  }

  // powershot
  async function powerShot(centerCell){
    if (mode !== 'power') return;
    const powSnap = await get(ref(db, `games/${gameId}/players/${profile.uid}/power`));
    const count = powSnap.exists() ? powSnap.val() : 0;
    if (count <= 0){ log('Geen powershots'); return; }
    const r = centerCell.charCodeAt(0)-65, c = parseInt(centerCell.slice(1),10)-1;
    const cells = [];
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++){
      const rr=r+dr, cc=c+dc;
      if (rr>=0 && rr<size && cc>=0 && cc<size) cells.push(cellName(rr,cc));
    }
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    const playersObj = playersSnap.exists() ? playersSnap.val() : {};
    let targetId = null;
    for (const pid in playersObj) if (pid !== profile.uid) targetId = pid;
    if (!targetId) return;
    for (const cell of cells){
      const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
      await runTransaction(cellRef, cur => { if (!cur || cur === 'empty') return 'miss'; if (cur === 'ship') return 'hit'; return; });
    }
    await runTransaction(ref(db, `games/${gameId}/players/${profile.uid}/power`), cur => Math.max((cur||0)-1,0));
    await set(ref(db, `games/${gameId}/turnUid`), profile.uid);
    log('Powershot uitgevoerd');
    S.hit();
    refreshBoards();
  }

  // refreshBoards authoritative
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
        for (const k in b) {
          if (b[k] === 'hit' || b[k] === 'miss' || b[k] === 'sunk') oppBoard[k] = b[k];
        }
      }
    }
    renderBoards();
  }

  // UI event handlers
  boardMeEl?.addEventListener('click', e => { const t = e.target.closest('.tile'); if (!t) return; placeShipAt(t.dataset.cell); });
  boardOpEl?.addEventListener('click', async e => {
    const t = e.target.closest('.tile'); if (!t) return;
    const cell = t.dataset.cell;
    if (awaitingPowerTarget && mode === 'power'){ awaitingPowerTarget=false; await powerShot(cell); return; }
    const gSnap = await get(ref(db, `games/${gameId}`)); const g = gSnap.exists() ? gSnap.val() : {};
    if (!g || g.status !== 'in_progress'){ log('Wacht tot spel gestart is'); return; }
    if (g.turnUid !== profile.uid){ log('Niet jouw beurt'); return; }
    const known = oppBoard[cell];
    if (known === 'hit' || known === 'miss' || known === 'sunk'){ log('Al geschoten'); return; }
    await makeMove(cell);
  });

  btnRandom?.addEventListener('click', randomPlaceAll);
  btnRotate?.addEventListener('click', ()=>{ orientation = orientation==='H' ? 'V' : 'H'; btnRotate.textContent = `Rotate (${orientation})`; });
  btnReady?.addEventListener('click', async ()=> { await saveBoardReady(); });
  if (btnPower) btnPower.addEventListener('click', ()=> { awaitingPowerTarget = true; showSmall('Klik op een cel in het vijandelijke bord om powershot uit te voeren'); });

  // tutorial once
  (function maybeShowTutorial(){
    const seen = localStorage.getItem('zs_tutorial_seen_v3');
    if (seen) return;
    const t = `<div style="text-align:left"><h3>Uitleg</h3>
      <ul>
        <li><b>Classic:</b> beurt wisselt altijd.</li>
        <li><b>Streak:</b> hit → extra beurt.</li>
        <li><b>Power:</b> sink ship → +1 powershot (3×3).</li>
        <li><b>Salvo:</b> per beurt schiet je zo vaak als je nog schepen hebt (begint met 3/4/6 afhankelijk van size).</li>
      </ul><div style="text-align:center"><button id="ok-tut">Akkoord</button></div></div>`;
    showOverlay(t);
    setTimeout(()=> { const b = document.getElementById('ok-tut'); if (b) b.onclick = ()=> { document.querySelector('.overlay').classList.add('hidden'); localStorage.setItem('zs_tutorial_seen_v3','1'); } },50);
  })();

  // init
  await initFromLobby().catch(err => { console.error(err); showSmall('Kon lobby niet laden: '+(err.message||err)); });
  await refreshBoards();
}
