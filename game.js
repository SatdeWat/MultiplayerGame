// game.js
// Centraal multiplayer script: maak/join lobbies, rematch flow, redirect naar juiste game pagina.
// Verwacht: firebase-config.js (export db), app-auth.js (loadLocalProfile, ensureUserProfileOnDb), game_core.js startGame(...)
// Gebruik als <script type="module" src="game.js"></script>

import { db } from "./firebase-config.js";
import { loadLocalProfile, ensureUserProfileOnDb } from "./app-auth.js";
import { ref, set, get, onValue, runTransaction, update, remove } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { startGame } from "./game_core.js"; // game_core exporteert startGame({ mode })

/* -------------------------
   Utilities & UI helpers
   ------------------------- */
const $ = id => document.getElementById(id);
const q = s => document.querySelector(s);
function createEl(tag, props = {}, ...children){
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) if (typeof c === 'string') el.appendChild(document.createTextNode(c)); else if (c) el.appendChild(c);
  return el;
}
function showOverlay(html){
  let o = document.querySelector('.overlay');
  if (!o){
    o = createEl('div', { className: 'overlay' });
    o.innerHTML = `<div class="overlay-inner"><div id="overlay-inner-content">${html}</div><div class="overlay-actions"><button id="overlay-close">OK</button></div></div>`;
    document.body.appendChild(o);
    document.getElementById('overlay-close').addEventListener('click', ()=> o.classList.add('hidden'));
  } else {
    o.classList.remove('hidden');
    document.getElementById('overlay-inner-content').innerHTML = html;
  }
}
function hideOverlay(){ const o = document.querySelector('.overlay'); if (o) o.classList.add('hidden'); }
function showToast(msg, timeout = 1800){
  let t = document.getElementById('gs-toast');
  if (!t){
    t = createEl('div', { id: 'gs-toast', className: 'card' });
    t.style.position = 'fixed';
    t.style.right = '18px';
    t.style.bottom = '18px';
    t.style.zIndex = 99999;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(()=> t.style.display = 'none', timeout);
}
function makeCode(len=6){ const chars="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s=""; for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s; }
function pageForMode(gm){
  if (gm === 'power') return 'game_power.html';
  if (gm === 'streak') return 'game_streak.html';
  if (gm === 'salvo') return 'game_salvo.html';
  return 'game_classic.html';
}

/* -------------------------
   Core lobby functions
   ------------------------- */

// create a lobby and associated game record
async function createLobby({ gamemode='classic', size=15 }){
  const profile = loadLocalProfile();
  if (!profile){ showOverlay('Je moet ingelogd zijn of als gast spelen.'); return; }

  const code = makeCode(6);
  const gameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;

  const players = {};
  players[profile.uid] = { username: profile.username, ready: false, slot: 0, power: 0 };

  // write lobby and game atomically using update
  const updates = {};
  updates[`lobbies/${code}`] = { gameId, owner: profile.uid, gamemode, size, createdAt: Date.now() };
  updates[`games/${gameId}`] = { players, status: 'waiting', gamemode, size, createdAt: Date.now() };

  await update(ref(db, '/'), updates);
  // ensure user profile exists in DB
  await ensureUserProfileOnDb(profile.uid, profile);

  // redirect to lobby page with code
  location.href = `lobby.html?code=${code}`;
}

// join a lobby: add player to games/{gameId}/players/{uid}
async function joinLobby(code){
  const profile = loadLocalProfile();
  if (!profile){ showOverlay('Je moet ingelogd zijn of als gast spelen.'); return; }
  if (!code) { showOverlay('Geef een lobby-code op.'); return; }
  // read lobby
  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if (!lobbySnap.exists()) { showOverlay('Lobby niet gevonden.'); return; }
  const lobby = lobbySnap.val();
  const gameId = lobby.gameId;
  if (!gameId) { showOverlay('Ongeldige lobby (geen gameId).'); return; }

  // check if already in players
  const playerSnap = await get(ref(db, `games/${gameId}/players/${profile.uid}`));
  if (playerSnap.exists()){
    // already joined -> redirect to lobby page
    location.href = `lobby.html?code=${code}`;
    return;
  }

  // add player node (slot assignment)
  const playersSnap = await get(ref(db, `games/${gameId}/players`));
  let slot = 1;
  if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;

  await set(ref(db, `games/${gameId}/players/${profile.uid}`), { username: profile.username, ready: false, slot, power: 0 });
  await ensureUserProfileOnDb(profile.uid, profile);

  // redirect to lobby
  location.href = `lobby.html?code=${code}`;
}

/* -------------------------
   Rematch flow helpers
   ------------------------- */

// mark rematch requested by this player
async function requestRematch(gameId, lobbyCode){
  const profile = loadLocalProfile();
  if (!profile) return;
  await set(ref(db, `games/${gameId}/rematchRequests/${profile.uid}`), true);
  showToast('Rematch aangevraagd');
  // we rely on listener elsewhere to act when both requests exist
}

// create new game with same lobby code (called when both request rematch)
async function createRematch(gameIdOld, lobbyCode){
  // read old game to copy settings & players
  const gSnap = await get(ref(db, `games/${gameIdOld}`));
  if (!gSnap.exists()) return null;
  const old = gSnap.val();
  const newGameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  const newPlayers = {};
  // copy players minimal info (username). ready etc reset.
  const playersObj = old.players || {};
  for (const pid in playersObj){
    const p = playersObj[pid];
    newPlayers[pid] = { username: p.username || 'speler', ready: false, slot: p.slot || 0, power: 0 };
  }
  // create new game node
  await set(ref(db, `games/${newGameId}`), { players: newPlayers, status: 'waiting', gamemode: old.gamemode, size: old.size, createdAt: Date.now(), rematchOf: gameIdOld });
  // update lobby to point to new gameId
  await set(ref(db, `lobbies/${lobbyCode}/gameId`), newGameId);
  return newGameId;
}

// watch rematchRequests on a game and if both players requested -> create new game
function watchRematchAndAutoCreate(gameId, lobbyCode){
  const remRef = ref(db, `games/${gameId}/rematchRequests`);
  onValue(remRef, async snap => {
    const v = snap.val() || {};
    const keys = Object.keys(v);
    // determine players in game
    const playersSnap = await get(ref(db, `games/${gameId}/players`));
    const players = playersSnap.exists() ? playersSnap.val() : {};
    const pCount = Object.keys(players).length;
    // only proceed when we have same count of rematch requests as players (i.e., all players requested)
    if (pCount > 0 && keys.length >= pCount){
      // create rematch
      try{
        const newGameId = await createRematch(gameId, lobbyCode);
        if (newGameId){
          // clear rematchRequests in old game after creating new game (optional)
          await set(ref(db, `games/${gameId}/rematchRequests`), null);
          // listeners on lobbies/{code} in clients will detect update and redirect automatically
          showToast('Rematch aangemaakt — redirecting...');
        }
      }catch(e){
        console.error('rematch create failed', e);
      }
    }
  });
}

/* -------------------------
   Lobby page behavior
   ------------------------- */

// when on lobby.html we expect query ?code=XXXX
async function initLobbyPage(){
  const qs = new URLSearchParams(location.search);
  const code = qs.get('code') || qs.get('lobby') || qs.get('gamecode');
  if (!code) return; // nothing to do

  const profile = loadLocalProfile();
  if (!profile){ showOverlay('Je moet ingelogd zijn of als gast spelen.'); return; }

  // hook UI elements when present
  const elCodeDisplay = $('lobby-code-display');
  if (elCodeDisplay) elCodeDisplay.textContent = code;
  const elCopy = $('btn-copy-lobby');
  if (elCopy) elCopy.addEventListener('click', ()=> { navigator.clipboard?.writeText(code).then(()=> showToast('Lobby code gekopieerd')); });

  // subscribe to lobby node
  const lobbyRef = ref(db, `lobbies/${code}`);
  onValue(lobbyRef, async snap => {
    const lobby = snap.exists() ? snap.val() : null;
    if (!lobby){
      // lobby removed
      showOverlay('Lobby is gesloten of ongeldig.');
      return;
    }
    const gameId = lobby.gameId;
    if (!gameId) return;
    // subscribe to game players/status info & rematch watch
    const gameRef = ref(db, `games/${gameId}`);
    onValue(gameRef, gsnap => {
      const g = gsnap.exists() ? gsnap.val() : null;
      if (!g) return;
      // update UI: players list
      const players = g.players || {};
      const playersEl = $('lobby-players');
      if (playersEl){
        playersEl.innerHTML = '';
        for (const pid in players){
          const p = players[pid];
          const line = createEl('div', { className: 'row' }, createEl('div', {}, p.username || pid), createEl('div', { className: 'muted' }, p.ready ? '✔️ Klaar' : '—'));
          playersEl.appendChild(line);
        }
      }
      // update ready badges top
      if ($('start-game-btn')){
        // only allow starting when owner and at least 2 players present
        if (lobby.owner === profile.uid && Object.keys(players).length >= 2){
          $('start-game-btn').disabled = false;
        } else if ($('start-game-btn')) $('start-game-btn').disabled = true;
      }
      // if game status is 'in_progress' or 'finished' and we are on a generic lobby page that should redirect to the correct game page:
      if (g.status === 'in_progress' || g.status === 'finished'){
        const page = pageForMode(g.gamemode || lobby.gamemode || 'classic');
        // redirect to the game page with lobby code as query param
        const currentPage = location.pathname.split('/').pop();
        if (currentPage !== page){
          location.href = `${page}?lobby=${code}`;
        }
      }
    });

    // setup rematch watching for ease
    // only trigger watchRematchAndAutoCreate once
    if ($('watch-rematch-marker') === null){
      const marker = createEl('div', { id: 'watch-rematch-marker', style: 'display:none' });
      document.body.appendChild(marker);
      watchRematchAndAutoCreate(lobby.gameId, code);
    }
  });

  // UI actions: leave lobby
  const leaveBtn = $('btn-leave-lobby');
  if (leaveBtn){
    leaveBtn.addEventListener('click', async ()=>{
      // remove this player from game's players list
      const gSnap = await get(ref(db, `lobbies/${code}`));
      if (!gSnap.exists()) { location.href='home.html'; return; }
      const gameId = gSnap.val().gameId;
      // remove node
      await set(ref(db, `games/${gameId}/players/${profile.uid}`), null);
      // optionally, if owner leaves we can transfer owner or delete lobby if empty
      const playersSnap = await get(ref(db, `games/${gameId}/players`));
      if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0){
        // delete lobby & game
        await set(ref(db, `lobbies/${code}`), null);
        await set(ref(db, `games/${gameId}`), null);
      } else {
        // if owner left and owner === profile.uid, set owner to any remaining player
        const lobbySnap = await get(ref(db, `lobbies/${code}`));
        if (lobbySnap.exists() && lobbySnap.val().owner === profile.uid){
          const remaining = Object.keys(playersSnap.val());
          await set(ref(db, `lobbies/${code}/owner`), remaining[0]);
        }
      }
      location.href = 'home.html';
    });
  }

  // Start game button (owner triggers start only if both players ready) - optional convenience
  const startBtn = $('start-game-btn');
  if (startBtn){
    startBtn.addEventListener('click', async ()=>{
      const lobbySnap = await get(ref(db, `lobbies/${code}`));
      if (!lobbySnap.exists()) return;
      const gameId = lobbySnap.val().gameId;
      const gSnap = await get(ref(db, `games/${gameId}`));
      const g = gSnap.exists() ? gSnap.val() : {};
      if (!g) return;
      // only owner can force-start
      if (lobbySnap.val().owner !== profile.uid){ showToast('Alleen de host kan starten'); return; }
      // if at least 2 players exist, set status to in_progress and choose random starter
      const players = g.players || {};
      if (Object.keys(players).length < 2){ showToast('Niet genoeg spelers'); return; }
      const starter = Object.keys(players)[Math.floor(Math.random() * Object.keys(players).length)];
      // set status & turnUid
      await set(ref(db, `games/${gameId}/status`), 'in_progress');
      await set(ref(db, `games/${gameId}/turnUid`), starter);
      showToast('Game gestart');
      // redirect to correct game page
      const page = pageForMode(g.gamemode || lobbySnap.val().gamemode || 'classic');
      location.href = `${page}?lobby=${code}`;
    });
  }
}

/* -------------------------
   Auto-redirect on game pages
   ------------------------- */

// If current page is one of game pages (game_classic/game_power/etc) we should initialize startGame
async function initGamePageIfNeeded(){
  const current = location.pathname.split('/').pop();
  const gamePages = ['game_classic.html','game_power.html','game_streak.html','game_salvo.html'];
  if (!gamePages.includes(current)) return;

  // determine mode from filename
  let mode = 'classic';
  if (current.includes('power')) mode = 'power';
  if (current.includes('streak')) mode = 'streak';
  if (current.includes('salvo')) mode = 'salvo';

  // pass through to game_core.startGame({ mode })
  try{
    await startGame({ mode });
  }catch(e){
    console.error('startGame failed', e);
    showOverlay('Kon het spel niet starten: ' + (e.message || e));
  }
}

/* -------------------------
   Simple index/home wiring (create/join)
   ------------------------- */
function initHomeInteractions(){
  const createBtns = document.querySelectorAll('[data-create-lobby]');
  createBtns.forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      const mode = btn.dataset.createLobby || 'classic';
      // size selection elements nearby may exist
      const sizeSelect = document.querySelector(`[data-size-for="${mode}"]`);
      const size = sizeSelect ? parseInt(sizeSelect.value,10) : (mode==='power' ? 20 : 15);
      await createLobby({ gamemode: mode, size });
    });
  });

  const joinBtn = $('btn-join-code');
  if (joinBtn){
    joinBtn.addEventListener('click', async ()=>{
      const code = $('join-code') ? $('join-code').value.trim() : null;
      if (!code){ showToast('Voer een lobby code in'); return; }
      await joinLobby(code);
    });
  }
}

/* -------------------------
   Initialization bootstrap
   ------------------------- */
document.addEventListener('DOMContentLoaded', async ()=>{
  const profile = loadLocalProfile();
  // update profile UI element if present
  const profileEl = $('profile-info');
  if (profileEl) profileEl.textContent = profile ? `${profile.username}${profile.guest ? ' (Gast)' : ''}` : 'Niet ingelogd';

  // If we're on lobby page -> init lobby behavior
  const path = location.pathname.split('/').pop();
  if (path === 'lobby.html'){
    await initLobbyPage();
  }

  // If on home/index -> init create/join wiring
  if (path === 'home.html' || path === 'index.html'){
    initHomeInteractions();
    // quick UX: auto-fill join input if came from query param
    const qs = new URLSearchParams(location.search);
    const code = qs.get('code') || qs.get('lobby');
    if (code && $('join-code')) $('join-code').value = code;
  }

  // If on a game page, initialize game_core
  await initGamePageIfNeeded();

  // Generic: listen for lobbies updates? (not necessary but useful)
});

/* -------------------------
   Export some helpers (optional)
   ------------------------- */
export { createLobby, joinLobby, requestRematch, createRematch, watchRematchAndAutoCreate };
