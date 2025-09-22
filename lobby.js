// lobby.js
import { db } from "./firebase-config.js";
import { loadLocalProfile } from "./app-auth.js";
import { ref, set, onValue, get } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const profile = loadLocalProfile();
const $ = id => document.getElementById(id);

const status = $("status-msg");
const joinInput = $("join-code");
const btnCreate = $("btn-create");
const btnJoin = $("btn-join");
const lobbyList = $("lobby-list");

// If no profile: disable buttons and show text (no popups)
if (!profile) {
  status.textContent = "Log in of speel als gast om lobbies te maken/joinen.";
  btnCreate.disabled = true; btnJoin.disabled = true; joinInput.disabled = true;
} else {
  status.textContent = "";
  btnCreate.disabled = false; btnJoin.disabled = false; joinInput.disabled = false;
}

function makeCode(len=6){
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

btnCreate?.addEventListener("click", async ()=>{
  if (!profile) return;
  const code = makeCode(6);
  const gameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  // create lobby + game node
  await set(ref(db, `lobbies/${code}`), { gameId, createdAt: Date.now(), owner: profile.uid, gamemode: 10 });
  const players = {}; players[profile.uid] = { username: profile.username, ready: false, slot: 0 };
  await set(ref(db, `games/${gameId}`), { players, status: "waiting", createdAt: Date.now() });
  location.href = `game.html?lobby=${code}`;
});

btnJoin?.addEventListener("click", async ()=>{
  if (!profile) return;
  const code = joinInput.value.trim().toUpperCase();
  if (!code) { status.textContent = "Vul een lobby code in"; return; }
  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if (!lobbySnap.exists()) { status.textContent = "Lobby niet gevonden"; return; }
  const lobby = lobbySnap.val();
  const gameId = lobby.gameId;
  // add player to game
  await set(ref(db, `games/${gameId}/players/${profile.uid}`), { username: profile.username, ready: false, slot: 1 });
  location.href = `game.html?lobby=${code}`;
});

// live lobby list
const lobbiesRef = ref(db, "lobbies");
onValue(lobbiesRef, snap=>{
  lobbyList.innerHTML = "";
  snap.forEach(child=>{
    const v = child.val();
    const entry = document.createElement("div");
    entry.className = "lobby-row";
    entry.textContent = `${child.key} — gamemode: ${v.gamemode || 10}`;
    entry.addEventListener("click", ()=> { joinInput.value = child.key; });
    lobbyList.appendChild(entry);
  });
});
