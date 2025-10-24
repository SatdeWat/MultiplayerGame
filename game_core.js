// game_core.js — hoofd game logica: schieten, hits, sunk, win, animaties via kleine popups
import { db } from "./firebase-config.js"; // db
import { loadLocalProfile, ensureUserProfileOnDb, incrementGameResults } from "./app-auth.js"; // auth + stats
import { ref, get, set, onChildAdded, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js"; // db funcs

const $ = id => document.getElementById(id); // helper
const alpha = n => String.fromCharCode(65 + n); // 0->A
const cellName = (r,c) => `${alpha(r)}${c+1}`; // A1 etc

function shortPopup(msg){ const el = document.getElementById('short-popup'); if (!el) return; el.textContent = msg; el.style.display = 'block'; setTimeout(()=> el.style.display='none', 3000); } // 3s popup

// light sound utility (optie)
class Snd { constructor(){ this.ctx=null; try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ this.ctx=null; } } _play(f,d=0.08){ if(!this.ctx) return; const o=this.ctx.createOscillator(), g=this.ctx.createGain(); o.frequency.value=f; o.connect(g); g.connect(this.ctx.destination); g.gain.value=0.08; o.start(); g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + d); o.stop(this.ctx.currentTime + d + 0.02); } hit(){ this._play(420,0.12); } miss(){ this._play(260,0.12); } sunk(){ this._play(120,0.22); } win(){ this._play(880,0.18); } lose(){ this._play(150,0.18); } }
const S = new Snd(); // geluid instance

