// app-auth.js
// Beheert lokale profielstorage en eenvoudige stats-updates in Realtime Database.
// Verwacht firebase-config.js aanwezig met 'db' export.

import { db } from "./firebase-config.js";
import { ref, set, get, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/*
 Local profile format stored in localStorage 'zs_profile_v2':
 { uid, username, guest: true|false }
*/

export function saveLocalProfile(profile){
  localStorage.setItem('zs_profile_v2', JSON.stringify(profile));
}

export function loadLocalProfile(){
  try{
    const s = localStorage.getItem('zs_profile_v2');
    if (!s) return null;
    return JSON.parse(s);
  }catch(e){ return null; }
}

export async function ensureUserProfileOnDb(uid, profile){
  // writes a minimal public profile if missing
  const pRef = ref(db, `users/${uid}/profile`);
  const snap = await get(pRef);
  if (!snap.exists()){
    await set(pRef, { username: profile.username || ('User'+uid.slice(0,6)), createdAt: Date.now(), avatarSeed: (profile.username ? profile.username.charAt(0).toUpperCase() : uid.charAt(0).toUpperCase()) });
  }
}

// increment stats: games +=1 for both players and winner wins +=1
export async function incrementGameResults(winnerUid, losersArray){
  // increment winner .stats.wins and games; increment losers .stats.games
  // all via runTransaction per user to avoid race conditions
  try{
    // winner
    const wRef = ref(db, `users/${winnerUid}/stats`);
    await runTransaction(wRef, cur => {
      cur = cur || { wins:0, games:0, winrate:0 };
      cur.wins = (cur.wins||0) + 1;
      cur.games = (cur.games||0) + 1;
      cur.winrate = Math.round(((cur.wins) / cur.games) * 100);
      return cur;
    });

    // losers
    for (const lid of (losersArray||[])){
      const lRef = ref(db, `users/${lid}/stats`);
      await runTransaction(lRef, cur => {
        cur = cur || { wins:0, games:0, winrate:0 };
        cur.games = (cur.games||0) + 1;
        cur.winrate = cur.games>0 ? Math.round(((cur.wins||0)/cur.games) * 100) : 0;
        return cur;
      });
    }
  }catch(e){
    console.error('incrementGameResults error', e);
  }
}
