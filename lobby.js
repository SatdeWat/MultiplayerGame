// lobby.js
import { db } from "./firebase-config.js";
import { ref, set, get, onValue, push } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { loadLocalProfile, clearLocalProfile } from "./app-auth.js";

const $ = id => document.getElementById(id);

function makeCode(len=6){
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

async function createLobby(mode){
  const profile = loadLocalProfile() || { username:`gast${Math.floor(Math.random()*9000)}`, id: `guest${Date.now()}` };
  const lobbyCode = makeCode(6);
  const gameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  await set(ref(db, `lobbies/${lobbyCode}`), { gameId, createdAt: Date.now(), status: "waiting", ownerUid: profile.id, gamemode: mode });
  const players = {};
  players[profile.id] = { username: profile.username, slot: 0, ready: false };
  await set(ref(db, `games/${gameId}`), { players, turnUid: null, status: "waiting", gamemode: mode, createdAt: Date.now() });
  return { lobbyCode, gameId };
}

async function joinLobby(code){
  const profile = loadLocalProfile() || { username:`gast${Math.floor(Math.random()*9000)}`, id: `guest${Date.now()}` };
  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if (!lobbySnap.exists()) throw new Error("Lobby niet gevonden");
  const lobby = lobbySnap.val(); const gameId = lobby.gameId;
  const playersSnap = await get(ref(db, `games/${gameId}/players`));
  let slot = 1;
  if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) slot = 0;
  await set(ref(db, `games/${gameId}/players/${profile.id}`), { username: profile.username, slot, ready: false });
  return { lobbyCode: code, gameId };
}

/* --- UI wiring: show/hide menu based on login --- */
function initUI() {
  const profile = loadLocalProfile();
  const authArea = $("auth-area");
  const appMenu = $("app-menu");
  const lobbyCard = $("lobby-card");
  const leaderboardCard = $("leaderboard-card");

  const menuUsername = $("menu-username");
  const btnLogout = $("btn-logout");
  const btnOpenLobby = $("btn-open-lobby");
  const btnOpenLeaderboard = $("btn-open-leaderboard");
  const btnBack = $("btn-back-to-menu");

  if (!profile) {
    // show auth
    if (authArea) authArea.classList.remove("hidden");
    if (appMenu) appMenu.classList.add("hidden");
    if (lobbyCard) lobbyCard.classList.add("hidden");
    if (leaderboardCard) leaderboardCard.classList.add("hidden");
    return;
  }

  // hide auth, show app menu
  if (authArea) authArea.classList.add("hidden");
  if (appMenu) appMenu.classList.remove("hidden");
  if (menuUsername) menuUsername.textContent = profile.username || profile.id;

  btnOpenLobby.addEventListener("click", ()=> {
    $("lobby-card").classList.remove("hidden");
    $("leaderboard-card").classList.add("hidden");
  });
  btnOpenLeaderboard.addEventListener("click", async ()=> {
    $("leaderboard-card").classList.remove("hidden");
    $("lobby-card").classList.add("hidden");
    await renderLeaderboard();
  });
  btnBack.addEventListener("click", ()=> {
    $("leaderboard-card").classList.add("hidden");
  });

  btnLogout.addEventListener("click", ()=> {
    clearLocalProfile();
    location.reload();
  });
}

/* WIRING LOBBY UI (create/join) */
if ($("create-lobby")) {
  initUI();

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

/* LEADERBOARD: toon top 20 users by wins (exclude guests) */
async function renderLeaderboard(){
  const container = $("leaderboard-table");
  container.innerHTML = "Laden...";
  try {
    const snaps = await get(ref(db, `users`));
    const users = snaps.exists() ? snaps.val() : {};
    const arr = Object.values(users).map(u => ({ username: u.profile?.username || "?", wins: u.profile?.wins || 0 }));
    arr.sort((a,b)=> b.wins - a.wins);
    const rows = arr.slice(0, 50).map((u,i)=> `<div class="leader-row"><div class="pos">${i+1}</div><div class="name">${u.username}</div><div class="wins">${u.wins}</div></div>`).join("");
    container.innerHTML = `<div class="leader-headers"><div>Pos</div><div>Username</div><div>Winst</div></div>${rows || "<div>Geen resultaten</div>"}`;
  } catch(e){ container.innerHTML = "Kon leaderboard niet laden."; console.error(e); }
}

/* show menu if already logged in on page load */
document.addEventListener("DOMContentLoaded", initUI);
