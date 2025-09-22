// lobby.js
import { db } from "./firebase-config.js";
import { loadLocalProfile } from "./app-auth.js";
import { ref, set, onValue, get } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', ()=>{

  const joinInput = $('join-code');
  const btnCreate = $('btn-create');
  const btnJoin = $('btn-join');
  const status = $('status-msg');
  const lobbyList = $('lobby-list');

  const profile = loadLocalProfile();

  // Disable controls if no profile (no popups)
  if (!profile) {
    status.textContent = "Log eerst in of speel als gast om lobbies te maken/joinen.";
    btnCreate.disabled = true;
    btnJoin.disabled = true;
    joinInput.disabled = true;
  } else {
    status.textContent = `Ingelogd als ${profile.username || profile.uid}`;
    btnCreate.disabled = false;
    btnJoin.disabled = false;
    joinInput.disabled = false;
  }

  function makeCode(len=6){
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
    return s;
  }

  btnCreate.addEventListener('click', async ()=>{
    if (!profile) return;
    btnCreate.disabled = true;
    status.textContent = "Lobby aanmaken...";
    try {
      const code = makeCode(6);
      const gameId = `game_${Date.now()}_${Math.floor(Math.random()*9999)}`;
      await set(ref(db, `lobbies/${code}`), { gameId, createdAt: Date.now(), owner: profile.uid, gamemode: 10 });
      const players = {};
      players[profile.uid] = { username: profile.username, ready: false, slot: 0 };
      await set(ref(db, `games/${gameId}`), { players, status: "waiting", createdAt: Date.now() });
      // direct naar game page with lobby code
      location.href = `game.html?lobby=${code}`;
    } catch (err) {
      console.error("create lobby error", err);
      status.textContent = "Kon lobby niet aanmaken: " + (err.message || err);
      btnCreate.disabled = false;
    }
  });

  btnJoin.addEventListener('click', async ()=>{
    if (!profile) return;
    const code = joinInput.value.trim().toUpperCase();
    if (!code) { status.textContent = "Vul een lobby code in"; return; }
    status.textContent = "Joinen...";
    try {
      const lobbySnap = await get(ref(db, `lobbies/${code}`));
      if (!lobbySnap.exists()) {
        status.textContent = "Lobby niet gevonden";
        return;
      }
      const lobby = lobbySnap.val();
      const gameId = lobby.gameId;
      // add player to game players
      await set(ref(db, `games/${gameId}/players/${profile.uid}`), { username: profile.username, ready: false, slot: 1 });
      location.href = `game.html?lobby=${code}`;
    } catch (err) {
      console.error("join error", err);
      status.textContent = "Kon niet joinen: " + (err.message || err);
    }
  });

  // Live lobby list
  const lobbiesRef = ref(db, "lobbies");
  onValue(lobbiesRef, (snap)=>{
    lobbyList.innerHTML = "";
    snap.forEach(child=>{
      const v = child.val();
      const row = document.createElement('div');
      row.className = 'lobby-row';
      row.style.padding = '8px';
      row.style.borderRadius = '8px';
      row.style.background = 'rgba(255,255,255,0.03)';
      row.style.cursor = 'pointer';
      row.textContent = `${child.key} — Host: ${v.owner || v.ownerUid || v.ownerId || 'unknown'} — mode: ${v.gamemode || 10}`;
      row.addEventListener('click', ()=> {
        joinInput.value = child.key;
      });
      lobbyList.appendChild(row);
    });
  });

});
