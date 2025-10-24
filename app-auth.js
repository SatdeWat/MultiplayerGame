// app-auth.js
// Login/registratie helpers: username + pincode (4-8 chars).
// Slaat profielen lokaal op (voor sessie) en in DB (usernames map + wins).
// Gasten: guest login wordt alleen lokaal gehouden en niet naar leaderboard geschreven.

import { db } from "./firebase-config.js";
import { ref, set, get, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const STORAGE_KEY = "zs_profile_v4";

function buf2hex(buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return buf2hex(hash).slice(0, 24); // 24 hex chars = 12 bytes - enough for deterministic id
}

export async function deriveId(username, pincode) {
  const t = `${username.trim().toLowerCase()}|${pincode}`;
  return await sha256Hex(t);
}

export function saveLocalProfile(profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function loadLocalProfile() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch(e){ return null; }
}

export function clearLocalProfile() {
  localStorage.removeItem(STORAGE_KEY);
}

/* DOM bindings for index.html (login/register/guest UI) */
const $ = id => document.getElementById(id);

if ($("auth-area")) {
  const regUser = $("reg-username"), regPin = $("reg-pincode"), regBtn = $("btn-register");
  const loginUser = $("login-username"), loginPin = $("login-pincode"), loginBtn = $("btn-login");
  const guestBtn = $("btn-guest-login");
  const authMessage = $("auth-message");

  function showMessage(msg, type="info") { authMessage.textContent = msg; authMessage.dataset.type = type; }

  // Register
  regBtn.addEventListener("click", async () => {
    const username = (regUser.value || "").trim();
    const pincode = (regPin.value || "").trim();
    if (!username || !pincode || pincode.length < 4 || pincode.length > 8) { showMessage("Kies een username en een pincode van 4-8 tekens.", "error"); return; }
    const uname = username.toLowerCase();

    try {
      // Use transaction style reserve username if not exists
      const namesRef = ref(db, `usernames/${uname}`);
      const tx = await runTransaction(namesRef, current => {
        if (current === null) return { reserved: true };
        return; // abort
      });
      if (!tx.committed) { showMessage("Gebruikersnaam al in gebruik.", "error"); return; }
      // create id and profile
      const id = await deriveId(uname, pincode);
      const profile = { id, username: uname, registeredAt: Date.now(), wins: 0, guest: false };
      await set(ref(db, `users/${id}/profile`), profile);
      // set username mapping to id
      await set(ref(db, `usernames/${uname}`), id);
      saveLocalProfile(profile);
      showMessage("Registratie gelukt — ingelogd!", "success");
      // redirect / show lobby area by reloading so index scripts pick up saved profile
      setTimeout(()=> location.reload(), 600);
    } catch (e) {
      console.error(e);
      showMessage("Registratie mislukt: " + (e.message || e), "error");
      // try to cleanup reservation if something failed
      try { await set(ref(db, `usernames/${uname}`), null); } catch(_) {}
    }
  });

  // Login
  loginBtn.addEventListener("click", async () => {
    const username = (loginUser.value || "").trim();
    const pincode = (loginPin.value || "").trim();
    if (!username || !pincode) { showMessage("Vul username en pincode in.", "error"); return; }
    const uname = username.toLowerCase();
    try {
      const id = await deriveId(uname, pincode);
      const snap = await get(ref(db, `users/${id}/profile`));
      if (!snap.exists()) { showMessage("Geen account met deze gegevens.", "error"); return; }
      const profile = snap.val();
      profile.guest = false;
      saveLocalProfile(profile);
      showMessage("Inloggen gelukt!", "success");
      setTimeout(()=> location.reload(), 400);
    } catch (e) {
      console.error(e); showMessage("Inloggen mislukt: " + (e.message || e), "error");
    }
  });

  // Guest
  guestBtn.addEventListener("click", async () => {
    const guestName = `Gast${Math.floor(Math.random()*90000)}`;
    const id = `guest_${Date.now()}_${Math.floor(Math.random()*9999)}`;
    const profile = { id, username: guestName.toLowerCase(), guest: true, wins: 0 };
    saveLocalProfile(profile);
    showMessage("Ingelogd als gast: " + guestName, "success");
    setTimeout(()=> location.reload(), 400);
  });

  // If profile exists -> hide auth and show app area by reloading (index will display menu)
  const existing = loadLocalProfile();
  if (existing) {
    // keep on page; main index logic will show lobby/menu
  }
}
