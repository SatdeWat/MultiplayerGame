// game_core.js — rematch-fix, better turn indicator, lobby-change listener
import { db } from "./firebase-config.js";
import { loadLocalProfile, incrementWinsForUid } from "./app-auth.js";
import { ref, get, set, onValue, update, push, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const $ = id => document.getElementById(id);
const alpha = n => String.fromCharCode(65 + n);
const cellName = (r,c) => `${alpha(r)}${c+1}`;

/* --- Sound & Confetti (same as before) --- */
class Snd {
  constructor(){ this.ctx = null; try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ this.ctx = null; } }
  _play(freq,type='sine',dur=0.08,gain=0.12){ if(!this.ctx) return; const o=this.ctx.createOscillator(), g=this.ctx.createGain(); o.type=type; o.frequency.value=freq; g.gain.value=gain; o.connect(g); g.connect(this.ctx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001,this.ctx.currentTime+dur); o.stop(this.ctx.currentTime+dur+0.02); }
  hit(){ this._play(420,'sawtooth',0.12,0.14) }
  miss(){ this._play(220,'sine',0.14,0.06) }
  sunk(){ this._play(140,'square',0.3,0.18); this._play(420,'sine',0.2,0.1) }
  win(){ this._play(880,'sine',0.18,0.18); this._play(660,'sine',0.28,0.12) }
  lose(){ this._play(150,'sine',0.2,0.14) }
}
const S = new Snd();

function createConfetti(){
  let canvas = document.getElementById('confetti-canvas');
  if (!canvas){ canvas = document.createElement('canvas'); canvas.id='confetti-canvas'; document.body.appendChild(canvas); }
  const ctx = canvas.getContext('2d');
  function fit(){ canvas.width = innerWidth; canvas.height = innerHeight; }
  fit(); window.addEventListener('resize', fit);
  const parts=[];
  function spawn(x=innerWidth/2,y=innerHeight/4,count=60){
    for(let i=0;i<count;i++) parts.push({x,y,vx:(Math.random()-0.5)*8,vy:Math.random()*-6-2,size:Math.random()*8+4,rot:Math.random()*360,vr:(Math.random()-0.5)*12,color:`hsl(${Math.floor(Math.random()*360)},70%,60%)`,life:120+Math.floor(Math.random()*60)});
  }
  function step(){ ctx.clearRect(0,0,canvas.width,canvas.height); for(let i=parts.length-1;i>=0;i--){ const p=parts[i]; p.vy+=0.18; p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr; p.life--; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180); ctx.fillStyle=p.color; ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6); ctx.restore(); if(p.life<=0||p.y>canvas.height+50) parts.splice(i,1); } requestAnimationFrame(step); }
  step();
  return { spawn };
}
const conf = createConfetti();