// main game starter
export async function startGame(){ // entrypoint
  const profile = loadLocalProfile(); if (!profile) { location.href='index.html'; return; } // require login
  await ensureUserProfileOnDb(profile.uid, profile).catch(()=>{}); // ensure profile in DB

  const qs = new URLSearchParams(location.search); const lobbyCode = qs.get('lobby') || qs.get('code'); if (!lobbyCode) { alert('Geen lobby code'); return; } // get code
  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`)); if (!lobbySnap.exists()) { alert('Lobby niet gevonden'); return; } // check lobby
  const gameId = lobbySnap.val().gameId; if (!gameId) { alert('Geen gameId'); return; } // get gameId

  // DOM refs
  const boardMeEl = $('board-me'), boardOpEl = $('board-op'), infoTurn = $('info-turn'), logEl = $('log'), readyBadgeMe = $('ready-badge-me');

  // load game meta
  const gMeta = (await get(ref(db, `games/${gameId}`))).val() || {}; const size = gMeta.size || 15; const mode = gMeta.gamemode || 'classic';

  // local state
  let myBoard = {}; let oppBoard = {}; let myShips = []; let oppId = null; let currentTurn = null;

  // create grids
  function createGrid(el,n){ el.innerHTML=''; el.classList.remove('cell-10','cell-15','cell-20'); el.classList.add(`cell-${n}`); el.style.gridTemplateRows = `repeat(${n},1fr)`; for(let r=0;r<n;r++) for(let c=0;c<n;c++){ const tile = document.createElement('div'); tile.className='tile sea'; tile.dataset.cell = cellName(r,c); el.appendChild(tile); } }
  createGrid(boardMeEl,size); createGrid(boardOpEl,size); // make boards

  // render function
  function renderBoards(){
    // my board
    Array.from(boardMeEl.children).forEach(tile => {
      const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML = '';
      const st = myBoard[id] || 'empty';
      if (st === 'ship') tile.classList.add('ship'); // show own ships
      if (st === 'hit'){ tile.classList.add('hit'); tile.innerHTML = '🔥'; } // hit
      if (st === 'miss'){ tile.classList.add('miss'); tile.innerHTML = '🌊'; } // miss
      if (st === 'sunk'){ tile.classList.add('sunk'); tile.innerHTML = '☠️'; } // sunk
    });
    // opp board
    Array.from(boardOpEl.children).forEach(tile => {
      const id = tile.dataset.cell; tile.className='tile sea'; tile.innerHTML = '';
      const st = oppBoard[id] || null;
      if (st === 'hit'){ tile.classList.add('hit'); tile.innerHTML = '🔥'; }
      if (st === 'miss'){ tile.classList.add('miss'); tile.innerHTML = '🌊'; }
      if (st === 'sunk'){ tile.classList.add('sunk'); tile.innerHTML = '☠️'; }
    });
  }

  // helper: log
  function log(msg){ if (!logEl) return; const d = document.createElement('div'); d.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; logEl.prepend(d); }

  // determine opponent id
  const playersSnap = await get(ref(db, `games/${gameId}/players`)); if (!playersSnap.exists()) { alert('Geen spelers'); return; } const playersObj = playersSnap.val(); for (const pid in playersObj) if (pid !== profile.uid) oppId = pid; // find opp

  // load my board & ships if present (after refresh)
  const meSnap = await get(ref(db, `games/${gameId}/players/${profile.uid}`)); if (meSnap.exists()){ const me = meSnap.val(); myBoard = me.board || myBoard; myShips = me.ships || myShips; if (me.ready) readyBadgeMe.textContent = '✔️ Klaar'; }

  // listen to move events (child added)
  onChildAdded(ref(db, `games/${gameId}/moves`), async snap => {
    const mv = snap.val(); if (!mv) return;
    // if move is by me -> reflect on oppBoard
    if (mv.by === profile.uid){
      const valSnap = await get(ref(db, `games/${gameId}/players/${oppId}/board/${mv.cell}`)); const val = valSnap.exists() ? valSnap.val() : mv.result;
      if (val === 'hit' || val === 'sunk') { oppBoard[mv.cell] = val; S.hit(); if (val === 'sunk') S.sunk(); shortPopup('Raak!'); }
      else if (val === 'miss'){ oppBoard[mv.cell] = 'miss'; S.miss(); shortPopup('Mis!'); }
    } else {
      // opponent shot on me
      const valSnap = await get(ref(db, `games/${gameId}/players/${profile.uid}/board/${mv.cell}`)); const val = valSnap.exists() ? valSnap.val() : mv.result;
      if (val === 'hit' || val === 'sunk') { myBoard[mv.cell] = val; S.hit(); if (val === 'sunk') S.sunk(); shortPopup('Tegenstander raakte jouw schip!'); }
      else if (val === 'miss'){ myBoard[mv.cell] = 'miss'; S.miss(); shortPopup('Tegenstander miste'); }
    }
    renderBoards();
  });

  // listen to status and turn changes
  onValue(ref(db, `games/${gameId}/status`), snap => { const s = snap.val(); if (s === 'finished') handleFinish(); }); // status
  onValue(ref(db, `games/${gameId}/turnUid`), snap => { currentTurn = snap.val(); if (infoTurn) infoTurn.textContent = `Beurt: ${currentTurn === profile.uid ? 'Jij' : 'Tegenstander'}`; if (currentTurn === profile.uid) log('Jouw beurt'); else log('Wacht op tegenstander'); }); // turn

  // count alive ships helper (used for victory)
  async function countAliveShipsFor(uid){
    const shipsSnap = await get(ref(db, `games/${gameId}/players/${uid}/ships`)); const boardSnap = await get(ref(db, `games/${gameId}/players/${uid}/board`));
    const ships = shipsSnap.exists()? shipsSnap.val() : []; const board = boardSnap.exists()? boardSnap.val() : {};
    let alive = 0; for (const sh of (ships||[])){ let sunk = true; for(const c of (sh.cells||[])){ const st = board[c] || 'empty'; if (st !== 'sunk') { sunk = false; break; } } if (!sunk) alive++; } return alive;
  }

  // make a move (shoot)
  async function makeMove(cell){
    const gSnap = await get(ref(db, `games/${gameId}`)); const g = gSnap.exists()? gSnap.val() : null; if (!g) return shortPopup('Game data niet beschikbaar');
    if (g.status !== 'in_progress') return shortPopup('Spel is niet actief'); if (g.turnUid !== profile.uid) return shortPopup('Niet jouw beurt');
    const targetId = oppId; if (!targetId) return shortPopup('Geen tegenstander');

    // create move node
    const mvRef = ref(db, `games/${gameId}/moves`).push ? ref(db, `games/${gameId}/moves`) : ref(db, `games/${gameId}/moves`); // compat
    // transactional update on target board cell
    const cellRef = ref(db, `games/${gameId}/players/${targetId}/board/${cell}`);
    await runTransaction(cellRef, cur => { if (!cur || cur === 'empty') return 'miss'; if (cur === 'ship') return 'hit'; return; }); // if not shot -> set miss or hit
    const finalSnap = await get(cellRef); const finalVal = finalSnap.exists()? finalSnap.val() : null; // read final value

    // append a simple move node (for listeners)
    await set(ref(db, `games/${gameId}/moves/${Date.now()}_${Math.floor(Math.random()*9999)}`), { by: profile.uid, cell, ts: Date.now(), result: finalVal }); // write move log

    if (finalVal === 'hit'){ shortPopup('Raak!'); S.hit(); } else if (finalVal === 'miss'){ shortPopup('Mis!'); S.miss(); } // feedback

    // if hit -> check sunk for that ship and mark 'sunk' if needed
    if (finalVal === 'hit'){
      const shipsSnap = await get(ref(db, `games/${gameId}/players/${targetId}/ships`)); const tShips = shipsSnap.exists()? shipsSnap.val() : [];
      const hitShip = (tShips||[]).find(s => (s.cells||[]).includes(cell));
      if (hitShip){
        let allHit = true;
        for (const c of hitShip.cells){ const st = (await get(ref(db, `games/${gameId}/players/${targetId}/board/${c}`))).val() || 'empty'; if (st !== 'hit' && st !== 'sunk'){ allHit = false; break; } }
        if (allHit){
          // mark all cells in that ship as 'sunk'
          for (const c of hitShip.cells){ await set(ref(db, `games/${gameId}/players/${targetId}/board/${c}`), 'sunk'); }
          shortPopup('Scheepje gezonken!'); S.sunk();
          // if power mode, award power to shooter
          if (mode === 'power'){
            const powRef = ref(db, `games/${gameId}/players/${profile.uid}/power`);
            const cur = (await get(powRef)).val() || 0; await set(powRef, cur+1);
          }
        }
      }
    }

    // turn rules
    if (mode === 'streak'){
      if (finalVal === 'hit' || finalVal === 'sunk') await set(ref(db, `games/${gameId}/turnUid`), profile.uid); else await set(ref(db, `games/${gameId}/turnUid`), oppId);
    } else {
      await set(ref(db, `games/${gameId}/turnUid`), oppId); // classic & power: switch turn
    }

    // victory check
    const hasLeft = (await get(ref(db, `games/${gameId}/players/${targetId}/board`))).exists() ? Object.values((await get(ref(db, `games/${gameId}/players/${targetId}/board`))).val()).some(v => v === 'ship') : false;
    if (!hasLeft){
      await set(ref(db, `games/${gameId}/status`), 'finished'); await set(ref(db, `games/${gameId}/winner`), profile.uid); shortPopup('Je hebt gewonnen!'); S.win();
      try{ await incrementGameResults(profile.uid, [targetId]); }catch(e){ console.warn('stats update failed', e); }
    }

    renderBoards(); // update UI
  }

  // UI: click on opponent board -> shoot
  boardOpEl.addEventListener('click', async e => { const t = e.target.closest('.tile'); if (!t) return; const cell = t.dataset.cell; const known = oppBoard[cell]; if (known === 'hit' || known === 'miss' || known === 'sunk'){ shortPopup('Al geschoten'); return; } await makeMove(cell); });

  // initial authoritative load of boards (in case of reload)
  async function refreshBoards(){
    const g = (await get(ref(db, `games/${gameId}`))).val() || {}; const players = g.players || {};
    for (const pid in players){
      const p = players[pid];
      if (pid === profile.uid){ const me = (await get(ref(db, `games/${gameId}/players/${pid}`))).val() || {}; myBoard = me.board || myBoard; myShips = me.ships || myShips; }
      else { const op = (await get(ref(db, `games/${gameId}/players/${pid}`))).val() || {}; const b = op.board || {}; for (const k in b){ if (b[k] === 'hit' || b[k] === 'miss' || b[k] === 'sunk') oppBoard[k] = b[k]; } }
    }
    renderBoards();
  }

  await refreshBoards(); // initial load

  // handle finish overlay + cleanup
  async function handleFinish(){
    const g = (await get(ref(db, `games/${gameId}`))).val() || {}; const winner = g.winner; const players = g.players || {}; const losers = []; for (const pid in players) if (pid !== winner) losers.push(pid);
    if (winner === profile.uid){ shortPopup('Gewonnen!'); S.win(); } else { shortPopup('Verloren'); S.lose(); }
    try{ await incrementGameResults(winner, losers); }catch(e){ console.warn('stats update failed', e); }
    // no immediate cleanup here; host or system may remove game later
  }
}
