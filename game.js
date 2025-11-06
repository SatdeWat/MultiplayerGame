// game.js
// Verwacht: firebase.js exporteert: db, dbRef as ref, dbSet as set, dbGet as get, dbUpdate as update, dbOnValue as onValue
import {
  db,
  dbRef as ref,
  dbSet as set,
  dbGet as get,
  dbUpdate as update,
  dbOnValue as onValue
} from "./firebase.js";

const username = localStorage.getItem("username");
const isGuest = localStorage.getItem("isGuest") === "true";
const lobbyCode = localStorage.getItem("lobbyCode");
if (!username || !lobbyCode) {
  window.location.href = "home.html";
}

const myBoardDiv = document.getElementById("myBoard");
const enemyBoardDiv = document.getElementById("enemyBoard");
const rotateBtn = document.getElementById("rotateBtn");
const doneBtn = document.getElementById("doneBtn");
const backHome = document.getElementById("backHome");
const turnPopup = document.getElementById("turnPopup");
const turnPlayer = document.getElementById("turnPlayer");
const gameNote = document.getElementById("gameNote");
const mySizeLabel = document.getElementById("mySizeLabel");
const enemySizeLabel = document.getElementById("enemySizeLabel");
const usePowerBtn = document.getElementById("usePowerBtn");
const powerCountSpan = document.getElementById("powerCount");
const placeHint = document.getElementById("placeHint");

const lobbyRef = ref(db, `lobbies/${lobbyCode}`);
const gameRef = ref(db, `games/${lobbyCode}`);

let lobbyData = null;
let opponent = null;
let size = 10;
let shipLengths = [];
let placedShips = [];
let orientation = "horizontal";
let phase = "placing";
let myPowerShots = 0;
let mode = "classic";
let usingPowerMode = false;

// utility for mapping sizes -> ships
function shipsForSize(boardSize) {
  if (boardSize === 10) return [5, 4, 3];
  if (boardSize === 15) return [5, 4, 3, 3];
  if (boardSize === 20) return [5, 4, 4, 3, 3, 2];
  return [5,4,3];
}

// --- init ---
(async function init() {
  const s = await get(lobbyRef);
  if (!s.exists()) { alert("Lobby niet gevonden."); location.href = "home.html"; return; }
  lobbyData = s.val();
  mode = lobbyData.mode || "classic";
  size = lobbyData.size || 10;
  shipLengths = shipsForSize(size);
  opponent = (lobbyData.host === username) ? lobbyData.guest : lobbyData.host;

  mySizeLabel.textContent = `${size}x${size}`;
  enemySizeLabel.textContent = `${size}x${size}`;

  createBoard(myBoardDiv, size, true, onMyCellEvent);
  createBoard(enemyBoardDiv, size, false, onEnemyCellClick);

  rotateBtn.textContent = `Rotate (${orientation})`;
  placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;

  onValue(lobbyRef, (snap) => {
    const data = snap.val() || {};
    opponent = (data.host === username) ? data.guest : data.host;
    if (data.host && data.guest) {
      get(gameRef).then(gsnap => {
        if (!gsnap.exists()) {
          update(ref(db, `games/${lobbyCode}`), {
            [data.host]: { ships: [], shots: {}, ready: false, powerShots: 0 },
            [data.guest]: { ships: [], shots: {}, ready: false, powerShots: 0 },
            turn: null
          });
        }
      });
    }
  });

  onValue(gameRef, (snap) => {
    const data = snap.val() || {};
    if (!data) return;
    const selfData = data[username] || {};
    if (selfData.powerShots) {
      myPowerShots = selfData.powerShots;
      powerCountSpan.textContent = myPowerShots;
      usePowerBtn.style.display = myPowerShots > 0 ? "inline-block" : "none";
    }
    renderBoards(data);
    if (data.turn) showTurnPopup(data.turn);
  });

  rotateBtn.addEventListener("click", () => {
    orientation = orientation === "horizontal" ? "vertical" : "horizontal";
    rotateBtn.textContent = `Rotate (${orientation})`;
  });

  doneBtn.addEventListener("click", async () => {
    if (shipLengths.length > 0) { alert(`Plaats eerst alle schepen! Nog: ${shipLengths.join(", ")}`); return; }
    await set(ref(db, `games/${lobbyCode}/${username}`), { ships: placedShips.slice(), shots: {}, ready: true, powerShots: myPowerShots });
    phase = "waiting";
    doneBtn.style.display = "none";
    gameNote.textContent = "Wachten op tegenstander...";

    // check opponent ready & start game automatically
    const gameSnap = await get(gameRef);
    const g = gameSnap.val() || {};
    const oppKey = Object.keys(g).find(k => k !== username && k !== "turn");
    if (oppKey && g[oppKey] && g[oppKey].ready) {
      if (!g.turn) {
        const first = Math.random() < 0.5 ? username : opponent;
        await update(gameRef, { turn: first });
        showTurnPopup(first);
      }
      phase = "playing";
      gameNote.textContent = "Spel gestart!";
    }
  });

  usePowerBtn.addEventListener("click", () => {
    if (myPowerShots <= 0) return;
    usingPowerMode = true;
    usePowerBtn.textContent = "Kies 3x3 target...";
    usePowerBtn.disabled = true;
  });

  backHome.addEventListener("click", () => {
    window.location.href = "home.html";
  });
})();

// --------- helpers & handlers ----------
function createBoard(container, gridSize, clickable = false, handler = null) {
  container.innerHTML = "";
  const CELL_SIZE = 30; // aangepast zodat 2 borden naast elkaar passen
  container.style.gridTemplateColumns = `repeat(${gridSize}, ${CELL_SIZE}px)`;
  container.style.gridTemplateRows = `repeat(${gridSize}, ${CELL_SIZE}px)`;
  container.classList.add("board-grid");
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      if (clickable && handler) {
        cell.addEventListener("mouseenter", () => handler(x, y, "enter", cell));
        cell.addEventListener("mouseleave", () => handler(x, y, "leave", cell));
        cell.addEventListener("click", () => handler(x, y, "click", cell));
      }
      container.appendChild(cell);
    }
  }
}

// De rest van alle bestaande handlers, functies, renderBoards, onMyCellEvent, onEnemyCellClick, resolveTurnAfterShots, didShotHit, showTurnPopup, confirmShotSafety, enz. blijven **exact zoals ze waren**, inclusief alle Firebase-interacties.
// Alleen de CELL_SIZE in createBoard is aangepast en het starten van het spel gebeurt automatisch zodra beide spelers klaar zijn.