/* --- Main exported startGame --- */
export async function startGame({ mode }){
  const profile = loadLocalProfile();
  if (!profile) { location.href = "index.html"; return; }
  const qs = new URLSearchParams(location.search);
  const lobbyCode = qs.get('lobby');
  if (!lobbyCode) { alert('Geen lobby code'); return; }

  // UI refs
  const boardMeEl = $('board-me'), boardOpEl = $('board-op'), shipListEl = $('ship-list');
  const btnRandom = $('btn-random'), btnRotate = $('btn-rotate'), btnReady = $('btn-ready'), btnPower = $('btn-power');
  const infoTurn = $('info-turn'), infoPower = $('info-power'), logEl = $('log');
  const readyBadgeMe = $('ready-badge-me'), readyBadgeOp = $('ready-badge-op');

  // Add big turn indicator panel at top if not exists
  (function ensureTurnBadge(){
    let tb = document.getElementById('turn-badge-global');
    if (!tb){
      const container = document.createElement('div');
      container.style.display='flex'; container.style.justifyContent='center'; container.style.margin='8px 0';
      container.innerHTML = `<div id="turn-badge-global" class="turn-badge">Beurt: -</div>`;
      document.querySelector('main .topbar')?.after(container);
      tb = document.getElementById('turn-badge-global');
    }
  })();
  const turnBadge = document.getElementById('turn-badge-global');

  // state
  let gameId = null; let size = 10; const myId = profile.uid;
  let myBoard = {}, oppBoard = {}; let shipSizes = [5,4,3]; let placedShips = []; let currentShipIndex = 0;
  let orientation = 'H'; let awaitingPowerTarget = false; let cleanupTimeoutHandle = null;
  let rematchRequests = {};

  function log(msg){ if (!logEl) return; const d=document.createElement('div'); d.textContent=`${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }

  function createGrid(el,n){ el.innerHTML=''; el.classList.remove('cell-5','cell-10','cell-15','cell-20'); el.classList.add(`cell-${n}`); el.style.gridTemplateRows=`repeat(${n},1fr)`; for(let r=0;r<n;r++) for(let c=0;c<n;c++){ const tile=document.createElement('div'); tile.className='tile sea'; tile.dataset.r=r; tile.dataset.c=c; tile.dataset.cell=cellName(r,c); el.appendChild(tile); } }

  function setSizes(s){
    size=s; createGrid(boardMeEl,size); createGrid(boardOpEl,size); placedShips=[]; currentShipIndex=0; orientation='H';
    if (mode==='power' && size===20) shipSizes=[5,4,4,3,3,2];
    else if (size<=5) shipSizes=[3,2,2];
    else shipSizes=[5,4,3];
    myBoard={}; oppBoard={}; for(let r=0;r<size;r++) for(let c=0;c<size;c++) myBoard[cellName(r,c)]='empty';
    renderShipList(); renderBoards();
  }

  function renderBoards(){
    if (boardMeEl) Array.from(boardMeEl.children).forEach(tile=>{ const id=tile.dataset.cell; tile.className='tile sea'; tile.innerHTML=''; if (myBoard[id]==='ship') tile.classList.add('ship'); if (myBoard[id]==='hit'){ tile.classList.add('hit'); tile.innerHTML='💥'; } if (myBoard[id]==='miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; } if (myBoard[id]==='sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; } });
    if (boardOpEl) Array.from(boardOpEl.children).forEach(tile=>{ const id=tile.dataset.cell; tile.className='tile sea'; tile.innerHTML=''; if (oppBoard[id]==='hit'){ tile.classList.add('hit'); tile.innerHTML='🔥'; } if (oppBoard[id]==='miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; } if (oppBoard[id]==='sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; } });
  }

  function renderShipList(){
    if (!shipListEl) return; shipListEl.innerHTML=''; shipSizes.forEach((s,i)=>{ const pill=document.createElement('div'); pill.className='ship-pill'+(i===currentShipIndex?' active':''); pill.textContent=`Ship ${i+1} — ${s>0?s:'placed'}`; pill.onclick=()=>{ if (s>0){ currentShipIndex=i; renderShipList(); } }; shipListEl.appendChild(pill); });
  }

  function canPlace(r,c,s,orient){ const coords=[]; for(let i=0;i<s;i++){ const rr=r+(orient==='V'?i:0), cc=c+(orient==='H'?i:0); if (rr<0||rr>=size||cc<0||cc>=size) return null; coords.push(cellName(rr,cc)); } for(const k of coords) if (myBoard[k]==='ship') return null; return coords; }

  function placeShipAt(cellId){ const r=cellId.charCodeAt(0)-65, c=parseInt(cellId.slice(1),10)-1; const s=shipSizes[currentShipIndex]; if (!s||s<=0){ log('Geen schip geselecteerd'); return; } const coords=canPlace(r,c,s,orientation); if (!coords){ log('Kan hier niet plaatsen'); return; } coords.forEach(k=> myBoard[k]='ship'); placedShips.push({ id:'ship_'+Date.now(), cells:coords, size:s }); shipSizes[currentShipIndex]=0; while(currentShipIndex<shipSizes.length && shipSizes[currentShipIndex]===0) currentShipIndex++; renderShipList(); renderBoards(); }

  function randomPlaceAll(){ for(const k in myBoard) myBoard[k]='empty'; placedShips=[]; const sizes=shipSizes.slice().filter(x=>x>0); for(const s of sizes){ let tries=0, placed=false; while(!placed && tries<1000){ const r=Math.floor(Math.random()*size), c=Math.floor(Math.random()*size); const o=Math.random()<0.5?'H':'V'; const coords=canPlace(r,c,s,o); if (coords){ coords.forEach(k=> myBoard[k]='ship'); placedShips.push({ id:'ship_'+Date.now(), cells:coords, size:s }); placed=true; } tries++; } } for(let i=0;i<shipSizes.length;i++) shipSizes[i]=0; renderShipList(); renderBoards(); }

  /* DB: listen on lobby for rematch/new game id changes */
  let currentLobbyGameId = null;
  onValue(ref(db, `lobbies/${lobbyCode}`), snap => {
    const lobby = snap.exists() ? snap.val() : null;
    if (!lobby) return;
    if (!currentLobbyGameId) currentLobbyGameId = lobby.gameId;
    else {
      // lobby.gameId may change on rematch -> redirect to new game id page
      if (lobby.gameId && lobby.gameId !== currentLobbyGameId){
        // redirect to the game page for the current gamemode
        const gm = lobby.gamemode || mode || 'classic';
        const target = gm === 'power' ? 'game_power.html' : (gm === 'streak' ? 'game_streak.html' : 'game_classic.html');
        // force redirect to new game
        location.href = `${target}?lobby=${lobbyCode}`;
      }
    }
  });

  async function initFromLobby(){
    const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
    if (!lobbySnap.exists()) throw new Error('Lobby niet gevonden');
    const lobby = lobbySnap.val();
    currentLobbyGameId = lobby.gameId;
    gameId = lobby.gameId;
    const sizeFromLobby = lobby.size || (lobby.gamemode==='power'?20:10);
    setSizes(sizeFromLobby);
    const meRef = ref(db, `games/${gameId}/players/${profile.uid}`);
    const meSnap = await get(meRef);
    if (!meSnap.exists()){
      const playersSnap = await get(ref(db, `games/${gameId}/players`));
      let slot = 1; if (!playersSnap.exists() || Object.keys(playersSnap.val()).length===0) slot=0;
      await set(meRef, { username: profile.username, ready:false, slot });
    }

    // players listener
    onValue(ref(db, `games/${gameId}/players`), snap => {
      const players = snap.val() || {};
      readyBadgeMe.textContent = players[profile.uid] && players[profile.uid].ready ? '✔️ Klaar' : '';
      let oppFound=false;
      for(const pid in players) if (pid !== profile.uid){ oppFound=true; readyBadgeOp.textContent = players[pid].ready ? '✔️ Klaar':''; }
      if (!oppFound) readyBadgeOp.textContent = '';
    });

    // game state listener
    onValue(ref(db, `games/${gameId}`), async snap => {
      const g = snap.val() || {};
      if (g.turnUid){
        const isMine = g.turnUid === profile.uid;
        turnBadge && (turnBadge.textContent = `Beurt: ${isMine ? 'Jij' : 'Tegenstander'}`);
        if (isMine) turnBadge.classList.add('pulse'); else turnBadge.classList.remove('pulse');
      }
      if (g.status === 'in_progress') {
        await refreshBoards();
        if (cleanupTimeoutHandle){ clearTimeout(cleanupTimeoutHandle); cleanupTimeoutHandle = null; }
      }
      if (g.status === 'finished'){
        const winner = g.winner;
        if (winner === profile.uid){
          S.win(); conf.spawn();
          showRematchOverlay(true);
        } else {
          S.lose();
          showRematchOverlay(false);
        }
        // cleanup after 2 minutes if no rematch
        if (cleanupTimeoutHandle) clearTimeout(cleanupTimeoutHandle);
        cleanupTimeoutHandle = setTimeout(async ()=>{
          try { await set(ref(db, `lobbies/${lobbyCode}`), null); await set(ref(db, `games/${gameId}`), null); } catch(e){ console.warn('cleanup err', e); }
        }, 120000);
      }
    });

    // moves listener
    onValue(ref(db, `games/${gameId}/moves`), snap => {
      const moves = snap.val() || {};
      const keys = Object.keys(moves);
      if (!keys.length) return;
      const last = moves[keys[keys.length-1]];
      if (last.result === 'hit') S.hit();
      if (last.result === 'miss') S.miss();
      if (last.result === 'sunk') S.sunk();
      log(`Move: ${last.by} -> ${last.cell} (${last.result || '...'})`);
      setTimeout(()=> refreshBoards(), 300);
    });

    // power count listener
    onValue(ref(db, `games/${gameId}/players/${profile.uid}/power`), snap=>{
      const v = snap.val() || 0;
      if (infoPower) infoPower.textContent = v;
      if (btnPower) btnPower.disabled = !(v>0);
    });

    // rematchRequests listener - when both true -> create new game and update lobby
    onValue(ref(db, `games/${gameId}/rematchRequests`), async snap => {
      const rr = snap.val() || {};
      rematchRequests = rr;
      const keys = Object.keys(rr || {});
      if (keys.length >= 2){
        // create new game and update same lobby code so both clients will redirect via lobby watcher
        try {
          const oldGameSnap = await get(ref(db, `games/${gameId}`));
          const oldGame = oldGameSnap.exists() ? oldGameSnap.val() : {};
          const newGameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
          // build players reset
          const playersSnap = await get(ref(db, `games/${gameId}/players`));
          const players = playersSnap.exists() ? playersSnap.val() : {};
          const newPlayers = {};
          for (const pid in players) newPlayers[pid] = { username: players[pid].username, ready:false, slot:players[pid].slot || 0 };
          await set(ref(db, `games/${newGameId}`), { players: newPlayers, status: 'waiting', gamemode: oldGame.gamemode || mode, size: oldGame.size || size, createdAt: Date.now() });
          // update lobby to point to the new gameId (same code)
          await set(ref(db, `lobbies/${lobbyCode}`), { gameId: newGameId, owner: oldGame.owner || Object.keys(newPlayers)[0], gamemode: oldGame.gamemode || mode, size: oldGame.size || size });
          // cleanup old game after a short delay
          setTimeout(async ()=> { try { await set(ref(db, `games/${gameId}`), null); } catch(e){console.warn('old-game cleanup', e);} }, 5000);
        } catch(e){ console.error('rematch create error', e); }
      }
    });
  }

  function showRematchOverlay(didWin){
    const html = `<div style="text-align:center"><h2>${didWin ? 'Je hebt gewonnen!' : 'Je hebt verloren'}</h2>
      <p>Kies rematch om direct opnieuw te beginnen met dezelfde lobby-code.</p>
      <div class="rematch-bar"><button id="rematch-yes">Rematch</button><button id="rematch-no" class="ghost">Terug naar home</button></div></div>`;
    showOverlay(html);
    setTimeout(()=>{
      const yes = document.getElementById('rematch-yes');
      const no = document.getElementById('rematch-no');
      if (yes) yes.onclick = async ()=>{
        await set(ref(db, `games/${gameId}/rematchRequests/${profile.uid}`), true);
        showSmall('Rematch-request verzonden — wachten op tegenstander...');
      };
      if (no) no.onclick = ()=> location.href='home.html';
    },50);
  }

  function showOverlay(innerHtml){
    let overlay = document.querySelector('.overlay');
    if (!overlay){ overlay = document.createElement('div'); overlay.className='overlay'; overlay.innerHTML = `<div class="overlay-inner"><div id="overlay-inner-content">${innerHtml}</div><div class="overlay-actions"><button id="overlay-close">OK</button></div></div>`; document.body.appendChild(overlay); document.getElementById('overlay-close').addEventListener('click', ()=> overlay.classList.add('hidden')); } else { overlay.classList.remove('hidden'); document.getElementById('overlay-inner-content').innerHTML = innerHtml; } 
  }
  function showSmall(msg){ const overlay = document.querySelector('.overlay'); if (!overlay) alert(msg); else { overlay.classList.remove('hidden'); document.getElementById('overlay-inner-content').innerHTML = `<div>${msg}</div>`; setTimeout(()=> overlay.classList.add('hidden'),1400); } }

  async function saveBoardReady(){
    if (!gameId) return;
    await set(ref(db, `games/${gameId}/players/${profile.uid}/board`), myBoard);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ships`), placedShips);
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ready`), true);
    log('Je bent klaar');
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
      } else log('Wacht op tegenstander...');
    } else log('Wacht op tegenstander...');
  }

  async function makeMove(cell){
    if (!gameId) return;
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val() || {};
    const players = g.players || {};
    let targetId = null;
    for (const pid in players) if (pid !== profile.uid) targetId = pid;
    if (!targetId){ log('Geen tegenstander'); return; }

    const mvRef = push(ref(db, `games/${gameId}/moves`));
    await set(mvRef, { by: profile.uid, cell, ts: Date.now(), status:'processing' });

    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, cur => {
      if (!cur || cur === 'empty') return 'miss';
      if (cur === 'ship') return 'hit';
      return;
    });
    const resSnap = await get(cellRef);
    const result = resSnap.val();
    await set(ref(db, `games/${gameId}/moves/${mvRef.key}/result`), result);
    log(`Schot op ${cell} => ${result}`);

    if (result === 'hit'){
      const shipsSnap = await get(ref(db, `games/${gameId}/players/${targetId}/ships`));
      const ships = shipsSnap.exists() ? shipsSnap.val() : [];
      const ship = ships.find(s => s.cells && s.cells.includes(cell));
      if (ship){
        let allHit = true;
        for (const c of ship.cells){
          const st = (await get(ref(db, `games/${gameId}/players/${targetId}/board/${c}`))).val();
          if (st !== 'hit' && st !== 'sunk'){ allHit=false; break; }
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
          S.sunk();
          if (mode === 'power'){
            await runTransaction(ref(db, `games/${gameId}/players/${profile.uid}/power`), cur => (cur||0)+1);
            log('Power verdiend!');
          }
        }
      }
      if (mode === 'streak'){
        await set(ref(db, `games/${gameId}/turnUid`), profile.uid);
      } else if (mode === 'classic'){
        await set(ref(db, `games/${gameId}/turnUid`), targetId);
      } else if (mode === 'power'){
        await set(ref(db, `games/${gameId}/turnUid`), targetId);
      }
    } else {
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
      S.win(); conf.spawn();
      if (!profile.guest) await incrementWinsForUid(profile.uid);
    }
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
        for (const k in b){
          if (b[k] === 'hit' || b[k] === 'miss' || b[k] === 'sunk') oppBoard[k] = b[k];
        }
      }
    }
    renderBoards();
  }

  // UI events
  boardMeEl?.addEventListener('click', e=>{
    const t = e.target.closest('.tile'); if (!t) return; placeShipAt(t.dataset.cell);
  });

  boardOpEl?.addEventListener('click', async e=>{
    const t = e.target.closest('.tile'); if(!t) return;
    const cell = t.dataset.cell;
    if (awaitingPowerTarget && mode === 'power'){
      awaitingPowerTarget = false;
      await powerShot(cell);
      return;
    }
    const gSnap = await get(ref(db, `games/${gameId}`));
    const g = gSnap.val() || {};
    if (!g) return;
    if (g.status !== 'in_progress'){ log('Wacht tot spel gestart is'); return; }
    if (g.turnUid !== profile.uid){ log('Niet jouw beurt'); return; }
    const known = oppBoard[cell];
    if (known === 'hit' || known === 'miss' || known === 'sunk'){ log('Al geschoten'); return; }
    await makeMove(cell);
  });

  btnRandom?.addEventListener('click', randomPlaceAll);
  btnRotate?.addEventListener('click', ()=>{ orientation = orientation==='H' ? 'V' : 'H'; btnRotate.textContent = `Rotate (${orientation})`; });
  btnReady?.addEventListener('click', async ()=> { await saveBoardReady(); });

  if (btnPower){ btnPower.addEventListener('click', ()=>{ log('Klik op een cel in het vijandelijke bord om powershot uit te voeren'); awaitingPowerTarget = true; }); }

  // tutorial show once
  (function maybeShowTutorial(){
    const seen = localStorage.getItem('zs_tutorial_seen_v1');
    if (seen) return;
    const tutorialHtml = `<div class="tutorial"><h2>How to play — quick</h2>
      <ul>
        <li>Maak of join een lobby.</li>
        <li>Plaats je schepen handmatig of kies <strong>Random</strong>.</li>
        <li>Klik <strong>Klaar</strong> als je klaar bent; als beide spelers klaar zijn start het spel.</li>
        <li><strong>Classic:</strong> beurt wisselt altijd.</li>
        <li><strong>Streak:</strong> hit → je krijgt direct nog een beurt.</li>
        <li><strong>Power:</strong> sink ship → verdien 1 powershot (3×3 reveal). Gebruik 'Gebruik Powershot' en klik op 1 cel in vijandelijk bord.</li>
      </ul>
      <div style="text-align:center"><button id="tutorial-ok">Akkoord</button></div></div>`;
    showOverlay(tutorialHtml);
    setTimeout(()=>{ const ok = document.getElementById('tutorial-ok'); if (ok) ok.onclick = ()=> { document.querySelector('.overlay').classList.add('hidden'); localStorage.setItem('zs_tutorial_seen_v1','1'); }; },50);
  })();

  // init
  await initFromLobby().catch(err=>{ console.error(err); showSmall('Kon lobby niet laden: '+(err.message||err)); });
  await refreshBoards();
}
