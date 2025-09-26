// app-auth.js
// Eenvoudige client-side auth: register / login met username + pincode (4-8).
// Deterministische uid = SHA256(username.toLowerCase() + ':' + pin) => base16 truncated.
// Gasten krijgen temporary guest uid (niet opgeslagen in users/).
// Verwacht firebase-config.js met export: db

import { db } from "./firebase-config.js";
import { ref, get, set, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* local profile key */
const STORAGE_KEY = 'zs_profile_v2';

/* helpers */
export function saveLocalProfile(profile){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}
export function loadLocalProfile(){
  try{ const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch(e){ return null; }
}
export function clearLocalProfile(){ localStorage.removeItem(STORAGE_KEY); }

/* SHA256 helper -> returns hex string */
async function sha256hex(str){
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
  return hex;
}

/* derive deterministic uid from username+pin */
async function deriveUid(username, pin){
  const s = (username || '').toLowerCase().trim() + ':' + (pin || '');
  const h = await sha256hex(s);
  // keep prefix for readability
  return 'u_' + h.slice(0,20);
}

/* validate username & pin */
function validateCredentials(username, pin){
  if (!username || username.length < 2) return { ok:false, message: 'Username minimaal 2 tekens' };
  if (!pin || pin.length < 4 || pin.length > 8) return { ok:false, message: 'Pincode moet 4–8 tekens zijn' };
  // restrict some characters
  if (!/^[A-Za-z0-9\-_]+$/.test(username)) return { ok:false, message: 'Username alleen letters, cijfers, - en _' };
  if (!/^[A-Za-z0-9]+$/.test(pin)) return { ok:false, message: 'Pincode alleen letters en cijfers' };
  return { ok:true };
}

/* ensure minimal profile is present in DB for leaderboard */
export async function ensureUserProfileOnDb(uid, profile){
  try{
    const pRef = ref(db, `users/${uid}/profile`);
    const snap = await get(pRef);
    if (!snap.exists()){
      await set(pRef, { username: profile.username || ('User'+uid.slice(0,6)), createdAt: Date.now(), avatarSeed: (profile.username ? profile.username.charAt(0).toUpperCase() : uid.charAt(0).toUpperCase()) });
    }
  }catch(e){
    console.warn('ensureUserProfileOnDb failed', e);
  }
}

/* register: create uid, ensure not already used */
export async function tryRegister(username, pin){
  const v = validateCredentials(username, pin);
  if (!v.ok) return { success:false, message: v.message };
  const uid = await deriveUid(username, pin);
  // check if exists
  const userSnap = await get(ref(db, `users/${uid}/profile`));
  if (userSnap.exists()){
    return { success:false, message: 'Account bestaat al. Log in of kies andere username/pincode.' };
  }
  // write minimal profile
  await set(ref(db, `users/${uid}/profile`), { username, createdAt: Date.now(), avatarSeed: username.charAt(0).toUpperCase() });
  // create local profile
  const profile = { uid, username, guest:false };
  saveLocalProfile(profile);
  return { success:true, profile };
}

/* login: compute uid and verify exists */
export async function tryLogin(username, pin){
  const v = validateCredentials(username, pin);
  if (!v.ok) return { success:false, message: v.message };
  const uid = await deriveUid(username, pin);
  const userSnap = await get(ref(db, `users/${uid}/profile`));
  if (!userSnap.exists()){
    return { success:false, message: 'Account niet gevonden. Controleer of je hebt geregistreerd.' };
  }
  const profileData = userSnap.val();
  const profile = { uid, username: profileData.username || username, guest:false };
  saveLocalProfile(profile);
  return { success:true, profile };
}

/* guest: create temporary local-only profile. Do NOT store in leaderboard */
export async function playAsGuest(){
  const uid = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*9999);
  const username = 'Gast' + uid.slice(-4);
  const profile = { uid, username, guest:true };
  saveLocalProfile(profile);
  return profile;
}

/* increment stats helper used by game_core.js */
// winnerUid: string, losersArray: [uid,...]
export async function incrementGameResults(winnerUid, losersArray){
  // winner
  try{
    await runTransaction(ref(db, `users/${winnerUid}/stats`), cur => {
      cur = cur || { wins:0, games:0, winrate:0 };
      cur.wins = (cur.wins||0) + 1;
      cur.games = (cur.games||0) + 1;
      cur.winrate = cur.games > 0 ? Math.round(((cur.wins) / cur.games) * 100) : 0;
      return cur;
    });
  }catch(e){ console.warn(e); }
  // losers
  for (const lid of (losersArray||[])){
    try{
      await runTransaction(ref(db, `users/${lid}/stats`), cur => {
        cur = cur || { wins:0, games:0, winrate:0 };
        cur.games = (cur.games||0) + 1;
        cur.winrate = cur.games > 0 ? Math.round(((cur.wins||0) / cur.games) * 100) : 0;
        return cur;
      });
    }catch(e){ console.warn(e); }
  }
}

/* export default utilities for other scripts */
export default {
  saveLocalProfile, loadLocalProfile, clearLocalProfile, tryRegister, tryLogin, playAsGuest, ensureUserProfileOnDb, incrementGameResults
};
