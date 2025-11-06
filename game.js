// game.js
import { db, ref, get, set, update, onValue } from "./firebase.js";

const username = localStorage.getItem("username");
const lobbyCode = localStorage.getItem("lobbyCode");
if (!username || !lobbyCode) location.href = "index.html";

const myBoard = document.getElementById("myBoard");
const enemyBoard = document.getElementById("enemyBoard");
const startBtn = document.getElementById("startBtn");
const turnPopup = document.getElementById("turnPopup");
const turnPlayer = document.getElementById("turnPlayer");

let boardSize = 10;
let myShips = [];
let myHits = [];
let enemyHits = [];
let isHost = false;
let currentTurn = "";
let gameStarted = false;
let placingShips = true;
let shipCount = 3;

// 🟦 Setup uit database
get(ref(db, "lobbies/" + lobbyCode)).then((snap) => {
  const data = snap.val();
  if (!data) return alert("Lobby bestaat niet!");
  boardSize = data.size;
  shipCount = data.size === 10 ? 3 : data.size === 15 ? 4 : 6;
  isHost = (data.host === username);

  if (!isHost && !data.guest) {
    update(ref(db, "lobbies/" + lobbyCode), { guest: username });
  }

  createBoards();
  listenForGame();
});

// 🧱 Maak de borden
function createBoards() {
  myBoard.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;
  enemyBoard.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;

  for (let i=0; i<boardSize*boardSize; i++) {
    const myCell = document.createElement("div");
    myCell.className = "cell";
    myCell.dataset.index = i;
    myCell.onclick = () => placeShip(i);

    const enemyCell = document.createElement("div");
    enemyCell.className = "cell";
    enemyCell.dataset.index = i;
    enemyCell.onclick = () => fireAt(i);

    myBoard.appendChild(myCell);
    enemyBoard.appendChild(enemyCell);
  }
}

// 🚢 Schepen plaatsen
function placeShip(i) {
  if (!placingShips) return;
  if (myShips.includes(i)) return alert("Daar ligt al een schip!");
  if (myShips.length >= shipCount) return alert("Je hebt al al je schepen geplaatst!");
  myShips.push(i);
  document.querySelector(`#myBoard .cell[data-index="${i}"]`).style.background = "#00cc66";
}

// 🟢 Start game
startBtn.onclick = async () => {
  if (myShips.length < shipCount) return alert("Plaats eerst al je schepen!");
  placingShips = false;
  document.getElementById("startBtn").disabled = true;

  const snap = await get(ref(db, "games/" + lobbyCode));
  let gameData = snap.exists() ? snap.val() : {};

  gameData[username] = { ships: myShips, hits: [] };
  gameData.size = boardSize;

  await set(ref(db, "games/" + lobbyCode), gameData);

  if (Object.keys(gameData).length >= 3) startGame(gameData);
};

// 👀 Luister realtime
function listenForGame() {
  onValue(ref(db, "games/" + lobbyCode), (snap) => {
    if (!snap.exists()) return;
    const data = snap.val();
    if (Object.keys(data).length < 3) return;

    if (!gameStarted) startGame(data);
    else updateBoards(data);
  });
}

// 🎯 Start spel
function startGame(data) {
  gameStarted = true;
  currentTurn = Object.keys(data)[0];
  updateTurnPopup();
  alert("Spel gestart!");
}

// 🔥 Schieten
function fireAt(i) {
  if (!gameStarted || currentTurn !== username) return;
  const cell = enemyBoard.querySelector(`[data-index="${i}"]`);
  if (cell.classList.contains("hit") || cell.classList.contains("miss")) return;

  get(ref(db, "games/" + lobbyCode)).then((snap) => {
    const gameData = snap.val();
    const enemy = Object.keys(gameData).find(u => u !== username && u !== "size");
    const enemyShips = gameData[enemy].ships;
    const myData = gameData[username];

    if (enemyShips.includes(i)) {
      cell.classList.add("hit");
      cell.innerHTML = "🔥";
      myData.hits.push(i);
      checkSunk(enemyShips, myData.hits, cell);
    } else {
      cell.classList.add("miss");
      cell.innerHTML = "🌊";
      currentTurn = enemy;
    }

    update(ref(db, "games/" + lobbyCode + "/" + username), myData);
    update(ref(db, "games/" + lobbyCode), { currentTurn });

    updateTurnPopup();
    checkWin(gameData);
  });
}

// 💀 Check of schip gezonken is
function checkSunk(enemyShips, myHits, cell) {
  const sunkShips = enemyShips.every(pos => myHits.includes(pos));
  if (sunkShips) {
    cell.classList.remove("hit");
    cell.classList.add("sunk");
    cell.innerHTML = "💀";
  }
}

// 🧠 Update beurt-popup
function updateTurnPopup() {
  turnPlayer.innerText = currentTurn;
  turnPopup.style.background = currentTurn === username ? "rgba(0,255,0,0.3)" : "rgba(255,0,0,0.3)";
}

// 🧨 Update borden realtime
function updateBoards(data) {
  const enemy = Object.keys(data).find(u => u !== username && u !== "size");
  const myData = data[username];
  const enemyData = data[enemy];

  // Toon hits van tegenstander
  enemyData.hits?.forEach(i => {
    const cell = myBoard.querySelector(`[data-index="${i}"]`);
    if (!cell.classList.contains("hit")) {
      cell.classList.add("hit");
      cell.innerHTML = "🔥";
    }
  });
}

// 🏆 Win check
function checkWin(data) {
  const players = Object.keys(data).filter(u => u !== "size");
  for (const player of players) {
    const enemy = players.find(u => u !== player);
    const enemyShips = data[enemy].ships;
    const hits = data[player].hits;

    if (enemyShips.every(pos => hits.includes(pos))) {
      endGame(player, enemy);
    }
  }
}

// 🏁 Game afgelopen
async function endGame(winner, loser) {
  alert(`💥 ${winner} heeft gewonnen!`);
  await update(ref(db, "users/" + winner), {
    wins: (await get(ref(db, "users/" + winner))).val().wins + 1,
    games: (await get(ref(db, "users/" + winner))).val().games + 1
  });
  await update(ref(db, "users/" + loser), {
    games: (await get(ref(db, "users/" + loser))).val().games + 1
  });

  await set(ref(db, "lobbies/" + lobbyCode), null);
  await set(ref(db, "games/" + lobbyCode), null);
  window.location.href = "leaderboard.html";
}
