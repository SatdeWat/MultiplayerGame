// login.js
import { db } from "./firebase-config.js";
import { ref, get, set } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const $ = id => document.getElementById(id);

// Helper: save profile locally
const STORAGE_KEY = "zs_profile_v4";
function saveLocalProfile(profile){ localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); }
function loadLocalProfile(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"); } catch(e){return null;} }

// Registration / Login
if ($("btn-register")) {
  $("btn-register").addEventListener("click", async ()=>{
    const username = $("username").value.trim();
    const pin = $("pincode").value.trim();
    if(!username || !pin || pin.length<4 || pin.length>8){ return showPopup("Pin 4-8 tekens"); }
    const userRef = ref(db, `users/${username}`);
    const snap = await get(userRef);
    if(snap.exists()){ return showPopup("Username bestaat al"); }
    await set(userRef, { username, pin, wins:0, losses:0 });
    saveLocalProfile({ username, guest:false });
    showPopup("Registratie geslaagd!"); location.href="lobby.html";
  });

  $("btn-login").addEventListener("click", async ()=>{
    const username = $("username").value.trim();
    const pin = $("pincode").value.trim();
    if(!username || !pin){ return showPopup("Vul alles in"); }
    const snap = await get(ref(db, `users/${username}`));
    if(!snap.exists() || snap.val().pin !== pin){ return showPopup("Ongeldige inlog"); }
    saveLocalProfile({ username, guest:false });
    location.href="lobby.html";
  });

  $("btn-guest").addEventListener("click", ()=>{
    const guestName = `Gast${Math.floor(Math.random()*9000)}`;
    saveLocalProfile({ username:guestName, guest:true });
    location.href="lobby.html";
  });
}

// in-game popups
export function showPopup(msg){
  let pop = $("popup");
  if(!pop){ pop = document.createElement("div"); pop.id="popup"; document.body.appendChild(pop); }
  pop.textContent=msg;
  pop.classList.add("show");
  setTimeout(()=>{pop.classList.remove("show");},2500);
}
