// game_core.js — geoptimaliseerde versie met Fog & Salvo modes
import { db } from "./firebase-config.js";
import { loadLocalProfile, incrementWinsForUid } from "./app-auth.js";
import { ref, get, set, onValue, push, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const $ = id => document.getElementById(id);
const alpha = n => String.fromCharCode(65 + n);
const cellName = (r,c) => `${alpha(r)}${c+1}`;

/* Simple audio (keeps UX lively) */
class Snd {
  constructor(){ this.ctx=null; try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ this.ctx=null; } }
  _play(f,t= 'sine',d=0.08,g=0.12){ if(!this.ctx) return; const o=this.ctx.createOscillator(), gg=this.ctx.createGain(); o.type=t; o.frequency.value=f; gg.gain.value=g; o.connect(gg); gg.connect(this.ctx.destination); o.start(); gg.gain.exponentialRampToValueAtTime(0.0001,this.ctx.currentTime+d); o.stop(this.ctx.currentTime+d+0.02); }
  hit(){ this._play(420,'sawtooth',0.12,0.14) } miss(){ this._play(240,'sine',0.12,0.06) } sunk(){ this._play(140,'square',0.28,0.18) } win(){ this._play(880,'sine',0.18,0.18) } lose(){ this._play(150,'sine',0.18,0.12) }
}
const S = new Snd();

/* confetti minimal (spawn only) */
function ensureConfetti(){
  let canvas = document.getElementById('confetti-canvas');
  if (!canvas){ canvas = document.createElement('canvas'); canvas.id='confetti-canvas'; document.body.appendChild(canvas); const ctx = canvas.getContext('2d'); function fit(){ canvas.width=innerWidth; canvas.height=innerHeight } fit(); window.addEventListener('resize', fit); let parts=[]; function spawn(){ for(let i=0;i<50;i++){ parts.push({x:innerWidth/2,y:100,vx:(Math.random()-0.5)*6,vy:Math.random()*-5-1,size:6+Math.random()*8,life:120+Math.random()*60,color:`hsl(${Math.floor(Math.random()*360)},70%,60%)`}); } } function step(){ ctx.clearRect(0,0,canvas.width,canvas.height); for(let i=parts.length-1;i>=0;i--){ const p=parts[i]; p.vy+=0.18; p.x+=p.vx; p.y+=p.vy; p.life--; ctx.fillStyle=p.color; ctx.fillRect(p.x,p.y,p.size,p.size*0.6); if(p.life<=0||p.y>canvas.height+50) parts.splice(i,1); } requestAnimationFrame(step); } step(); return { spawn }; }
  return { spawn: ()=>{} };
}
const conf = ensureConfetti();

/* debounce helper */
function debounce(fn, wait=200){
  let t=null;
  return (...args)=>{ if(t) clearTimeout(t); t=setTimeout(()=> { t=null; fn(...args); }, wait); }
}

