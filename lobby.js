// lobby.js
import { db } from "./firebase-config.js";
import { ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { loadLocalProfile } from "./app-auth.js";

const $ = id => document.getElementById(id);

function makeCode(len=6){
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

async function createLobby(mode, profile){
  const lobbyCode = makeCode(6);
  const gameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  await set(ref(db, `lobbies/${lobbyCode}`), { gameId, createdAt: Date.now(), status: "waiting", ownerUid: profile.uid, gamemode: mode });
  const players = {};
  players[profile.uid] = { name: profile.username, slot: 0, ready:false };
  await set(ref(db, `games/${gameId}`), { players, turnUid: null, status: "waiting", gamemode: mode, createdAt: Date.now() });
  return { lobbyCode, gameId };
}

async function joinLobby(code, profile){
  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if (!lobbySnap.exists()) throw new Error('Lobby niet gevonden');
  const lobby = lobbySnap.val();
  const gameId = lobby.gameId;
  // add player
  const playersSnap = await get(ref(db, `games/${gameId}/players`));
  let slot = 1;
  if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
  await set(ref(db, `games/${gameId}/players/${profile.uid}`), { name: profile.username, slot, ready:false });
  return { lobbyCode: code, gameId };
}

/* UI wiring */
if ($('btn-create-lobby')) {
  const createBtn = $('btn-create-lobby'), joinBtn = $('btn-join-lobby'), joinInput = $('menu-join-code');
  const menuInfo = $('menu-info');
  const profile = loadLocalProfile();
  if (!profile){ alert('Je moet inloggen of als gast inloggen.'); location.reload(); }

  createBtn.addEventListener('click', async ()=>{
    try {
      createBtn.disabled = true;
      const mode = 10; // standaard; je kan uitbreiden naar keuzes
      const { lobbyCode } = await createLobby(mode, profile);
      // redirect to game page (lobby code)
      location.href = `game.html?lobby=${lobbyCode}`;
    } catch(e){ alert('Fout bij aanmaken: ' + e.message); }
    createBtn.disabled = false;
  });

  joinBtn.addEventListener('click', async ()=>{
    try {
      joinBtn.disabled = true;
      const code = joinInput.value.trim().toUpperCase();
      if (!code){ alert('Vul lobby code in'); joinBtn.disabled=false; return; }
      await joinLobby(code, profile);
      location.href = `game.html?lobby=${code}`;
    } catch(e){ alert('Join mislukt: ' + e.message); }
    joinBtn.disabled = false;
  });
}
