// app-auth.js
import { db } from "./firebase-config.js";
import { ref, get, set, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const STORAGE_KEY = "zs_profile_v_final";

// helper: arraybuffer -> hex
function buf2hex(buffer){
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

// derive deterministic uid from username|pin (SHA-256, truncated)
export async function deriveUid(username, pin){
  const text = `${username.trim().toLowerCase()}|${pin}`;
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return buf2hex(hash).slice(0,20);
}

export function saveLocalProfile(profile){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch(e){ console.warn("saveLocalProfile error", e); }
}

export function loadLocalProfile(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch(e){ return null; }
}

export function clearLocalProfile(){
  try { localStorage.removeItem(STORAGE_KEY); } catch(e){ }
}

// register: writes minimal profile to DB (only when not guest)
export async function registerUser(username, pin){
  if (!username || !pin) throw new Error("Vul username en pincode in");
  if (pin.length < 4 || pin.length > 8) throw new Error("Pincode moet 4-8 tekens zijn");
  const uid = await deriveUid(username, pin);
  const userRef = ref(db, `users/${uid}/profile`);
  const snap = await get(userRef);
  if (snap.exists()) throw new Error("Account bestaat al (gebruik login)");
  // create profile & stats
  await set(ref(db, `users/${uid}/profile`), { username, createdAt: Date.now() });
  await set(ref(db, `users/${uid}/stats`), { wins: 0 });
  const profile = { username, uid, guest: false };
  saveLocalProfile(profile);
  return profile;
}

// login: checks DB profile exists
export async function loginUser(username, pin){
  if (!username || !pin) throw new Error("Vul username en pincode in");
  const uid = await deriveUid(username, pin);
  const snap = await get(ref(db, `users/${uid}/profile`));
  if (!snap.exists()) throw new Error("Gebruiker niet gevonden of verkeerde pincode");
  const profile = { username, uid, guest: false };
  saveLocalProfile(profile);
  return profile;
}

// guest login: local only, not written to DB
export function loginGuest(){
  const rand = Math.floor(Math.random()*90000)+1000;
  const profile = { username: `Gast${rand}`, uid: `guest_${Date.now()}_${rand}`, guest: true };
  saveLocalProfile(profile);
  return profile;
}

// increment wins helper (used by game logic)
export async function incrementWinsForUid(uid){
  if (!uid) return;
  const winsRef = ref(db, `users/${uid}/stats/wins`);
  await runTransaction(winsRef, cur => (cur || 0) + 1);
}
