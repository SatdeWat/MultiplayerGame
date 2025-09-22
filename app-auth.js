// app-auth.js
// Bevat profiel helpers: maak guest of deterministic login (sha256 van name|username|age).

import { db } from "./firebase-config.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const STORAGE_KEY = "zs_profile_v3";

function buf2hex(buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

export async function deriveDeterministicId(name, username, age) {
  const text = `${name.trim().toLowerCase()}|${username.trim().toLowerCase()}|${String(age).trim()}`;
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return buf2hex(hash).slice(0, 20);
}

export function saveLocalProfile(profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function loadLocalProfile() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch(e){ return null; }
}

/* UI bindings (index.html verwacht deze element ID's) */
const $ = id => document.getElementById(id);
if ($("btn-guest")) {
  const nameI = $("name"), userI = $("username"), ageI = $("age");
  $("btn-guest").addEventListener("click", async () => {
    const name = nameI.value.trim() || "Gast";
    const username = userI.value.trim() || `gast${Math.floor(Math.random()*90000)}`;
    const age = ageI.value || "";
    const id = await deriveDeterministicId(name, username, age);
    const profile = { name, username, age, id, guest: true };
    saveLocalProfile(profile);
    alert(`Gast aangemaakt: ${name} (${username})`);
  });

  $("btn-save").addEventListener("click", async () => {
    const name = nameI.value.trim();
    const username = userI.value.trim();
    const age = ageI.value;
    if (!name || !username || !age) { alert("Vul naam, gebruikersnaam en leeftijd in."); return; }
    const id = await deriveDeterministicId(name, username, age);
    const profile = { name, username, age, id, guest: false };
    saveLocalProfile(profile);
    // optioneel: schrijf basisprofile naar DB (niet gevoelig)
    try { await set(ref(db, `users/${id}/profile`), { name, username, age, lastSeen: Date.now() }); } catch(e){ console.warn("DB write failed", e); }
    alert("Profiel opgeslagen (lokaal). Gebruik dezelfde gegevens om later in te loggen.");
  });

  // vul velden als profiel al bestaat
  const existing = loadLocalProfile();
  if (existing) {
    nameI.value = existing.name || "";
    userI.value = existing.username || "";
    ageI.value = existing.age || "";
  }
}
