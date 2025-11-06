// game.js
import {
  db,
  dbRef as ref,
  dbSet as set,
  dbGet as get,
  dbUpdate as update,
  dbOnValue as onValue
} from "./firebase.js";

const username = localStorage.getItem("username");
const lobbyCode = localStorage.getItem("lobbyCode");
if (!username || !lobbyCode) location.href = "home.html";

const myBoardDiv = document.getElementById("myBoard");
const enemyBoardDiv = document.getElementById("enemyBoard");
const rotateBtn = document.getElementById("rotateBtn");
const doneBtn = document.getElementById("doneBtn");
const backHome = document.getElementById("backHome");
const turnPopup = document.getElementById("turnPopup");
const turnPlayer = document.getElementById("turnPlayer");
const gameNote = document.getElementById("gameNote");
const placeHint = document.getElementById("placeHint");
const myNameLabel = document.getElementById("myName");
const enemyNameLabel = document.getElementById("enemyName");
const endScreen = document.getElementById("endScreen");
const endMessage = document.getElementById("endMessage");
const rematchBtn = document.getElementById("rematchBtn");

const lobbyRef = ref(db, `lobbies/${lobbyCode}`);
const gameRef = ref(db, `games/${lobbyCode}`);

let lobbyData = null;
let opponent = null;
let size = 10;
let mode = "classic";
let orientation = "horizontal";
let shipLengths = [];
let placedShips = [];
let phase = "placing";
let myReady = false;
let usingPowerMode = false;
let myPowerShots = 0;

// helper
function shipsForSize(boardSize) {
  if (boardSize === 10) return [5, 4, 3];
  if (boardSize === 15) return [5, 4, 3, 3];
  return [5, 4, 4, 3, 3, 2];
}

// === INIT ===
(async function init() {
  const s = await get(lobbyRef);
  if (!s.exists()) return (location.href = "home.html");
  lobbyData = s.val();
  size = lobbyData.size || 10;
  mode = lobbyData.mode || "classic";
  shipLengths = shipsForSize(size);
  opponent = lobbyData.host === username ? lobbyData.guest : lobbyData.host;

  myNameLabel.textContent = username;
  enemyNameLabel.textContent = opponent || "Wachten...";

  // Borden naast elkaar (flex)
  myBoardDiv.parentElement.style.display = "flex";
  myBoardDiv.parentElement.style.justifyContent = "center";
  myBoardDiv.style.marginRight = "40px";

  createBoard(myBoardDiv, size, true, onMyCellEvent);
  createBoard(enemyBoardDiv, size, false, onEnemyCellClick);

  rotateBtn.textContent = `Draai (${orientation})`;
  placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;

  // Firebase listener
  onValue(gameRef, (snap) => {
    const data = snap.val() || {};
    if (!data) return;
    renderBoards(data);
    if (data.turn) showTurnPopup(data.turn);

    const self = data[username];
    const opp = data[opponent];
    if (self && opp && self.ready && opp.ready && !data.turn) {
      const first = Math.random() < 0.5 ? username : opponent;
      update(gameRef, { turn: first });
      showTurnPopup("Game starts!");
      setTimeout(() => showTurnPopup(first), 2500);
      phase = "playing";
    }
    checkWin(data);
  });

  rotateBtn.onclick = () => {
    orientation = orientation === "horizontal" ? "vertical" : "horizontal";
    rotateBtn.textContent = `Draai (${orientation})`;
  };

  doneBtn.onclick = async () => {
    if (shipLengths.length > 0)
      return alert("Plaats eerst alle schepen!");
    myReady = true;
    rotateBtn.style.display = "none";
    doneBtn.style.display = "none";
    placeHint.textContent = "Wachten op tegenstander...";
    myNameLabel.innerHTML = `${username} ✅`;
    await update(ref(db, `games/${lobbyCode}/${username}`), {
      ships: placedShips,
      shots: {},
      ready: true,
      powerShots: 0,
    });
  };

  backHome.onclick = () => (location.href = "home.html");
  rematchBtn.onclick = () => resetForRematch();
})();

