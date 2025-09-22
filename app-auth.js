// app-auth.js (POPUPS VERWIJDERD - gebruik inline status in #subtitle)
// Dit bestand regelt register/login/guest zonder alerts of overlays.
// Fouten en successen tonen we alleen in de subtitle (niet-blocking).

import { db } from "./firebase-config.js";
import { ref, set, get, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const STORAGE_KEY = "zs_profile_v4";
const $ = id => document.getElementById(id);

// hex helper
function buf2hex(buffer){
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

export async function deriveId(username, pin){
  const text = `${username.trim().toLowerCase()}|${pin}`;
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return buf2hex(hash).slice(0,20);
}

export function saveLocalProfile(profile){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); }
  catch(e){ console.warn('Kon profiel niet lokaal opslaan', e); }
}

export function loadLocalProfile(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch(e){ return null; }
}

export async function registerUser(username, pin){
  if (!username || !pin) throw new Error('Vul username en pin in');
  if (pin.length < 4 || pin.length > 8) throw new Error('Pincode moet 4–8 tekens zijn');
  const uid = await deriveId(username, pin);
  const userRef = ref(db, `users/${uid}/profile`);
  const snap = await get(userRef);
  if (snap.exists()) throw new Error('Account bestaat al (gebruik login).');
  await set(ref(db, `users/${uid}/profile`), { username, createdAt: Date.now() });
  await set(ref(db, `users/${uid}/stats`), { wins: 0 });
  const profile = { username, uid, guest: false };
  saveLocalProfile(profile);
  return profile;
}

export async function loginUser(username, pin){
  if (!username || !pin) throw new Error('Vul username en pin in');
  const uid = await deriveId(username, pin);
  const userRef = ref(db, `users/${uid}/profile`);
  const snap = await get(userRef);
  if (!snap.exists()) throw new Error('Gebruiker niet gevonden of verkeerde pin');
  const profile = { username, uid, guest: false };
  saveLocalProfile(profile);
  return profile;
}

export function loginGuest(){
  const rand = Math.floor(Math.random()*9000)+1000;
  const profile = { username: `Gast${rand}`, uid: `guest_${rand}`, guest: true };
  saveLocalProfile(profile);
  return profile;
}

/* UI wiring — geen alerts, geen overlays */
function attachUiHandlers(){
  const registerBtn = $('btn-register'), loginBtn = $('btn-login'), guestBtn = $('btn-guest-login');
  const inUser = $('login-username'), inPin = $('login-pin');
  const authCard = $('auth-card'), menuCard = $('menu-card'), lbCard = $('leaderboard-card');
  const subtitle = $('subtitle'), menuUsername = $('menu-username');
  const logoutBtn = $('btn-logout'), showLbBtn = $('btn-show-leaderboard'), backLbBtn = $('btn-back-menu');

  function showMenuFor(profile){
    authCard.classList.add('hidden');
    menuCard.classList.remove('hidden');
    subtitle.textContent = 'Kies: maak of join een lobby, of bekijk leaderboard';
    menuUsername.textContent = profile.username || profile.name || profile.uid;
  }

  if (registerBtn) registerBtn.addEventListener('click', async ()=>{
    registerBtn.disabled = true;
    subtitle.textContent = 'Registratie...';
    try {
      const username = inUser.value.trim();
      const pin = inPin.value;
      const profile = await registerUser(username, pin);
      // inline success
      subtitle.textContent = 'Geregistreerd en ingelogd als ' + profile.username;
      showMenuFor(profile);
    } catch(e){
      console.error('Registratie fout:', e);
      subtitle.textContent = 'Registratie mislukt: ' + e.message;
    } finally { registerBtn.disabled = false; }
  });

  if (loginBtn) loginBtn.addEventListener('click', async ()=>{
    loginBtn.disabled = true;
    subtitle.textContent = 'Inloggen...';
    try {
      const username = inUser.value.trim();
      const pin = inPin.value;
      const profile = await loginUser(username, pin);
      subtitle.textContent = 'Ingelogd als ' + profile.username;
      showMenuFor(profile);
    } catch(e){
      console.error('Login fout:', e);
      subtitle.textContent = 'Login mislukt: ' + e.message;
    } finally { loginBtn.disabled = false; }
  });

  if (guestBtn) guestBtn.addEventListener('click', ()=>{
    const profile = loginGuest();
    subtitle.textContent = 'Ingelogd als gast: ' + profile.username;
    showMenuFor(profile);
  });

  if (logoutBtn) logoutBtn.addEventListener('click', ()=>{
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  if (showLbBtn){
    showLbBtn.addEventListener('click', async ()=>{
      const listEl = $('leaderboard-list');
      if (!listEl) return;
      $('menu-card').classList.add('hidden'); lbCard.classList.remove('hidden');
      subtitle.textContent = 'Leaderboard';
      try {
        const usersSnap = await get(ref(db, `users`));
        const users = usersSnap.exists() ? usersSnap.val() : {};
        const arr = [];
        for (const uid in users){
          const u = users[uid];
          const uname = (u.profile && u.profile.username) ? u.profile.username : uid;
          const wins = (u.stats && typeof u.stats.wins !== 'undefined') ? u.stats.wins : 0;
          arr.push({ uname, wins });
        }
        arr.sort((a,b) => b.wins - a.wins);
        listEl.innerHTML = '';
        if (arr.length === 0) listEl.innerHTML = '<div class="muted">Nog geen spelers.</div>';
        arr.forEach((x,i)=>{
          const row = document.createElement('div');
          row.className = 'leader-row';
          row.innerHTML = `<div class="leader-pos">${i+1}</div><div class="leader-name">${x.uname}</div><div class="leader-wins">${x.wins} winst(en)</div>`;
          listEl.appendChild(row);
        });
      } catch(e){
        console.error('Leaderboard load fail', e);
        listEl.innerHTML = '<div class="muted">Kon leaderboard niet laden.</div>';
      }
    });
  }

  if (backLbBtn) backLbBtn.addEventListener('click', ()=>{
    lbCard.classList.add('hidden'); $('menu-card').classList.remove('hidden');
    subtitle.textContent = 'Kies: maak of join een lobby, of bekijk leaderboard';
  });

  // prefill username if profile exists locally, but DO NOT auto-open menu or show popups
  const existing = loadLocalProfile();
  if (existing){
    inUser.value = existing.username || '';
    subtitle.textContent = `Welkom terug${existing.username ? ' ' + existing.username : ''}. Vul je pincode in en klik Login.`;
    console.log('Prefilled username from local profile (no auto-login).');
  } else {
    subtitle.textContent = 'Login of registreer — geen pop-ups worden getoond.';
  }
}

/* wait for DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachUiHandlers);
} else {
  attachUiHandlers();
}
