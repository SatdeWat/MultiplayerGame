// leaderboard.js
import {
  db,
  dbRef as ref,
  dbGet as get,
  dbSet as set,
  dbUpdate as update,
  dbOnValue as onValue
} from "./firebase.js";

const leaderboardContainer = document.getElementById("leaderboard");
const refreshButton = document.getElementById("refreshLeaderboard");

// Laad leaderboard zodra pagina opent
initLeaderboard();

// ✅ Automatisch updaten als database wijzigt
onValue(ref(db, "leaderboard"), (snapshot) => {
  const data = snapshot.val() || {};
  renderLeaderboard(data);
});

if (refreshButton) {
  refreshButton.addEventListener("click", async () => {
    const snapshot = await get(ref(db, "leaderboard"));
    renderLeaderboard(snapshot.val() || {});
  });
}

// 📊 Functie om leaderboard te laden
async function initLeaderboard() {
  const snapshot = await get(ref(db, "leaderboard"));
  renderLeaderboard(snapshot.val() || {});
}

// 🎨 Mooi opgemaakt leaderboard
function renderLeaderboard(data) {
  leaderboardContainer.innerHTML = "";

  const players = Object.keys(data || {}).map((name) => ({
    name,
    wins: data[name].wins || 0,
    losses: data[name].losses || 0,
    ratio: data[name].wins + data[name].losses > 0
      ? (data[name].wins / (data[name].wins + data[name].losses)).toFixed(2)
      : 0
  }));

  // Sorteer op aantal wins
  players.sort((a, b) => b.wins - a.wins);

  const table = document.createElement("table");
  table.className = "leaderboard-table";

  const header = document.createElement("tr");
  header.innerHTML = `
    <th>#</th>
    <th>Speler</th>
    <th>Wins 🏆</th>
    <th>Losses 💀</th>
    <th>Winratio 🎯</th>
  `;
  table.appendChild(header);

  players.forEach((player, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${player.name}</td>
      <td>${player.wins}</td>
      <td>${player.losses}</td>
      <td>${player.ratio}</td>
    `;
    // Goud / zilver / brons styling
    if (index === 0) row.classList.add("gold");
    if (index === 1) row.classList.add("silver");
    if (index === 2) row.classList.add("bronze");

    table.appendChild(row);
  });

  leaderboardContainer.appendChild(table);
}

// 🏅 Functie om score bij te werken na spel
export async function updateLeaderboard(winner, loser) {
  const leaderboardRef = ref(db, "leaderboard");

  const snapshot = await get(leaderboardRef);
  const currentData = snapshot.val() || {};

  // Winnaar update
  if (!currentData[winner]) {
    currentData[winner] = { wins: 0, losses: 0 };
  }
  currentData[winner].wins += 1;

  // Verliezer update
  if (!currentData[loser]) {
    currentData[loser] = { wins: 0, losses: 0 };
  }
  currentData[loser].losses += 1;

  await set(leaderboardRef, currentData);
}