/* exported */
export async function startGame({ mode }){
  const profile = loadLocalProfile();
  if (!profile) { location.href='index.html'; return; }
  const qs = new URLSearchParams(location.search);
  const lobbyCode = qs.get('lobby');
  if (!lobbyCode) { alert('Geen lobby code'); return; }

  // UI refs
  const boardMeEl = $('board-me'), boardOpEl = $('board-op'), shipListEl = $('ship-list');
  const btnRandom = $('btn-random'), btnRotate = $('btn-rotate'), btnReady = $('btn-ready'), btnPower = $('btn-power');
  const infoTurn = $('info-turn'), infoPower = $('info-power'), logEl = $('log');
  const readyBadgeMe = $('ready-badge-me'), readyBadgeOp = $('ready-badge-op');

  // ensure turn badge
  if (!document.getElementById('turn-badge-global')){
    const el = document.createElement('div'); el.style.display='flex'; el.style.justifyContent='center'; el.style.margin='10px 0'; el.innerHTML = `<div id="turn-badge-global" class="turn-badge">Beurt: -</div>`;
    document.querySelector('main .topbar')?.after(el);
  }
  const turnBadge = document.getElementById('turn-badge-global');

  // state
  let gameId = null;
  let size = 10;
  let myId = profile.uid;
  let myBoard = {}, oppBoard = {};
  let shipSizes = [5,4,3];
  let placedShips = [];
  let currentShipIndex = 0;
  let orientation = 'H';
  let awaitingPowerTarget = false;
  let cleanupTimer = null;

  // UI render (debounced)
  const renderBoards = debounce(()=>{
    if (boardMeEl) Array.from(boardMeEl.children).forEach(tile=>{
      const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML='';
      if (myBoard[id]==='ship') tile.classList.add('ship');
      if (myBoard[id]==='hit'){ tile.classList.add('hit'); tile.innerHTML='💥'; }
      if (myBoard[id]==='miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if (myBoard[id]==='sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; }
    });
    if (boardOpEl) Array.from(boardOpEl.children).forEach(tile=>{
      const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML='';
      if (oppBoard[id]==='hit'){ tile.classList.add('hit'); tile.innerHTML='🔥'; }
      if (oppBoard[id]==='miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; }
      if (oppBoard[id]==='sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; }
      // Fog mode: hide unrevealed tiles by clearing classes (server controls oppBoard values)
    });
  }, 140);

  function log(msg){ if (!logEl) return; const d=document.createElement('div'); d.textContent=`${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }

  function createGrid(el,n){
    el.innerHTML=''; el.classList.remove('cell-10','cell-15','cell-20');
    el.classList.add(`cell-${n}`);
    el.style.gridTemplateRows = `repeat(${n},1fr)`;
    for (let r=0;r<n;r++) for (let c=0;c<n;c++){
      const tile = document.createElement('div'); tile.className='tile sea'; tile.dataset.r=r; tile.dataset.c=c; tile.dataset.cell=cellName(r,c);
      el.appendChild(tile);
    }
  }

  function setSizes(s){
    size = s;
    createGrid(boardMeEl, size);
    createGrid(boardOpEl, size);
    placedShips = []; currentShipIndex=0; orientation='H';
    if (mode === 'power' && size===20) shipSizes = [5,4,4,3,3,2];
    else if (size<=5) shipSizes = [3,2,2];
    else shipSizes = [5,4,3];
    myBoard = {}; oppBoard = {};
    for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoard[cellName(r,c)]='empty';
    renderShipList();
    renderBoards();
  }

  function renderShipList(){
    if (!shipListEl) return;
    shipListEl.innerHTML = '';
    shipSizes.forEach((s,i)=>{
      const pill = document.createElement('div');
      pill.className = 'ship-pill' + (i===currentShipIndex ? ' active' : '');
      pill.textContent = `Ship ${i+1} — ${s>0?s:'placed'}`;
      pill.onclick = ()=> { if (s>0){ currentShipIndex=i; renderShipList(); } };
      shipListEl.appendChild(pill);
    });
  }

  function canPlace(r,c,s,orient){
    const coords=[];
    for (let i=0;i<s;i++){
      const rr = r + (orient==='V'?i:0), cc = c + (orient==='H'?i:0);
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
      while(!placed && tries<1000){
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

  // minimal helper to batch-get necessary player data at once
  async function readTargetData(targetId){
    const snap = await get(ref(db, `games/${gameId}/players/${targetId}`));
    return snap.exists() ? snap.val() : null;
  }

  // initialize game & DB listeners
  let currentLobbyGameId = null;
  onValue(ref(db, `lobbies/${lobbyCode}`), snap => {
    const lobby = snap.exists() ? snap.val() : null;
    if (!lobby) return;
    if (!currentLobbyGameId) currentLobbyGameId = lobby.gameId;
    else if (lobby.gameId && lobby.gameId !== currentLobbyGameId){
      // lobby updated (rematch/new game) -> redirect to new game page
      const gm = lobby.gamemode || mode || 'classic';
      const target = gm === 'power' ? 'game_power.html' : (gm === 'streak' ? 'game_streak.html' : (gm === 'fog' ? 'game_fog.html' : (gm === 'salvo' ? 'game_salvo.html' : 'game_classic.html')) );
      location.href = `${target}?lobby=${lobbyCode}`;
    }
  });

  async function initFromLobby(){
    const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
    if (!lobbySnap.exists()) throw new Error('Lobby niet gevonden');
    const lobby = lobbySnap.val();
    gameId = lobby.gameId;
    currentLobbyGameId = lobby.gameId;
    const sizeFromLobby = lobby.size || (lobby.gamemode==='power'?20:10);
    setSizes(sizeFromLobby);

    // ensure player entry exists (write own player node)
    const meSnap = await get(ref(db, `games/${gameId}/players/${profile.uid}`));
    if (!meSnap.exists()){
      const playersSnap = await get(ref(db, `games/${gameId}/players`));
      let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length===0) slot=0;
      await set(ref(db, `games/${gameId}/players/${profile.uid}`), { username: profile.username, ready:false, slot, power:0 });
    }

    // listen players updates (small)
    onValue(ref(db, `games/${gameId}/players`), snap=>{
      const players = snap.val() || {};
      readyBadgeMe.textContent = players[profile.uid] && players[profile.uid].ready ? '✔️ Klaar' : '';
      let oppFound=false;
      for (const pid in players) if (pid !== profile.uid){ oppFound=true; readyBadgeOp.textContent = players[pid].ready ? '✔️ Klaar' : ''; }
      if (!oppFound) readyBadgeOp.textContent = '';
    });

    // listen for moves (child added) — cheaper than full moves list onValue many times
    const movesRef = ref(db, `games/${gameId}/moves`);
    onValue(movesRef, snap => {
      const moves = snap.val() || {};
      const keys = Object.keys(moves);
      if (!keys.length) return;
      const last = moves[keys[keys.length-1]];
      if (!last) return;
      if (last.result === 'hit') S.hit();
      if (last.result === 'miss') S.miss();
      if (last.result === 'sunk') S.sunk();
      log(`Move: ${last.by} -> ${last.cell} (${last.result||'...'})`);
      // we will refresh boards (debounced)
      refreshBoards();
    });

    // listen for meta changes (status/turn/winner)
    onValue(ref(db, `games/${gameId}/status`), snap => {
      const status = snap.val();
      if (status === 'in_progress'){ if (cleanupTimer){ clearTimeout(cleanupTimer); cleanupTimer=null; } refreshBoards(); }
      if (status === 'finished'){ handleFinish(); }
    });
    onValue(ref(db, `games/${gameId}/turnUid`), snap => {
      const turnUid = snap.val();
      const isMine = turnUid === profile.uid;
      if (turnBadge) { turnBadge.textContent = `Beurt: ${isMine ? 'Jij' : 'Tegenstander'}`; if (isMine) turnBadge.classList.add('pulse'); else turnBadge.classList.remove('pulse'); }
    });

    // power count
    onValue(ref(db, `games/${gameId}/players/${profile.uid}/power`), snap => {
      const v = snap.val()||0; if (infoPower) infoPower.textContent = v; if (btnPower) btnPower.disabled = !(v>0);
    });

    // rematchRequests listener for creation (server-side style handled elsewhere)
    onValue(ref(db, `games/${gameId}/rematchRequests`), snap => {
      const rr = snap.val() || {};
      if (Object.keys(rr).length >= 2){
        // handled by lobby listener that updates lobbies/{code} to new gameId
      }
    });
  }

  async function handleFinish(){
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.exists() ? gSnap.val() : {};
    if (!g) return;
    const winner = g.winner;
    if (winner === profile.uid){ S.win(); conf.spawn(); showRematch(true); if (!profile.guest) incrementWinsForUid(profile.uid); }
    else { S.lose(); showRematch(false); }
    // schedule cleanup after 2 minutes (if no rematch)
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(async ()=>{ try{ await set(ref(db, `lobbies/${lobbyCode}`), null); await set(ref(db, `games/${gameId}`), null); }catch(e){console.warn(e);} }, 120000);
  }

  function showRematch(didWin){
    const html = `<div style="text-align:center"><h2>${didWin ? 'Je hebt gewonnen!' : 'Je hebt verloren'}</h2>
      <p>Rematch? Klik Rematch — zodra beide spelers klikken start een nieuwe game met dezelfde lobby-code.</p>
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

  // save board and mark ready
  async function saveBoardReady(){
    if (!gameId) return;
    await set(ref(db, `games/${gameId}/players/${profile.uid}/board`), myBoard);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ships`), placedShips);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ready`), true);
    log('Je bent klaar');
    // check both ready (single read)
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.exists() ? gSnap.val() : {};
    const players = g.players || {};
    const ids = Object.keys(players);
    if (ids.length >= 2){
      const bothReady = ids.every(id => players[id].ready);
      if (bothReady){
        const starter = ids[Math.floor(Math.random()*ids.length)];
        await set(ref(db, `games/${gameId}/status`), 'in_progress');
        await set(ref(db, `games/${gameId}/turnUid`), starter);
        log('Game gestart');
      } else log('Wacht op tegenstander...');
    } else log('Wacht op tegenstander...');
  }

  // makeMove optimized: one read for target board & ships, local processing for sunk
  async function makeMove(cell){
    if (!gameId) return;
    // read current game metadata & players to get targetId
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.exists() ? gSnap.val() : {};
    const players = g.players || {};
    let targetId = null;
    for (const pid in players) if (pid !== profile.uid) targetId = pid;
    if (!targetId){ log('Geen tegenstander'); return; }

    const mvRef = push(ref(db, `games/${gameId}/moves`));
    await set(mvRef, { by: profile.uid, cell, ts: Date.now(), status:'processing' });

    // read target data once: board + ships
    const [boardSnap, shipsSnap] = await Promise.all([
      get(ref(db, `games/${gameId}/players/${targetId}/board`)),
      get(ref(db, `games/${gameId}/players/${targetId}/ships`))
    ]);
    const tBoard = boardSnap.exists() ? boardSnap.val() : {};
    const tShips = shipsSnap.exists() ? shipsSnap.val() : [];

    const cur = tBoard && tBoard[cell] ? tBoard[cell] : 'empty';
    let result = cur === 'ship' ? 'hit' : 'miss';
    // write single cell update via transaction to avoid race
    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, c => {
      if (!c || c === 'empty') return (result==='miss' ? 'miss' : 'hit');
      return; // already shot
    });

    // re-evaluate after transaction to get final value
    const finalSnap = await get(cellRef);
    const finalVal = finalSnap.val();
    result = finalVal;

    await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), result);
    log(`Schot op ${cell} => ${result}`);

    if (result === 'hit'){
      // find ship that contains this cell
      const ship = (tShips || []).find(s => (s.cells || []).includes(cell));
      if (ship){
        // check if all cells now hit (based on local tBoard + this hit)
        let allHit = true;
        for (const c of ship.cells){
          const st = (c === cell) ? 'hit' : (tBoard[c] || 'empty');
          if (st !== 'hit' && st !== 'sunk'){ allHit=false; break; }
        }
        if (allHit){
          // set all ship cells to sunk in one update
          const updates = {};
          for (const c of ship.cells){
            updates[`games/${gameId}/players/${targetId}/board/${c}`] = 'sunk';
            updates[`games/${gameId}/players/${profile.uid}/revealed/${c}`] = 'sunk';
          }
          await set(ref(db, `/`), updates);
          await set(ref(db, `games/${gameId}/moves/${mvRef.key}/sunkShipId`), ship.id || 'sunk');
          log('Ship gezonken!');
          S.sunk();
          if (mode === 'power'){
            await runTransaction(ref(db, `games/${gameId}/players/${profile.uid}/power`), cur => (cur||0)+1);
            log('Power verdiend!');
          }
        }
      }
      // turn rules
      if (mode === 'streak'){ await set(ref(db, `games/${gameId}/turnUid`), profile.uid); }
      else if (mode === 'salvo'){
        // in Salvo, we allow 2 shots per turn; handle by tracking moves per turn - simplified: keep turn if this was a hit and player's salvoShotsLeft > 1
        const meta = g.meta || {};
        const shotsLeft = (g.salvo && g.salvo[profile.uid] && g.salvo[profile.uid].shotsLeft) || 1;
        if (shotsLeft > 1){
          // decrement shotsLeft
          await set(ref(db, `games/${gameId}/salvo/${profile.uid}/shotsLeft`), shotsLeft-1);
          await set(ref(db, `games/${gameId}/turnUid`), profile.uid);
        } else {
          // switch
          await set(ref(db, `games/${gameId}/turnUid`), targetId);
        }
      } else {
        await set(ref(db, `games/${gameId}/turnUid`), targetId);
      }
    } else {
      // miss -> ensure stored
      await set(ref(db, `games/${gameId}/players/${targetId}/board/${cell}`), 'miss');
      // switch turn
      const next = (mode === 'salvo') ? profile.uid : targetId;
      // For salvo: if we implemented salvo shots, you'd decrement or switch; keep default switch for now
      await set(ref(db, `games/${gameId}/turnUid`), targetId);
    }

    // Victory check (single read)
    const targetBoardSnap = await get(ref(db, `games/${gameId}/players/${targetId}/board`));
    const tboard = targetBoardSnap.exists() ? targetBoardSnap.val() : {};
    const hasShipLeft = Object.values(tboard).some(v => v === 'ship');
    if (!hasShipLeft){
      await set(ref(db, `games/${gameId}/status`), 'finished');
      await set(ref(db, `games/${gameId}/winner`), profile.uid);
      log('Je hebt gewonnen!');
      S.win(); conf.spawn();
      if (!profile.guest) await incrementWinsForUid(profile.uid);
    }

    // finally refresh boards (debounced)
    refreshBoards();
  }

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
      await runTransaction(cellRef, cur => {
        if (!cur || cur === 'empty') return 'miss';
        if (cur === 'ship') return 'hit';
        return;
      });
    }
    await runTransaction(ref(db, `games/${gameId}/players/${profile.uid}/power`), cur => Math.max((cur||0)-1,0));
    await set(ref(db, `games/${gameId}/turnUid`), profile.uid);
    log('Powershot uitgevoerd');
    S.hit();
    refreshBoards();
  }

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
          // Fog mode: store revealed keys only; server should write revealed keys as players/{uid}/revealed if needed
          if (mode === 'fog' && b[k] === 'hit') {
            // fine: hit visible; otherwise opponent tiles remain hidden
            oppBoard[k] = b[k];
          }
        }
      }
    }
    renderBoards();
  }

  // board click handlers
  boardMeEl?.addEventListener('click', e=>{
    const t = e.target.closest('.tile'); if (!t) return; placeShipAt(t.dataset.cell);
  });

  boardOpEl?.addEventListener('click', async e=>{
    const t = e.target.closest('.tile'); if(!t) return;
    const cell = t.dataset.cell;
    if (awaitingPowerTarget && mode === 'power'){ awaitingPowerTarget=false; await powerShot(cell); return; }
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.exists() ? gSnap.val() : {};
    if (!g || g.status !== 'in_progress'){ log('Wacht tot spel gestart is'); return; }
    if (g.turnUid !== profile.uid){ log('Niet jouw beurt'); return; }
    const known = oppBoard[cell];
    if (known === 'hit' || known === 'miss' || known === 'sunk'){ log('Al geschoten'); return; }
    // Salvo: allow marking multiple shots in same turn? (simplified) — for now call makeMove
    if (mode === 'salvo'){
      // for salvo, allow two clicks per round: but keep server authoritative; we'll call makeMove twice
      await makeMove(cell);
    } else {
      await makeMove(cell);
    }
  });

  // buttons
  btnRandom?.addEventListener('click', randomPlaceAll);
  btnRotate?.addEventListener('click', ()=>{ orientation = orientation==='H' ? 'V' : 'H'; btnRotate.textContent = `Rotate (${orientation})`; });
  btnReady?.addEventListener('click', async ()=> { await saveBoardReady(); });
  if (btnPower){ btnPower.addEventListener('click', ()=>{ log('Klik op een cel in het vijandelijke bord om powershot uit te voeren'); awaitingPowerTarget = true; }); }

  // tutorial once
  (function maybeShowTutorial(){
    const seen = localStorage.getItem('zs_tutorial_seen_v2');
    if (seen) return;
    const txt = `<div style="text-align:left"><h3>Snelle speluitleg</h3>
      <ul>
        <li><b>Classic:</b> beurt wisselt altijd.</li>
        <li><b>Streak:</b> hit → extra beurt.</li>
        <li><b>Power:</b> sink ship → powershot (3×3).</li>
        <li><b>Fog:</b> beperkte zichtbaarheid — alleen nabij onthullingen zichtbaar.</li>
        <li><b>Salvo:</b> 2 schoten per beurt (sneller spel).</li>
      </ul><div style="text-align:center"><button id="ok-tut">Akkoord</button></div></div>`;
    showOverlay(txt);
    setTimeout(()=> { const b = document.getElementById('ok-tut'); if (b) b.onclick = ()=> { document.querySelector('.overlay').classList.add('hidden'); localStorage.setItem('zs_tutorial_seen_v2','1'); } },50);
  })();

  // start
  await initFromLobby().catch(err => { console.error(err); showSmall('Kon lobby niet laden: '+(err.message||err)); });
  await refreshBoards();
}
