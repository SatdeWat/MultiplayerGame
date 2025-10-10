// app-auth.js — eenvoudige login/registratie zonder Firebase Auth, met lokale opslag
import { db } from "./firebase-config.js"; // importeer de Realtime DB verbinding die we net exporteerden
import { ref, get, set, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js"; // database-functies die we gebruiken

const STORAGE_KEY = 'zs_profile_v2'; // lokale key in browser.storage om profiel op te slaan

// Sla een profiel object lokaal op in de browser (zodat je ingelogd blijft)
export function saveLocalProfile(profile){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); // zet profiel als string in localStorage
}

// Laad het profiel uit localStorage (of null als er niets is)
export function loadLocalProfile(){
  try{
    const s = localStorage.getItem(STORAGE_KEY); // lees string
    return s ? JSON.parse(s) : null; // parse naar object of return null
  }catch(e){
    return null; // als iets misgaat, geven we null terug
  }
}

// Verwijder het lokale profiel (logout)
export function clearLocalProfile(){ localStorage.removeItem(STORAGE_KEY); } // haalt key weg

// eenvoudige helper: maak een SHA-256 hash (wordt gebruikt om een vaste uid van username+pin te maken)
async function sha256hex(str){
  const enc = new TextEncoder(); // zet tekst om naar bytes
  const data = enc.encode(str); // encode string
  const hash = await crypto.subtle.digest('SHA-256', data); // maak SHA-256 hash
  const bytes = new Uint8Array(hash); // zet hash om naar byte-array
  return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(''); // hex-string returnen
}

// Maak een deterministische uid van username + pincode
async function deriveUid(username, pin){
  const s = (username || '').toLowerCase().trim() + ':' + (pin || ''); // combineer username en pin
  const h = await sha256hex(s); // hash de combinatie
  return 'u_' + h.slice(0,20); // neem eerste 20 chars en prefix 'u_' zodat het kort blijft
}

// input checks: eenvoudige regels voor username en pincode
function validateCredentials(username, pin){
  if (!username || username.length < 2) return { ok:false, message: 'Username minimaal 2 tekens' }; // te kort
  if (!pin || pin.length < 4 || pin.length > 8) return { ok:false, message: 'Pincode moet 4–8 tekens zijn' }; // pin lengte-regel
  if (!/^[A-Za-z0-9\-_]+$/.test(username)) return { ok:false, message: 'Username alleen letters, cijfers, - en _' }; // toegestane tekens
  if (!/^[A-Za-z0-9]+$/.test(pin)) return { ok:false, message: 'Pincode alleen letters en cijfers' }; // pin mag alleen letters/cijfers
  return { ok:true }; // alles goed
}

// Zorg dat er in de database minimaal een profiel staat voor deze uid (legt basic profiel neer)
export async function ensureUserProfileOnDb(uid, profile){
  try{
    const pRef = ref(db, `users/${uid}/profile`); // locatie users/{uid}/profile
    const snap = await get(pRef); // lees data
    if (!snap.exists()){
      await set(pRef, { username: profile.username || ('User'+uid.slice(0,6)), createdAt: Date.now(), avatarSeed: (profile.username ? profile.username.charAt(0).toUpperCase() : uid.charAt(0).toUpperCase()) });
      // schrijft een basis profiel als er geen profiel is
    }
  }catch(e){
    console.warn('ensureUserProfileOnDb failed', e); // fout loggen maar niet crashen
  }
}

// Registreer nieuwe gebruiker: maak uid en schrijf profiel in DB
export async function tryRegister(username, pin){
  const v = validateCredentials(username, pin); // check input
  if (!v.ok) return { success:false, message: v.message }; // fout teruggeven
  const uid = await deriveUid(username, pin); // maak uid
  const userSnap = await get(ref(db, `users/${uid}/profile`)); // check of al bestaat
  if (userSnap.exists()){
    return { success:false, message: 'Account bestaat al. Log in of kies andere username/pincode.' }; // al in gebruik
  }
  await set(ref(db, `users/${uid}/profile`), { username, createdAt: Date.now(), avatarSeed: username.charAt(0).toUpperCase() }); // schrijf profiel
  const profile = { uid, username, guest:false }; // maak local profile object
  saveLocalProfile(profile); // sla lokaal op
  return { success:true, profile }; // succes teruggeven
}

// Login: bereken uid en controleer of profiel bestaat
export async function tryLogin(username, pin){
  const v = validateCredentials(username, pin); // check input
  if (!v.ok) return { success:false, message: v.message }; // foutmelding
  const uid = await deriveUid(username, pin); // bereken uid
  const userSnap = await get(ref(db, `users/${uid}/profile`)); // haal profiel
  if (!userSnap.exists()){
    return { success:false, message: 'Account niet gevonden. Controleer of je hebt geregistreerd.' }; // bestaat niet
  }
  const profileData = userSnap.val(); // profieldata uit DB
  const profile = { uid, username: profileData.username || username, guest:false }; // maak lokaal profiel
  saveLocalProfile(profile); // bewaar lokaal
  return { success:true, profile }; // return success
}

// Gast spelen: maak tijdelijk lokaal profiel (niet in DB)
export async function playAsGuest(){
  const uid = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*9999); // uniek guest id
  const username = 'Gast' + uid.slice(-4); // simpele gastnaam
  const profile = { uid, username, guest:true }; // profiel object
  saveLocalProfile(profile); // lokaal bewaren
  return profile; // return guest profiel
}

// Update statistieken: winner krijgt win en game; losers krijgen alleen games++
// We gebruiken runTransaction om race-conditions te voorkomen
export async function incrementGameResults(winnerUid, losersArray){
  try{
    await runTransaction(ref(db, `users/${winnerUid}/stats`), cur => { // veilig update winner stats
      cur = cur || { wins:0, games:0, winrate:0 }; // default
      cur.wins = (cur.wins||0) + 1; // wins +1
      cur.games = (cur.games||0) + 1; // games +1
      cur.winrate = cur.games > 0 ? Math.round(((cur.wins) / cur.games) * 100) : 0; // winrate berekenen als percentage
      return cur; // nieuwe waarde teruggeven
    });
  }catch(e){ console.warn(e); } // log fout als update failt

  for (const lid of (losersArray||[])){ // voor elke verliezer
    try{
      await runTransaction(ref(db, `users/${lid}/stats`), cur => {
        cur = cur || { wins:0, games:0, winrate:0 }; // default
        cur.games = (cur.games||0) + 1; // alleen games++
        cur.winrate = cur.games > 0 ? Math.round(((cur.wins||0) / cur.games) * 100) : 0; // winrate bijwerken
        return cur;
      });
    }catch(e){ console.warn(e); }
  }
}

// export default handig voor import als object
export default {
  saveLocalProfile, loadLocalProfile, clearLocalProfile, tryRegister, tryLogin, playAsGuest, ensureUserProfileOnDb, incrementGameResults
};
