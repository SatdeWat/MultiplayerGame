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

async function createLobby(mode){
  const profile = loadLocalProfile() || { name:"Gast", username:`gast${Math.floor(Math.random()*9000)}`, id: `guest${Math.floor(Math.random()*10000)}` };
  const lobbyCode = makeCode(6);
  const gameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  await set(ref(db, `lobbies/${lobbyCode}`), { gameId, createdAt: Date.now(), status: "waiting", ownerUid: profile.id, gamemode: mode });
  const players = {};
  players[profile.id] = { name: profile.name, slot: 0, ready: false };
  await set(ref(db, `games/${gameId}`), { players, turnUid: null, status: "waiting", gamemode: mode, createdAt: Date.now() });
  return { lobbyCode, gameId };
}

async function joinLobby(code){
  const profile = loadLocalProfile() || { name:"Gast", username:`gast${Math.floor(Math.random()*9000)}`, id: `guest${Math.floor(Math.random()*10000)}` };
  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if (!lobbySnap.exists()) throw new Error("Lobby niet gevonden");
  const lobby = lobbySnap.val(); const gameId = lobby.gameId;
  const playersSnap = await get(ref(db, `games/${gameId}/players`));
  let slot = 1;
  if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
  await set(ref(db, `games/${gameId}/players/${profile.id}`), { name: profile.name, slot, ready: false });
  return { lobbyCode: code, gameId };
}

/* UI wiring (index.html IDs) */
if ($("create-lobby")) {
  const createBtn = $("create-lobby"), joinBtn = $("join-lobby"), joinInput = $("join-code");
  const lobbyCodeEl = $("lobby-code"), lobbyStatus = $("lobby-status"), myLobby = $("my-lobby"), goBtn = $("go-to-game");
  const modeSelect = $("gamemode");

  createBtn.addEventListener("click", async () => {
    try {
      createBtn.disabled = true;
      const mode = parseInt(modeSelect.value, 10);
      const { lobbyCode, gameId } = await createLobby(mode);
      lobbyCodeEl.textContent = lobbyCode; myLobby.classList.remove("hidden"); lobbyStatus.textContent = "Wachten op speler...";
      const playersRef = ref(db, `games/${gameId}/players`);
      onValue(playersRef, snap => {
        const players = snap.val() || {}; const count = Object.keys(players).length;
        lobbyStatus.textContent = `${count} speler(s) in lobby`;
        if (count >= 2) { set(ref(db, `lobbies/${lobbyCode}/status`), "ready"); goBtn.classList.remove("hidden"); }
      });
      goBtn.onclick = () => location.href = `game.html?lobby=${lobbyCode}`;
    } catch(e){ alert("Fout: " + e.message); }
    createBtn.disabled = false;
  });

  joinBtn.addEventListener("click", async () => {
    try {
      joinBtn.disabled = true;
      const code = joinInput.value.trim().toUpperCase();
      if (!code) { alert("Vul lobby code in"); joinBtn.disabled = false; return; }
      await joinLobby(code);
      alert("Join geslaagd — je wordt doorgestuurd.");
      location.href = `game.html?lobby=${code}`;
    } catch(e){ alert("Join mislukt: " + e.message); }
    joinBtn.disabled = false;
  });
}
