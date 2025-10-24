// app-auth.js — eenvoudige login/registratie (multiplayer). legt profielen in DB en lokaal op browser.
import { db } from "./firebase-config.js"; // database verbinding
import { ref, get, set, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js"; // db functies

const STORAGE_KEY = 'zs_profile_v2'; // lokale opslag key

// sla profiel lokaal op (browser)
export function saveLocalProfile(profile){ localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } // bewaar profiel

// laad lokaal profiel
export function loadLocalProfile(){ try{ const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; }catch(e){ return null; } } // return object of null

// verwijder lokaal profiel (logout)
export function clearLocalProfile(){ localStorage.removeItem(STORAGE_KEY); } // verwijder key

// eenvoudige validator voor username + pin
function validateCredentials(username, pin){
  if (!username || username.length < 2) return { ok:false, message:'Username minimaal 2 tekens' }; // check naam
  if (!pin || pin.length < 4 || pin.length > 8) return { ok:false, message:'Pincode 4–8 tekens' }; // check pin lengte
  if (!/^[A-Za-z0-9\-_]+$/.test(username)) return { ok:false, message:'Username mag letters, cijfers, - en _' }; // toegestane tekens
  if (!/^[A-Za-z0-9]+$/.test(pin)) return { ok:false, message:'Pincode alleen letters & cijfers' }; // pin tekens
  return { ok:true }; // alles goed
}

// maak deterministische uid van username+pin (zodat inloggen werkt zonder echte auth)
async function sha256hex(str){ const enc = new TextEncoder(); const data = enc.encode(str); const hash = await crypto.subtle.digest('SHA-256', data); const bytes = new Uint8Array(hash); return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join(''); } // hash helper
async function deriveUid(username, pin){ const s = (username||'').toLowerCase().trim() + ':' + (pin||''); const h = await sha256hex(s); return 'u_' + h.slice(0,20); } // maak korte uid

// zorg dat er een minimaal profiel in DB staat
export async function ensureUserProfileOnDb(uid, profile){
  try{
    const pRef = ref(db, `users/${uid}/profile`); // locatie
    const snap = await get(pRef); // lees
    if (!snap.exists()){
      await set(pRef, { username: profile.username || ('User'+uid.slice(0,6)), createdAt: Date.now(), avatarSeed: (profile.username?profile.username.charAt(0).toUpperCase(): 'U') }); // schrijf profiel
    }
  }catch(e){ console.warn('ensureUserProfileOnDb', e); } // log fouten
}

// registreer account (schrijft profiel in DB)
export async function tryRegister(username, pin){
  const v = validateCredentials(username, pin); if (!v.ok) return { success:false, message:v.message }; // validate
  const uid = await deriveUid(username, pin); // bereken uid
  const snap = await get(ref(db, `users/${uid}/profile`)); // kijk of bestaat
  if (snap.exists()) return { success:false, message:'Account bestaat al' }; // al in gebruik
  await set(ref(db, `users/${uid}/profile`), { username, createdAt: Date.now(), avatarSeed: username.charAt(0).toUpperCase() }); // schrijf profiel
  const profile = { uid, username, guest:false }; saveLocalProfile(profile); return { success:true, profile }; // bewaar lokaal en return
}

// login (controleert of profiel bestaat)
export async function tryLogin(username, pin){
  const v = validateCredentials(username, pin); if (!v.ok) return { success:false, message:v.message }; // validate
  const uid = await deriveUid(username, pin); // uid
  const snap = await get(ref(db, `users/${uid}/profile`)); // read DB
  if (!snap.exists()) return { success:false, message:'Account niet gevonden' }; // niet gevonden
  const profileData = snap.val(); const profile = { uid, username: profileData.username || username, guest:false }; saveLocalProfile(profile); return { success:true, profile }; // bewaar lokaal & return
}

// guest: lokaal profiel dat niet naar DB gaat
export async function playAsGuest(){ const uid = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*9999); const username = 'Gast' + uid.slice(-4); const profile = { uid, username, guest:true }; saveLocalProfile(profile); return profile; } // guest

// update wedstrijdresultaten: winnaar + verliezers
export async function incrementGameResults(winnerUid, losersArray){
  try{
    await runTransaction(ref(db, `users/${winnerUid}/stats`), cur => { cur = cur || { wins:0, games:0, winrate:0 }; cur.wins = (cur.wins||0)+1; cur.games = (cur.games||0)+1; cur.winrate = cur.games>0? Math.round((cur.wins/cur.games)*100):0; return cur; });
  }catch(e){ console.warn(e); }
  for (const lid of (losersArray||[])){
    try{
      await runTransaction(ref(db, `users/${lid}/stats`), cur => { cur = cur || { wins:0, games:0, winrate:0 }; cur.games = (cur.games||0)+1; cur.winrate = cur.games>0? Math.round(((cur.wins||0)/cur.games)*100):0; return cur; });
    }catch(e){ console.warn(e); }
  }
}

export default { saveLocalProfile, loadLocalProfile, clearLocalProfile, tryRegister, tryLogin, playAsGuest, ensureUserProfileOnDb, incrementGameResults }; // default export
