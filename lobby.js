// lobby.js
import { db } from "./firebase-config.js";
import { ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { loadLocalProfile, showPopup } from "./login.js";

const $ = id => document.getElementById(id);
function makeCode(len=6){ const chars="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s=""; for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s; }

const profile = loadLocalProfile() || { username:`Gast${Math.floor(Math.random()*9000)}`, guest:true };

async function createLobby(mode){
  const lobbyCode = makeCode();
  const gameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
  await set(ref(db, `lobbies/${lobbyCode}`), { gameId, status:"waiting", owner:profile.username, gamemode:mode });
  const players = {}; players[profile.username]={ ready:false };
  await set(ref(db, `games/${gameId}`), { players, status:"waiting", gamemode:mode, createdAt:Date.now() });
  return { lobbyCode, gameId };
}

async function joinLobby(code){
  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if(!lobbySnap.exists()) throw new Error("Lobby niet gevonden");
  const lobby = lobbySnap.val(); const gameId = lobby.gameId;
  await set(ref(db, `games/${gameId}/players/${profile.username}`), { ready:false });
  return { lobbyCode: code, gameId };
}

/* UI binding */
if($("create-lobby")){
  const createBtn = $("create-lobby"), joinBtn = $("join-lobby"), joinInput=$("join-code");
  const lobbyCodeEl=$("lobby-code"), lobbyStatus=$("lobby-status"), myLobby=$("my-lobby"), goBtn=$("go-to-game");
  const modeSelect = $("gamemode");

  createBtn.addEventListener("click", async ()=>{
    createBtn.disabled=true;
    try{
      const mode=parseInt(modeSelect.value,10);
      const { lobbyCode } = await createLobby(mode);
      lobbyCodeEl.textContent=lobbyCode; myLobby.classList.remove("hidden"); lobbyStatus.textContent="Wachten op speler...";
      const playersRef = ref(db, `games/${lobbyCode}`);
      onValue(ref(db, `lobbies/${lobbyCode}`), snap=>{
        const l = snap.val(); if(!l) return;
        if(l.status==="ready") goBtn.classList.remove("hidden");
      });
      goBtn.onclick=()=>location.href=`game.html?lobby=${lobbyCode}`;
    }catch(e){ showPopup("Fout: "+e.message); }
    createBtn.disabled=false;
  });

  joinBtn.addEventListener("click", async ()=>{
    joinBtn.disabled=true;
    try{
      const code = joinInput.value.trim().toUpperCase();
      if(!code) { showPopup("Vul code in"); joinBtn.disabled=false; return; }
      await joinLobby(code);
      showPopup("Join geslaagd!"); location.href=`game.html?lobby=${code}`;
    }catch(e){ showPopup("Join mislukt: "+e.message); }
    joinBtn.disabled=false;
  });
}
