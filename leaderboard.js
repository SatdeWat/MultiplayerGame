// leaderboard.js
import { db } from "./firebase.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Verwijzing naar de tabel-body
const tbody = document.querySelector("#board tbody");

// Verwijzing naar 'stats' in de database
const statsRef = ref(db, "stats");

// Luister naar realtime updates
onValue(statsRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) {
    tbody.innerHTML = `<tr><td colspan="4">Geen data gevonden</td></tr>`;
    return;
  }

  // Zet spelers om naar array
  const players = Object.entries(data).map(([name, info]) => {
    const wins = Number(info.wins || 0);
    const plays = Number(info.plays || 0);
    const winrate = plays > 0 ? ((wins / plays) * 100).toFixed(1) : 0;
    return { name, wins, plays, winrate };
  });

  // Sorteer op wins (desc)
  players.sort((a, b) => b.wins - a.wins);

  // Vul tabel
  tbody.innerHTML = players
    .map(
      (p, i) => `
      <tr style="background:${i === 0 ? "#FFD70033" : i === 1 ? "#C0C0C033" : i === 2 ? "#CD7F3233" : "transparent"}">
        <td>${p.name}</td>
        <td>${p.wins}</td>
        <td>${p.plays}</td>
        <td>${p.winrate}%</td>
      </tr>`
    )
    .join("");
});
