// game.js
import { db, ref, set, update, get, onValue } from "./firebase.js";

const username = localStorage.getItem("username");
const lobbyCode = localStorage.getItem("lobbyCode");
if (!username || !lobbyCode) window.location.href = "index.html";

const myBoardDiv = document.getElementById("myBoard");
const enemyBoardDiv = document.getElementById("enemyBoard");
const turnInfo = document.getElementById("turnInfo");
const gameMessage = document.getElementById("gameMessage");

let lobbyData = null;
let myShips = [];
let enemyShots = [];
let isMyTurn = false;
let phase = "placing"; // placing -> waiting -> playing
let size = 10;
let shipsCount = 3;

const lobbyRef = ref(db, "lobbies/" + lobbyCode);
const gameRef = ref(db, "games/" + lobbyCode);

async function init() {
  const snap = await get(lobbyRef);
  if (!snap.exists()) return alert("Lobby niet gevonden!");
  lobbyData = snap.val();
  size = lobbyData.size;
  shipsCount = lobbyData.ships;

  createBoard(myBoardDiv, size, true, placeShip);
  createBoard(enemyBoardDiv, size, false);

  gameMessage.textContent = `Plaats je ${shipsCount} schepen`;
}

init();

// --- Maak bord ---
function createBoard(boardDiv, size, clickable = false, clickHandler = null) {
  boardDiv.innerHTML = "";
  boardDiv.style.gridTemplateColumns = `repeat(${size}, 40px)`;
  boardDiv.style.gridTemplateRows = `repeat(${size}, 40px)`;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;
      if (clickable && clickHandler) {
        cell.addEventListener("click", () => clickHandler(x, y, cell));
      }
      boardDiv.appendChild(cell);
    }
  }
}

// --- Plaats schepen ---
function placeShip(x, y, cell) {
  if (phase !== "placing") return;
  const key = `${x},${y}`;
  if (myShips.includes(key)) return;
  myShips.push(key);
  cell.style.background = "#4caf50";
  cell.textContent = "🚢";

  if (myShips.length === shipsCount) {
    phase = "waiting";
    gameMessage.textContent = "Wachten op tegenstander...";
    set(ref(db, `games/${lobbyCode}/${username}`), { ships: myShips, shots: [] });
    checkBothReady();
  }
}

// --- Controleer of beide spelers klaar zijn ---
function checkBothReady() {
  onValue(gameRef, snapshot => {
    const data = snapshot.val() || {};
    const players = Object.keys(data).filter(p => p !== "turn");
    if (players.length === 2 && data[players[0]].ships && data[players[1]].ships) {
      startGame(players);
    }
  });
}

// --- Start spel ---
function startGame(players) {
  phase = "playing";
  const opponent = players.find(p => p !== username);

  createBoard(enemyBoardDiv, size, true, shoot);

  // Zet initiële beurt als niet aanwezig
  get(gameRef).then(snapshot => {
    const data = snapshot.val() || {};
    if (!data.turn) {
      const first = Math.random() < 0.5 ? username : opponent;
      update(gameRef, { turn: first });
    }
  });

  // Realtime updates
  onValue(gameRef, snapshot => {
    const data = snapshot.val();
    if (!data) return;
    updateTurnDisplay(data.turn || username);

    renderBoards(data);
  });
}

// --- Toon beurt info ---
function updateTurnDisplay(turn) {
  isMyTurn = turn === username;
  turnInfo.textContent = isMyTurn ? "Jij bent aan de beurt!" : "Tegenstander is aan de beurt...";
}

// --- Schieten ---
async function shoot(x, y) {
  if (!isMyTurn || phase !== "playing") return;
  const key = `${x},${y}`;
  const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
  const snap = await get(shotsRef);
  const prevShots = snap.val() || {};
  if (prevShots[key]) return; // al geschoten
  prevShots[key] = true;
  await set(shotsRef, prevShots);

  // Wissel beurt
  const dataSnap = await get(gameRef);
  const data = dataSnap.val();
  const opponent = Object.keys(data).find(p => p !== username && p !== "turn");
  await update(gameRef, { turn: opponent });
}

// --- Render boards ---
function renderBoards(data) {
  const opponent = Object.keys(data).find(p => p !== username && p !== "turn");
  const myData = data[username];
  const enemyData = data[opponent];

  // Vijand's shots op mijn bord
  if (enemyData && enemyData.shots) {
    Object.keys(enemyData.shots).forEach(k => {
      const [x, y] = k.split(",");
      const cell = [...myBoardDiv.children].find(c => c.dataset.x==x && c.dataset.y==y);
      if (!cell) return;
      if (myShips.includes(k)) { cell.style.background="red"; cell.textContent="🔥"; }
      else { cell.style.background="blue"; cell.textContent="🌊"; }
    });
  }

  // Mijn shots op vijand bord
  if (myData && myData.shots && enemyData && enemyData.ships) {
    Object.keys(myData.shots).forEach(k => {
      const [x, y] = k.split(",");
      const cell = [...enemyBoardDiv.children].find(c => c.dataset.x==x && c.dataset.y==y);
      if (!cell) return;
      if (enemyData.ships.includes(k)) { cell.style.background="red"; cell.textContent="🔥"; }
      else { cell.style.background="blue"; cell.textContent="🌊"; }
    });
  }

  checkWin(myData, enemyData);
}

// --- Controleer overwinning ---
function checkWin(myData, enemyData) {
  if (!myData || !enemyData) return;
  const enemyShipsLeft = enemyData.ships.filter(s => !myData.shots || !myData.shots[s]);
  const myShipsLeft = myShips.filter(s => !enemyData.shots || !enemyData.shots[s]);

  if (enemyShipsLeft.length === 0) {
    gameMessage.textContent = "🎉 Jij hebt gewonnen!";
    endGame(username, Object.keys(lobbyData).find(p=>p!==username));
  } else if (myShipsLeft.length === 0) {
    gameMessage.textContent = "💀 Je hebt verloren!";
    endGame(Object.keys(lobbyData).find(p=>p!==username), username);
  }
}

// --- Einde spel: update leaderboard ---
async function endGame(winner, loser) {
  const winnerRef = ref(db,"users/"+winner);
  const loserRef = ref(db,"users/"+loser);

  const winnerSnap = await get(winnerRef);
  const loserSnap = await get(loserRef);

  const winnerData = winnerSnap.val();
  const loserData = loserSnap.val();

  await update(winnerRef,{wins:(winnerData.wins||0)+1,games:(winnerData.games||0)+1});
  await update(loserRef,{games:(loserData.games||0)+1});
  async function endGame(winner, loser) {
  const isGuest = localStorage.getItem("isGuest") === "true";
  if (isGuest) return; // Gast resultaten NIET opslaan

  const winnerRef = ref(db,"users/"+winner);
  const loserRef = ref(db,"users/"+loser);

  const winnerSnap = await get(winnerRef);
  const loserSnap = await get(loserRef);

  const winnerData = winnerSnap.val();
  const loserData = loserSnap.val();

  await update(winnerRef,{wins:(winnerData.wins||0)+1,games:(winnerData.games||0)+1});
  await update(loserRef,{games:(loserData.games||0)+1});

  phase = "ended";
}
  
