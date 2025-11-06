import { db, ref, onValue } from "./firebase.js";

const tbody = document.querySelector("tbody");

onValue(ref(db, "users"), (snapshot) => {
  const data = snapshot.val() || {};
  const sorted = Object.entries(data).sort((a,b) => (b[1].wins||0) - (a[1].wins||0));

  tbody.innerHTML = "";
  sorted.forEach(([name, val]) => {
    const wins = val.wins || 0;
    const games = val.games || 0;
    const rate = games ? ((wins / games) * 100).toFixed(1) + "%" : "0%";

    tbody.innerHTML += `
      <tr>
        <td>${name}</td>
        <td>${wins}</td>
        <td>${games}</td>
        <td>${rate}</td>
      </tr>
    `;
  });
});
