// leaderboard.js
import { db } from "./firebase.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const tbody = document.querySelector("#board tbody");
const container = document.querySelector(".container");

// ✨ Fancy animatie bij laden
container.insertAdjacentHTML(
  "beforeend",
  `<p id="loading" style="color:#bbb;font-style:italic;">Laden...</p>`
);

const statsRef = ref(db, "stats");

onValue(statsRef, (snapshot) => {
  const data = snapshot.val();
  const loading = document.getElementById("loading");
  if (loading) loading.remove();

  if (!data) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;color:#999;">Geen data gevonden 😢</td></tr>`;
    return;
  }

  const players = Object.entries(data).map(([name, info]) => {
    const wins = Number(info.wins || 0);
    const plays = Number(info.plays || 0);
    const winrate = plays > 0 ? ((wins / plays) * 100).toFixed(1) : 0;
    return { name, wins, plays, winrate };
  });

  players.sort((a, b) => b.wins - a.wins);

  tbody.innerHTML = players
    .map((p, i) => {
      let crown = "";
      if (i === 0) crown = "👑";
      if (i === 1) crown = "🥈";
      if (i === 2) crown = "🥉";

      return `
        <tr class="row-${i < 3 ? "top" : "normal"}">
          <td>${crown} <span class="player-name">${p.name}</span></td>
          <td>${p.wins}</td>
          <td>${p.plays}</td>
          <td>${p.winrate}%</td>
        </tr>`;
    })
    .join("");
});
