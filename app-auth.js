// app-auth.js
import { db } from "./firebase-config.js";
import { ref, set, get } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const STORAGE_KEY = "zs_profile_v4";
const $ = id => document.getElementById(id);

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function loadLocalProfile(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch(e){ return null; }
}

export async function registerUser(username, pin){
  if (!username || !pin) throw new Error('Vul username en pin in');
  if (pin.length < 4 || pin.length > 8) throw new Error('Pincode moet 4–8 tekens zijn');
  const uid = await deriveId(username, pin);
  // schrijf basis user record (if not exists)
  const userRef = ref(db, `users/${uid}/profile`);
  const snap = await get(userRef);
  if (snap.exists()) throw new Error('Gebruikersnaam + pin combinatie bestaat al. Probeer in te loggen.');
  // create entry with 0 wins
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
  if (!snap.exists()) throw new Error('Gebruiker niet gevonden of verkeerde pin.');
  const profile = { username, uid, guest: false };
  saveLocalProfile(profile);
  return profile;
}

export function loginGuest(){
  // create temporary guest profile, stored locally but not saved in users leaderboard
  const rand = Math.floor(Math.random()*9000)+1000;
  const profile = { username: `Gast${rand}`, uid: `guest_${rand}`, guest: true };
  saveLocalProfile(profile);
  return profile;
}

/* UI wiring for index.html */
if ($('btn-register')) {
  const inUser = $('login-username'), inPin = $('login-pin');
  const authCard = $('auth-card'), menuCard = $('menu-card'), lbCard = $('leaderboard-card');
  const subtitle = $('subtitle'), menuUsername = $('menu-username');

  async function showMenuFor(profile){
    authCard.classList.add('hidden');
    menuCard.classList.remove('hidden');
    subtitle.textContent = 'Kies: maak of join een lobby, of bekijk leaderboard';
    menuUsername.textContent = profile.username || profile.name || profile.uid;
  }

  $('btn-register').addEventListener('click', async ()=>{
    try {
      const username = inUser.value.trim();
      const pin = inPin.value;
      const profile = await registerUser(username, pin);
      alert('Geregistreerd en ingelogd als ' + profile.username);
      showMenuFor(profile);
    } catch(e){ alert('Registratie mislukt: ' + e.message); }
  });

  $('btn-login').addEventListener('click', async ()=>{
    try {
      const username = inUser.value.trim();
      const pin = inPin.value;
      const profile = await loginUser(username, pin);
      alert('Ingelogd als ' + profile.username);
      showMenuFor(profile);
    } catch(e){ alert('Login mislukt: ' + e.message); }
  });

  $('btn-guest-login').addEventListener('click', ()=>{
    const profile = loginGuest();
    showMenuFor(profile);
  });

  // menu buttons wiring (will be enhanced by lobby.js via events)
  $('btn-logout').addEventListener('click', ()=>{
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  // leaderboard view
  $('btn-show-leaderboard').addEventListener('click', async ()=>{
    // hide menu, show leaderboard card
    menuCard.classList.add('hidden'); lbCard.classList.remove('hidden');
    // fetch top users
    const statsSnap = await get(ref(db, `users`));
    const users = statsSnap.exists() ? statsSnap.val() : {};
    // build list
    const arr = [];
    for (const uid in users){
      const p = users[uid];
      const wins = (p.stats && p.stats.wins) ? p.stats.wins : ((p.stats && p.stats.wins)===0?0: (p.wins||0));
      const username = (p.profile && p.profile.username) ? p.profile.username : (p.profile && p.profile.name) ? p.profile.name : uid;
      arr.push({ username, wins, uid });
    }
    arr.sort((a,b)=> (b.wins||0) - (a.wins||0));
    const listEl = $('leaderboard-list');
    listEl.innerHTML = '';
    if (arr.length === 0){ listEl.innerHTML = '<div class="muted">Nog geen spelers geregistreerd.</div>'; }
    arr.slice(0,50).forEach((u,i)=>{
      const row = document.createElement('div');
      row.className = 'leader-row';
      row.innerHTML = `<div class="leader-pos">${i+1}</div><div class="leader-name">${u.username}</div><div class="leader-wins">${u.wins||0} winst(en)</div>`;
      listEl.appendChild(row);
    });
  });

  $('btn-back-menu').addEventListener('click', ()=>{
    $('leaderboard-card').classList.add('hidden');
    $('menu-card').classList.remove('hidden');
  });

  // if profile already stored locally, auto-show menu
  const existing = loadLocalProfile();
  if (existing) {
    showMenuFor(existing);
  }
}