// === CREATE BOARD ===
function createBoard(container, gridSize, isMyBoard, handler) {
  container.innerHTML = "";
  container.className = "board-grid";
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${gridSize}, 40px)`;
  container.style.gridTemplateRows = `repeat(${gridSize}, 40px)`;
  container.style.gap = "2px";
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      if (isMyBoard) {
        cell.addEventListener("mouseenter", () => handler(x, y, "enter"));
        cell.addEventListener("mouseleave", () => handler(x, y, "leave"));
        cell.addEventListener("click", () => handler(x, y, "click"));
      } else {
        cell.addEventListener("click", () => handler(x, y, "click"));
      }
      container.appendChild(cell);
    }
  }
}

// === PLACE SHIPS ===
function onMyCellEvent(x, y, type) {
  if (phase !== "placing") return;
  if (shipLengths.length === 0) return;
  const len = shipLengths[0];
  const coords = [];
  for (let i = 0; i < len; i++) {
    const cx = x + (orientation === "horizontal" ? i : 0);
    const cy = y + (orientation === "vertical" ? i : 0);
    if (cx >= size || cy >= size) return;
    coords.push(`${cx},${cy}`);
  }

  if (type === "enter" || type === "leave") {
    [...myBoardDiv.children].forEach((c) =>
      c.classList.remove("preview-valid", "preview-bad")
    );
    if (type === "enter") {
      const overlap = coords.some((c) => placedShips.flat().includes(c));
      coords.forEach((key) => {
        const cell = findCell(myBoardDiv, key);
        if (cell)
          cell.classList.add(overlap ? "preview-bad" : "preview-valid");
      });
    }
  }

  if (type === "click") {
    const overlap = coords.some((c) => placedShips.flat().includes(c));
    if (overlap) return alert("Schepen mogen niet overlappen!");
    placedShips.push(coords);
    coords.forEach((key) => {
      const cell = findCell(myBoardDiv, key);
      if (cell) {
        cell.classList.remove("preview-valid");
        cell.style.background = "#4caf50";
        cell.textContent = "🚢";
      }
    });
    shipLengths.shift();
    if (shipLengths.length > 0) {
      placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;
    } else {
      placeHint.textContent = "Alle schepen geplaatst!";
      doneBtn.style.display = "inline-block";
    }
  }
}

// === ENEMY CLICKS ===
async function onEnemyCellClick(x, y, type) {
  if (type !== "click" || phase !== "playing") return;
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  if (g.turn !== username) return alert("Niet jouw beurt!");
  const key = `${x},${y}`;
  const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
  const snap = await get(shotsRef);
  const current = snap.exists() ? snap.val() : {};
  if (current[key]) return;
  current[key] = true;
  await update(shotsRef, current);
  await resolveTurnAfterShot();
}

// === TURN LOGIC ===
async function resolveTurnAfterShot() {
  const gsnap = await get(gameRef);
  const g = gsnap.val();
  const oppShips = g[opponent].ships;
  const myShots = g[username].shots;
  const hit = Object.keys(myShots).some((s) =>
    oppShips.flat().includes(s)
  );
  if (mode === "streak" && hit) {
    await update(gameRef, { turn: username });
  } else {
    await update(gameRef, { turn: opponent });
  }
}

// === RENDER ===
function renderBoards(data) {
  const me = data[username] || {};
  const opp = data[opponent] || {};
  [...myBoardDiv.children].forEach((cell) => {
    const key = `${cell.dataset.x},${cell.dataset.y}`;
    if (placedShips.flat().includes(key)) {
      cell.style.background = "#4caf50";
      cell.textContent = "🚢";
    } else {
      cell.style.background = "rgba(255,255,255,0.05)";
      cell.textContent = "";
    }
  });
  const oppShots = opp.shots ? Object.keys(opp.shots) : [];
  oppShots.forEach((key) => {
    const cell = findCell(myBoardDiv, key);
    if (!cell) return;
    if (placedShips.flat().includes(key)) {
      cell.style.background = "#d9534f";
      cell.textContent = "🔥";
    } else {
      cell.style.background = "#2196f3";
      cell.textContent = "🌊";
    }
  });

  [...enemyBoardDiv.children].forEach((c) => {
    c.style.background = "rgba(255,255,255,0.05)";
    c.textContent = "";
  });
  const myShots = me.shots ? Object.keys(me.shots) : [];
  myShots.forEach((key) => {
    const cell = findCell(enemyBoardDiv, key);
    if (!cell) return;
    const hit = (opp.ships || []).flat().includes(key);
    if (hit) {
      cell.style.background = "#d9534f";
      cell.textContent = "🔥";
    } else {
      cell.style.background = "#2196f3";
      cell.textContent = "🌊";
    }
  });
}

// === TURN POPUP ===
function showTurnPopup(name) {
  turnPopup.style.display = "block";
  turnPlayer.textContent = name === "Game starts!" ? name : (name === username ? "Jij bent aan de beurt!" : `${name} is aan de beurt!`);
  turnPopup.style.background =
    name === username ? "linear-gradient(90deg,#00e676,#00c853)" : "#333";
  setTimeout(() => (turnPopup.style.display = "none"), 2500);
}

// === END GAME ===
function checkWin(data) {
  const me = data[username];
  const opp = data[opponent];
  if (!me || !opp) return;
  const myHits = Object.keys(opp.shots || {}).filter((s) =>
    placedShips.flat().includes(s)
  );
  const oppHits = Object.keys(me.shots || {}).filter((s) =>
    (opp.ships || []).flat().includes(s)
  );
  const myLost = myHits.length === placedShips.flat().length;
  const oppLost = oppHits.length === (opp.ships || []).flat().length;
  if (myLost || oppLost) {
    phase = "ended";
    endScreen.style.display = "flex";
    endMessage.textContent = myLost
      ? `${opponent} heeft gewonnen!`
      : "Jij hebt gewonnen!";
  }
}

// === REMATCH ===
async function resetForRematch() {
  placedShips = [];
  shipLengths = shipsForSize(size);
  phase = "placing";
  myReady = false;
  doneBtn.style.display = "none";
  rotateBtn.style.display = "inline-block";
  endScreen.style.display = "none";
  placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;
  createBoard(myBoardDiv, size, true, onMyCellEvent);
  createBoard(enemyBoardDiv, size, false, onEnemyCellClick);
  await set(gameRef, {
    [username]: { ships: [], shots: {}, ready: false },
    [opponent]: { ships: [], shots: {}, ready: false },
    turn: null,
  });
}

// === UTILS ===
function findCell(board, key) {
  const [x, y] = key.split(",");
  return [...board.children].find(
    (c) => c.dataset.x == x && c.dataset.y == y
  );
}
