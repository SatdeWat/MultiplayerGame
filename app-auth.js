// js/app-auth.js
import { db } from "./firebase-config.js";
import { ref, set, get } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const getEl = id => document.getElementById(id);

function buf2hex(buffer){
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

export async function deriveDeterministicId(name, username, age){
  const text = `${name.trim().toLowerCase()}|${username.trim().toLowerCase()}|${String(age).trim()}`;
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return buf2hex(hash).slice(0,20); // 20 hex chars as id
}

function saveLocalProfile(profile){
  localStorage.setItem('zs_profile', JSON.stringify(profile));
}

export function loadLocalProfile(){
  try {
    return JSON.parse(localStorage.getItem('zs_profile') || null);
  } catch (e) { return null; }
}

/* If index.html present, wire up events */
if (getEl('btn-guest')){
  const nameInput = getEl('name'), userInput = getEl('username'), ageInput = getEl('age');
  const btnGuest = getEl('btn-guest'), btnSave = getEl('btn-save');

  btnGuest.addEventListener('click', async ()=>{
    const name = nameInput.value.trim() || 'Gast';
    const username = userInput.value.trim() || `gast${Math.floor(Math.random()*9000+100)}`;
    const age = ageInput.value || '';
    const id = await deriveDeterministicId(name, username, age);
    const profile = { name, username, age, id, guest:true };
    saveLocalProfile(profile);
    alert(`Gastprofiel gemaakt als ${name} (${username}). Je id: ${id}`);
  });

  btnSave.addEventListener('click', async ()=>{
    const name = nameInput.value.trim();
    const username = userInput.value.trim();
    const age = ageInput.value;
    if (!name || !username || !age){ alert('Vul naam, gebruikersnaam en leeftijd in'); return; }
    const id = await deriveDeterministicId(name, username, age);
    const profile = { name, username, age, id, guest:false };
    saveLocalProfile(profile);
    // optioneel: schrijf minimale profiel info naar DB voor persistente statistieken (niet wachtwoord)
    try {
      await set(ref(db, `users/${id}`), { name, username, age, lastSeen: Date.now() });
    } catch(e){
      console.warn('Kan niet wegschrijven naar DB', e);
    }
    alert('Profiel opgeslagen (lokaal). Gebruik dezelfde gegevens om later in te loggen.');
  });
}
