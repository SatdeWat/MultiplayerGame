// leaderboard.js
import { db } from "./firebase.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const tbody = document.querySelector("#board tbody");
const container = document.querySelector(".container");

// Voeg styling toe (inline CSS via JS zodat het ALTIJD werkt)
const style = document.createElement("style");
style.textContent = `
body {
  background: radial-gradient(circle at center, #081229 0%, #000 100%);
  font-family: 'Poppins', sans-serif;
  color: #fff;
  text-align: center;
}
.container {
  max-width: 700px;
  margin: 60px auto;
  background: rgba(10, 15, 40, 0.85);
  border-radius: 20px;
  padding: 30px;
  box-shadow: 0 0 25px rgba(0, 150, 255, 0.3), inset 0 0 40px rgba(0, 0, 50, 0.5);
  backdrop-filter: blur(8px);
}
h1 {
  font-size: 2.4em;
  background: linear-gradient(90deg, #00c3ff, #ffff1c);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 25px;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: rgba(20, 30, 60, 0.9);
  border-radius: 15px;
  overflow: hidden;
  box-shadow: 0 0 20px rgba(0, 255, 255, 0.2);
}
th {
  background: rgba(0, 150, 255, 0.2);
  padding: 12px;
  color: #00d0ff;
  font-size: 1.1em;
  border-bottom: 2px solid #00baff;
}
td {
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  transition: background 0.3s, transform 0.2s;
}
tr:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: scale(1.01);
}
tr.gold {
  background: linear-gradient(90deg, rgba(255,215,0,0.25), rgba(255,255,255,0.05));
}
tr.silver {
  background: linear-gradient(90deg, rgba(192,192,192,0.25), rgba(255,255,255,0.05));
}
tr.bronze {
  background: linear-gradient(90deg, rgba(205,127,50,0.25), rgba(255,255,255,0.05));
}
button {
  margin-top: 20px;
  background: linear-gradient(90deg, #00d4ff, #0099ff);
  border: none;
  color: white;
  padding: 10px 25px;
  font-size: 1em;
  border-radius: 12px;
  cursor: pointer;
  transition: 0.3s;
  box-shadow: 0 0 10px rgba(0, 200, 255, 0.5);
}
button:hover {
  transform: scale(1.1);
  background: linear-gradient(90deg, #00ffcc, #0077ff);
  box-shadow: 0 0 15px rgba(0, 255, 255, 0.8);
}
`;
document.head.appendChild(style);

// Voeg laadtekst toe
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

  // Sorteer op wins
  players.sort((a, b) => b.wins - a.wins);

  // Vul tabel met top 3 highlight
  tbody.innerHTML = players
    .map((p, i) => {
      let crown = "";
      let rowClass = "";
      if (i === 0) { crown = "👑"; rowClass = "gold"; }
      else if (i === 1) { crown = "🥈"; rowClass = "silver"; }
      else if (i === 2) { crown = "🥉"; rowClass = "bronze"; }

      return `
        <tr class="${rowClass}">
          <td style="font-weight:600;">${crown} ${p.name}</td>
          <td>${p.wins}</td>
          <td>${p.plays}</td>
          <td>${p.winrate}%</td>
        </tr>`;
    })
    .join("");
});
