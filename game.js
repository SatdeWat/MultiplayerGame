// game.js — regelt lobby, ready, autostart en rematch flows
import { db } from "./firebase-config.js"; // haal db verbinding
import { loadLocalProfile, ensureUserProfileOnDb } from "./app-auth.js"; // eenvoudige auth helpers
import { ref, get, set, onValue, runTransaction, update, push, onChildAdded } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js"; // DB functies

// korte helpers
const $ = id => document.getElementById(id); // shortcut om element met id te pakken
const alpha = n => String.fromCharCode(65 + n); // 0->A, 1->B etc.
const cellName = (r,c) => `${alpha(r)}${c+1}`; // maak celnaam zoals "A1"
const makeCode = (len=6) => { const chars="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s=""; for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s; }; // makkelijke lobbycode-maker
const pageForMode = gm => gm === 'power' ? 'game_power.html' : gm === 'streak' ? 'game_streak.html' : gm === 'salvo' ? 'game_salvo.html' : 'game_classic.html'; // kies gamepagina op basis van mode

function showToast(msg, t=1800){ // klein berichtje onderin
  let el = document.getElementById('app-toast'); // zoek toast element
  if (!el){
    el = document.createElement('div'); el.id='app-toast'; el.className='card'; // maak element als 't nog niet bestaat
    el.style.position='fixed'; el.style.right='18px'; el.style.bottom='18px'; el.style.zIndex=99999; // stijl
    document.body.appendChild(el); // voeg toe aan pagina
  }
  el.textContent = msg; el.style.display='block'; // zet tekst en toon
  setTimeout(()=> el.style.display='none', t); // verberg na t ms
}

function showOverlay(html){ // simpele overlay box in het midden
  let o = document.querySelector('.overlay'); // check of overlay al bestaat
  if (!o){
    o = document.createElement('div'); o.className='overlay'; // maak overlay
    o.innerHTML = `<div class="overlay-inner"><div id="overlay-inner-content">${html}</div><div style="margin-top:12px"><button id="overlay-ok">OK</button></div></div>`; // inhoud + knop
    document.body.appendChild(o); // voeg toe
    document.getElementById('overlay-ok').addEventListener('click', ()=> o.classList.add('hidden')); // OK knop verbergt overlay
  } else {
    o.classList.remove('hidden'); document.getElementById('overlay-inner-content').innerHTML = html; // toon en zet tekst
  }
}

// Debounce voor rendering (voorkomt te vaak updaten)
function debounce(fn, wait=80){ let t=null; return (...args)=>{ if(t) clearTimeout(t); t=setTimeout(()=> { t=null; fn(...args); }, wait); }; }

// === Lobby placement + ready behaviour ===
async function initLobbyBehavior(){ // functie die we aanroept op lobby pagina
  const path = location.pathname.split('/').pop(); // huidige bestandsnaam
  if (path !== 'lobby.html') return; // als we niet op lobby.html zitten: stop

  const qs = new URLSearchParams(location.search); // lees ?code=...
  const code = qs.get('code') || qs.get('lobby'); // mogelijke querynamen
  if (!code){ showOverlay('Geen lobby-code opgegeven.'); return; } // foutmelding als geen code

  const profile = loadLocalProfile(); // laad lokaal opgeslagen profiel
  if (!profile){ showOverlay('Je moet inloggen of als gast spelen.'); return; } // als niet ingelogd => overlay en stop
  await ensureUserProfileOnDb(profile.uid, profile).catch(()=>{}); // maak profiel in DB als dat nog niet bestaat

  const lobbyRef = ref(db, `lobbies/${code}`); // referentie naar lobbies/{code}
  const codeDisplay = $('lobby-code-display'); if (codeDisplay) codeDisplay.textContent = code; // toon code
  const copyBtn = $('btn-copy-lobby'); if (copyBtn) copyBtn.onclick = ()=> navigator.clipboard?.writeText(code).then(()=> showToast('Lobby code gekopieerd')); // copy knop
  const leaveBtn = $('btn-leave-lobby'); if (leaveBtn) leaveBtn.onclick = async ()=>{ // leave knop
    const lobbySnap = await get(lobbyRef); if (!lobbySnap.exists()){ location.href='home.html'; return; } // als lobby weg redirect home
    const gameIdLocal = lobbySnap.val().gameId; if (gameIdLocal) await set(ref(db, `games/${gameIdLocal}/players/${profile.uid}`), null); // verwijder jezelf uit players
    location.href='home.html'; // ga naar home
  };

  // UI elementen
  const boardMe = $('board-me'); // waar je je eigen board ziet
  const btnRandomPlace = $('btn-random-place'); // random place knop
  const btnRotate = $('btn-rotate'); // rotate knop
  const btnReady = $('btn-ready'); // klaar knop
  const shipsListEl = $('ship-list'); // lijst met schepen
  const readyBadgeMe = $('ready-badge-me'); // tekst 'klaar' bij jezelf
  const readyBadgeOp = $('ready-badge-op'); // tekst 'klaar' bij tegenstander

  // lokale plaatsingsstaat
  let gameId = null; // word later gezet als we lobby lezen
  let size = 15; // standaard 15x15
  let shipSizes = [5,4,3,2]; // default schepen voor 15x15
  let orientation = 'H'; // H of V
  let myBoardLocal = {}; // lokaal board data (voor plaatsing)
  let myShipsLocal = []; // lokale schepen array
  let currentShipIndex = 0; // welke ship je nu plaatst

  // kleine render functie die snel updates plakt naar DOM (debounced)
  const renderBoards = debounce(()=>{
    if (!boardMe) return; // geen board aanwezig → niks doen
    Array.from(boardMe.children).forEach(tile=>{
      const id = tile.dataset.cell; // cell name zoals A1
      tile.className = 'tile sea'; // reset classes
      tile.innerHTML = ''; // reset inhoud
      const st = myBoardLocal[id] || 'empty'; // status uit local board
      if (st === 'ship') tile.classList.add('ship'); // laat eigen schip zien
      if (st === 'hit'){ tile.classList.add('hit'); tile.innerHTML='🔥'; } // hit emoji
      if (st === 'miss'){ tile.classList.add('miss'); tile.innerHTML='🌊'; } // miss emoji
      if (st === 'sunk'){ tile.classList.add('sunk'); tile.innerHTML='☠️'; } // sunk emoji
    });
  }, 40);

  // maak grid in DOM op basis van size
  function createGrid(el,n){
    if (!el) return; // als element niet bestaat, stop
    el.innerHTML = ''; el.classList.remove('cell-10','cell-15','cell-20'); // reset classes
    el.classList.add(`cell-${n}`); el.style.gridTemplateRows = `repeat(${n},1fr)`; // grid CSS
    for (let r=0;r<n;r++) for (let c=0;c<n;c++){
      const cell = document.createElement('div'); cell.className='tile sea'; cell.dataset.r=r; cell.dataset.c=c; cell.dataset.cell = cellName(r,c); // maak tile
      el.appendChild(cell); // voeg toe
    }
  }

  // zet shipSizes en initialiseer board
  function setShipSizesForBoard(n){
    size = n; // bewaar size
    createGrid(boardMe, size); // maak grid
    myBoardLocal = {}; myShipsLocal = []; currentShipIndex = 0; orientation = 'H'; // reset local data
    if (size === 10) shipSizes = [5,4,3]; // 10x10 → 3 schepen
    else if (size === 15) shipSizes = [5,4,3,2]; // 15x15 → 4 schepen
    else if (size === 20) shipSizes = [5,4,4,3,3,2]; // 20x20 → 6 schepen
    else shipSizes = [5,4,3,2]; // fallback
    for (let r=0;r<size;r++) for (let c=0;c<size;c++) myBoardLocal[cellName(r,c)]='empty'; // zet elke cel empty
    renderShipList(); renderBoards(); // update UI
  }

  function renderShipList(){
    if (!shipsListEl) return; shipsListEl.innerHTML = ''; // leeg maken
    shipSizes.forEach((s,i)=>{
      const pill = document.createElement('div'); pill.className='ship-pill' + (i===currentShipIndex ? ' active' : ''); pill.textContent = `Ship ${i+1} — ${s>0?s:'placed'}`; // tekst
      pill.onclick = ()=> { if (s>0) { currentShipIndex = i; renderShipList(); } }; // klik op ship selecteert deze
      shipsListEl.appendChild(pill); // toevoegen
    });
  }

  // check of een schip kan op (r,c) met lengte s en orientatie
  function canPlaceLocal(r,c,s,orient){
    const coords=[];
    for (let i=0;i<s;i++){
      const rr = r + (orient === 'V' ? i : 0);
      const cc = c + (orient === 'H' ? i : 0);
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) return null; // buiten grid → niet ok
      coords.push(cellName(rr,cc));
    }
    for (const k of coords) if (myBoardLocal[k] === 'ship') return null; // overlap → niet ok
    return coords; // ok → retourneer coords array
  }

  // plaats lokaal schip op een gekozen cel
  function placeShipLocalAtCell(cellId){
    const r = cellId.charCodeAt(0) - 65, c = parseInt(cellId.slice(1),10)-1; // zet A1 → r=0 c=0
    const s = shipSizes[currentShipIndex]; // lengte van huidig schip
    if (!s || s <= 0) { showToast('Geen schip geselecteerd'); return; } // niks te plaatsen
    const coords = canPlaceLocal(r,c,s,orientation); // kan we plaatsen?
    if (!coords){ showToast('Kan hier niet plaatsen'); return; } // niet ok
    coords.forEach(k => myBoardLocal[k] = 'ship'); // markeer cellen als ship
    myShipsLocal.push({ id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), cells: coords.slice(), size: s }); // voeg ship object toe
    shipSizes[currentShipIndex] = 0; // markeer als geplaatst
    while (currentShipIndex < shipSizes.length && shipSizes[currentShipIndex] === 0) currentShipIndex++; // schuif naar volgend ship
    renderShipList(); renderBoards(); // update UI
  }

  // willekeurig alle schepen plaatsen
  function randomPlaceLocalAll(){
    for (const k in myBoardLocal) myBoardLocal[k] = 'empty'; // reset board
    myShipsLocal = []; // clear ships
    const sizes = shipSizes.slice(); // copy sizes
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
    shipSizes = shipSizes.map(_=>0); // alle ships als geplaatst markeren
    renderShipList(); renderBoards(); // update UI
  }

  if (btnRandomPlace) btnRandomPlace.onclick = ()=> { randomPlaceLocalAll(); showToast('Random geplaatst'); }; // random knop
  if (btnRotate) btnRotate.onclick = ()=> { orientation = orientation === 'H' ? 'V' : 'H'; if (btnRotate) btnRotate.textContent = `Rotate (${orientation})`; }; // rotatie knop

  if (boardMe) boardMe.addEventListener('click', e => { // op eigen board klikken => plaats schip
    const t = e.target.closest('.tile'); if (!t) return;
    placeShipLocalAtCell(t.dataset.cell); // zet ship
  });

  // Helper: verberg plaatsings-controls zodra de speler klaar klikt
  function hidePlacementControls(){
    if (btnRandomPlace) btnRandomPlace.style.display = 'none'; // verberg random knop
    if (btnRotate) btnRotate.style.display = 'none'; // verberg rotate knop
    if (btnReady) btnReady.style.display = 'none'; // verberg ready knop
    if (shipsListEl) shipsListEl.style.display = 'none'; // verberg ship lijst
  }

  // Auto-start watcher: kijkt constant of alle spelers ready zijn *en* hun board+ships bestaan in DB
  let playersWatcherAttached = false;
  function attachAutoStartWatcherOnce(localGameId){
    if (playersWatcherAttached) return; playersWatcherAttached = true;
    const playersRef = ref(db, `games/${localGameId}/players`); // locatie players
    onValue(playersRef, async snap => {
      const players = snap.exists() ? snap.val() : {}; // alle spelers
      const pids = Object.keys(players);
      if (pids.length < 2) return; // nog geen tegenstander
      let allOk = true;
      for (const pid of pids){
        const p = players[pid] || {};
        if (!p.ready){ allOk = false; break; } // speler niet ready
        const boardSnap = await get(ref(db, `games/${localGameId}/players/${pid}/board`)); // check board bestaat
        const shipsSnap = await get(ref(db, `games/${localGameId}/players/${pid}/ships`)); // check ships bestaat
        if (!boardSnap.exists() || !shipsSnap.exists()){ allOk = false; break; } // nog niet alles geschreven
      }
      if (allOk){
        const gSnap = await get(ref(db, `games/${localGameId}/status`)); // status check
        const status = gSnap.exists() ? gSnap.val() : null;
        if (status !== 'in_progress'){ // als nog niet gestart → start
          const starter = pids[Math.floor(Math.random()*pids.length)]; // kies willekeurige starter
          await set(ref(db, `games/${localGameId}/status`), 'in_progress'); // zet status
          await set(ref(db, `games/${localGameId}/turnUid`), starter); // zet wie begint
          // Maakt salvo-initialisatie als nodig (hier vereenvoudigd)
          showToast('Allemaal klaar — spel gestart!'); // visuele feedback
        }
      }
    });
  }

  // Ready knop: schrijf jouw board + ships naar DB en zet ready=true, verberg controls lokaal
  if (btnReady) btnReady.addEventListener('click', async () => {
    const lobbySnap = await get(lobbyRef); if (!lobbySnap.exists()){ showOverlay('Lobby niet gevonden'); return; } // check lobby
    gameId = lobbySnap.val().gameId; if (!gameId){ showOverlay('Geen gameId'); return; } // check gameid
    const remaining = shipSizes.filter(x => x>0); if (remaining.length){ showToast('Plaats al je schepen of gebruik Random'); return; } // controle
    await set(ref(db, `games/${gameId}/players/${profile.uid}/board`), myBoardLocal); // schrijf board
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ships`), myShipsLocal); // schrijf ships
    await set(ref(db, `games/${gameId}/players/${profile.uid}/ready`), true); // markeer ready
    readyBadgeMe && (readyBadgeMe.textContent = '✔️ Klaar'); // visueel vinkje
    hidePlacementControls(); // verberg knoppen lokaal
    attachAutoStartWatcherOnce(gameId); // koppel watcher die auto-start regelt
    showToast('Je bent klaar — wacht op tegenstander'); // feedback
  });

  // luister naar lobby updates (players + status)
  onValue(lobbyRef, async snap => {
    const l = snap.exists() ? snap.val() : null; if (!l){ showOverlay('Lobby verwijderd'); return; } // lobby weg
    gameId = l.gameId; if (gameId) attachAutoStartWatcherOnce(gameId); // koppel watcher als gameId bekend

    // toon players in lobby-players DOM
    const gameRef = ref(db, `games/${gameId}`);
    onValue(gameRef, gsnap => {
      const g = gsnap.exists() ? gsnap.val() : null; if (!g) return;
      const players = g.players || {};
      const playersEl = $('lobby-players');
      if (playersEl){
        playersEl.innerHTML = ''; // leeg
        for (const pid in players){
          const p = players[pid];
          const name = p.username || pid; const ready = p.ready ? '✔️' : '';
          const line = document.createElement('div'); line.className='row'; line.style.justifyContent = 'space-between';
          const left = document.createElement('div'); left.textContent = name + (pid === profile.uid ? ' (Jij)' : '');
          const right = document.createElement('div'); right.textContent = ready;
          line.appendChild(left); line.appendChild(right);
          playersEl.appendChild(line);
        }
      }
      // als deze client al ready is (bijv. na refresh) verberg controls
      if (players[profile.uid] && players[profile.uid].ready){
        hidePlacementControls();
        readyBadgeMe && (readyBadgeMe.textContent = '✔️ Klaar');
      }
      // redirect naar game page zodra status in_progress
      if (g.status === 'in_progress'){
        const page = pageForMode(g.gamemode || l.gamemode || 'classic');
        location.href = `${page}?lobby=${code}`;
      }
    });
  });
}

// Start de lobby-behaviour als pagina geladen is
document.addEventListener('DOMContentLoaded', async () => {
  try{ await initLobbyBehavior(); } catch(e){ console.warn('initLobbyBehavior error', e); }
});
