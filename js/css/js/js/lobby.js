// js/lobby.js
import { db } from "./firebase-config.js";
import { ref, set, push, onValue, get, child, update } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { loadLocalProfile } from "./app-auth.js";

const getEl = id => document.getElementById(id);

function makeCode(len=6){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

async function createLobby(mode){
  const profile = loadLocalProfile() || { name:'Gast', username:`gast${Math.floor(Math.random()*9000)}`, id: makeCode(8) };
  const lobbyCode = makeCode(6);
  const gameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  const lobbyRef = ref(db, `lobbies/${lobbyCode}`);
  const gameRef = ref(db, `games/${gameId}`);

  // initial data
  await set(lobbyRef, {
    gameId,
    createdAt: Date.now(),
    status: "waiting",
    ownerUid: profile.id,
    gamemode: mode
  });

  const players = {};
  players[profile.id] = { name: profile.name, slot: 0, ready: false };

  await set(gameRef, {
    players,
    turnUid: null,
    status: "waiting",
    gamemode: mode,
    createdAt: Date.now()
  });

  return { lobbyCode, gameId };
}

async function joinLobby(lobbyCode){
  const profile = loadLocalProfile() || { name:'Gast', username:`gast${Math.floor(Math.random()*9000)}`, id: makeCode(8) };
  const lobbySnap = await get(ref(db, `lobbies/${lobbyCode}`));
  if (!lobbySnap.exists()) throw new Error('Lobby niet gevonden');
  const lobby = lobbySnap.val();
  const gameId = lobby.gameId;
  const gameRef = ref(db, `games/${gameId}/players/${profile.id}`);
  // determine slot
  const gameSnap = await get(ref(db, `games/${gameId}/players`));
  let slot = 1;
  if (!gameSnap.exists()) slot = 0;
  else {
    const keys = Object.keys(gameSnap.val());
    if (keys.length === 0) slot = 0;
    else slot = 1;
  }

  await set(gameRef, { name: profile.name, slot, ready:false });
  return { lobbyCode, gameId };
}

/* UI wiring */
if (getEl('create-lobby')){
  const createBtn = getEl('create-lobby'), joinBtn = getEl('join-lobby'), joinInput = getEl('join-code');
  const lobbyCodeEl = getEl('lobby-code'), lobbyStatus = getEl('lobby-status'), myLobby = getEl('my-lobby');
  const goToGameBtn = getEl('go-to-game');
  const modeSelect = getEl('gamemode');

  createBtn.addEventListener('click', async ()=>{
    createBtn.disabled = true;
    try {
      const mode = parseInt(modeSelect.value,10);
      const { lobbyCode, gameId } = await createLobby(mode);
      lobbyCodeEl.textContent = lobbyCode;
      myLobby.classList.remove('hidden');
      lobbyStatus.textContent = 'waiting for players';
      // listen for players -> when 2 players connected set status ready
      onValue(ref(db, `games/${gameId}/players`), snap=>{
        const v = snap.val() || {};
        const count = Object.keys(v).length;
        lobbyStatus.textContent = `${count} speler(s) in lobby`;
        if (count >= 2){
          // set lobby ready
          set(ref(db, `lobbies/${lobbyCode}/status`), 'ready');
          goToGameBtn.classList.remove('hidden');
        }
      });
      goToGameBtn.onclick = ()=> location.href = `game.html?lobby=${lobbyCode}`;
    } catch(e){
      alert('Fout bij aanmaken lobby: ' + e.message);
    }
    createBtn.disabled = false;
  });

  joinBtn.addEventListener('click', async ()=>{
    joinBtn.disabled = true;
    try {
      const code = joinInput.value.trim().toUpperCase();
      if (!code) { alert('Vul lobby code in'); joinBtn.disabled=false; return; }
      const { lobbyCode, gameId } = await joinLobby(code);
      alert('Join geslaagd! Je wordt doorgestuurd naar het spel.');
      location.href = `game.html?lobby=${lobbyCode}`;
    } catch(e){
      alert('Join mislukt: ' + e.message);
    }
    joinBtn.disabled = false;
  });
}
