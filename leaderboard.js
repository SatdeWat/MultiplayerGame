// leaderboard.js
import {
  db,
  dbRef as ref,
  dbGet as get,
  dbOnValue as onValue
} from "./firebase.js";

const tbody = document.querySelector("#board tbody");
const container = document.querySelector(".container");

// common candidate paths to check in your DB
const candidatePaths = [
  "leaderboard",
  "players",
  "users",
  "stats",
  "" // root as last resort
];

// candidate key names for wins / plays
const winsKeys = ["wins", "win", "victories", "victoryCount", "winsCount"];
const playsKeys = ["plays", "games", "gamesPlayed", "played", "playsCount"];

// helper: try to read common key from object
function pickKey(obj, candidates) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of candidates) {
    if (k in obj && (typeof obj[k] === "number" || typeof obj[k] === "string")) return obj[k];
  }
  return undefined;
}

// normalize value to integer (if string numeric, parse)
function toInt(v) {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// build player list from a snapshot value (object)
function buildPlayersFromSnapshot(obj) {
  const players = [];
  for (const key of Object.keys(obj || {})) {
    const raw = obj[key];
    // If this node looks like a nested record that contains wins/plays under .stats or .history etc. attempt to find them:
    let candidate = raw;
    // If raw directly has wins/plays -> use it
    let wins = pickKey(candidate, winsKeys);
    let plays = pickKey(candidate, playsKeys);

    // try nested paths
    if (wins === undefined || plays === undefined) {
      // check common nested containers
      const nestedPaths = ["stats", "record", "score", "history", "statsData"];
      for (const np of nestedPaths) {
        if (candidate && candidate[np] && typeof candidate[np] === "object") {
          const nested = candidate[np];
          if (wins === undefined) wins = pickKey(nested, winsKeys);
          if (plays === undefined) plays = pickKey(nested, playsKeys);
        }
      }
    }

    // if still undefined, attempt to detect fields with those names but deeper
    if ((wins === undefined || plays === undefined) && typeof candidate === "object") {
      // shallow search one level deeper
      for (const subKey of Object.keys(candidate)) {
        const sub = candidate[subKey];
        if (sub && typeof sub === "object") {
          if (wins === undefined) wins = pickKey(sub, winsKeys);
          if (plays === undefined) plays = pickKey(sub, playsKeys);
        }
        if (wins !== undefined && plays !== undefined) break;
      }
    }

    // if still nothing, skip if there is no numeric data at all
    const winsN = toInt(wins);
    const playsN = toInt(plays);

    // even if both zero, include the player (so users with 0 games appear)
    players.push({
      name: key,
      wins: winsN,
      games: playsN,
      raw: raw
    });
  }
  return players;
}

// render table rows
function renderTable(players) {
  tbody.innerHTML = "";
  if (!players.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4">Geen spelers gevonden</td>`;
    tbody.appendChild(tr);
    return;
  }

  // sort by wins desc, then by games desc
  players.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.games - a.games;
  });

  players.forEach((p, idx) => {
    const tr = document.createElement("tr");
    const winrate = p.games > 0 ? ((p.wins / p.games) * 100).toFixed(0) + "%" : "0%";
    tr.innerHTML = `
      <td style="text-align:left;padding:8px;">${p.name}</td>
      <td>${p.wins}</td>
      <td>${p.games}</td>
      <td>${winrate}</td>
    `;
    // make top3 visually distinct
    if (idx === 0) tr.style.background = "linear-gradient(90deg,#FFD700,#ffdd66)";
    if (idx === 1) tr.style.background = "linear-gradient(90deg,#C0C0C0,#e6e6e6)";
    if (idx === 2) tr.style.background = "linear-gradient(90deg,#CD7F32,#d6a56e)";
    // clickable: show raw JSON details below the table
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => showPlayerDetails(p));
    tbody.appendChild(tr);
  });
}

// show raw details for debugging / info
function showPlayerDetails(player) {
  // remove existing details if any
  let details = document.getElementById("player-details");
  if (!details) {
    details = document.createElement("pre");
    details.id = "player-details";
    details.style.background = "rgba(0,0,0,0.6)";
    details.style.color = "white";
    details.style.padding = "12px";
    details.style.borderRadius = "8px";
    details.style.marginTop = "12px";
    container.appendChild(details);
  }
  details.textContent = JSON.stringify(player.raw, null, 2);
}

// try to find the correct path to read leaderboard data
async function findAndListen() {
  for (const p of candidatePaths) {
    try {
      const r = ref(db, p === "" ? "/" : p);
      const snap = await get(r);
      if (!snap.exists()) {
        // nothing at this path -> continue trying
        continue;
      }
      // If snapshot value is an object with child nodes that look like player entries, use it.
      const val = snap.val();
      // Heuristic: child count > 0 and keys look like usernames (strings)
      if (typeof val === "object") {
        // Use onValue to listen to this path for realtime updates
        onValue(r, (s) => {
          const v = s.val() || {};
          const players = buildPlayersFromSnapshot(v);
          renderTable(players);
        });
        // initial render done by onValue callback; return
        return;
      }
    } catch (err) {
      console.error("Error reading path", p, err);
      continue;
    }
  }
  // fallback: nothing found anywhere
  tbody.innerHTML = `<tr><td colspan="4">Geen leaderboard data gevonden in de database.</td></tr>`;
}

// small helper wrapper for get to avoid import conflict if not available
async function get(snapRef) {
  // use the imported get wrapper name from firebase.js if available (we imported only dbGet as get earlier)
  // The import above is dbGet as get - but if the environment uses slightly different signature, this should still work.
  // We assume get(ref) returns a snapshot-like object with .exists() and .val()
  try {
    return await window.get ? await window.get(snapRef) : await (async () => { 
      // fallback: call imported get (should be defined)
      // Imported get is named `get` in module scope; call it.
      // This fallback is protective; environment should satisfy import.
      return await (typeof window === "undefined" ? (await import("./firebase.js")).dbGet(snapRef) : (await import("./firebase.js")).dbGet(snapRef));
    })();
  } catch (err) {
    // If import/get mismatch, try direct firebase SDK get: but here we assume your firebase wrapper provides get
    throw err;
  }
}

// start
findAndListen().catch(err => {
  console.error("Leaderboard init error:", err);
  tbody.innerHTML = `<tr><td colspan="4">Fout bij laden leaderboard. Check console.</td></tr>`;
});
