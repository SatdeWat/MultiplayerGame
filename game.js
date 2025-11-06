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
const lobbyCode = localStorage.getItem("lobbyCode");
if (!username || !lobbyCode) {
  window.location.href = "home.html";
}

// DOM references
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

const myBoardCard = myBoardDiv.closest(".board-card");
const enemyBoardCard = enemyBoardDiv.closest(".board-card");
const myBoardTitle = myBoardCard ? myBoardCard.querySelector(".board-title") : null;
const enemyBoardTitle = enemyBoardCard ? enemyBoardCard.querySelector(".board-title") : null;

// Firebase refs
const lobbyRef = ref(db, `lobbies/${lobbyCode}`);
const gameRef = ref(db, `games/${lobbyCode}`);

// State
let lobbyData = null;
let opponent = null;
let size = 10;
let mode = "classic";
let orientation = "horizontal";
let shipLengths = [];
let placedShips = []; // local ships array-of-arrays, e.g. [["0,0","1,0"], ...]
let phase = "placing"; // placing -> waiting -> playing -> ended
let myPowerShots = 0;
let usingPowerMode = false;
let lastTurnShown = null; // to update turnPopup persistently

// cell size small so two boards fit side-by-side
const CELL_PX = 26;

// map size->ships
function shipsForSize(boardSize) {
  if (boardSize === 10) return [5, 4, 3];
  if (boardSize === 15) return [5, 4, 3, 3];
  if (boardSize === 20) return [5, 4, 4, 3, 3, 2];
  return [5, 4, 3];
}

// ---------- UI helpers ----------
function ensureReadyIndicator(titleEl) {
  if (!titleEl) return null;
  let span = titleEl.querySelector(".ready-indicator");
  if (!span) {
    span = document.createElement("span");
    span.className = "ready-indicator";
    span.style.marginLeft = "8px";
    span.style.fontWeight = "700";
    titleEl.appendChild(span);
  }
  return span;
}
function setReadyIndicator(titleEl, ready) {
  const span = ensureReadyIndicator(titleEl);
  if (!span) return;
  span.textContent = ready ? "✅" : "";
}
function ensureRematchIndicator(titleEl) {
  if (!titleEl) return null;
  let span = titleEl.querySelector(".rematch-indicator");
  if (!span) {
    span = document.createElement("span");
    span.className = "rematch-indicator";
    span.style.marginLeft = "8px";
    span.style.fontSize = "12px";
    span.style.color = "#ff6f00";
    titleEl.appendChild(span);
  }
  return span;
}
function setRematchIndicator(titleEl, requested) {
  const span = ensureRematchIndicator(titleEl);
  if (!span) return;
  span.textContent = requested ? " (rematch aangevraagd)" : "";
}

function persistTurnPopup(name) {
  // Show who is currently on turn and keep it visible (persistent).
  if (!turnPopup) return;
  const text = name === username ? "Jij" : name;
  turnPopup.innerHTML = `Aan de beurt: <strong id="turnPlayer">${text}</strong>`;
  turnPopup.style.display = "block";
  lastTurnShown = name;
}
function showTemp(message, ms = 1200) {
  if (!turnPopup) return;
  turnPopup.innerHTML = `<strong>${message}</strong>`;
  turnPopup.style.display = "block";
  setTimeout(() => {
    // After the temp banner we restore persistent turn if known
    if (lastTurnShown) persistTurnPopup(lastTurnShown);
    else turnPopup.style.display = "none";
  }, ms);
}
function showStartThenPersistTurn(first) {
  // show "Game starts!" briefly then persistently show who starts
  showTemp("Game starts!", 1100);
  setTimeout(() => persistTurnPopup(first), 1100);
}

// End modal & rematch button
let endModalEl = null;
function showEndModal(winnerText) {
  if (!endModalEl) {
    endModalEl = document.createElement("div");
    endModalEl.style.position = "fixed";
    endModalEl.style.left = "50%";
    endModalEl.style.top = "26%";
    endModalEl.style.transform = "translateX(-50%)";
    endModalEl.style.zIndex = "9999";
    endModalEl.style.background = "#fff";
    endModalEl.style.padding = "16px";
    endModalEl.style.borderRadius = "10px";
    endModalEl.style.boxShadow = "0 12px 36px rgba(0,0,0,0.25)";
    endModalEl.style.textAlign = "center";
    document.body.appendChild(endModalEl);
  }
  endModalEl.innerHTML = `<div style="font-weight:700;font-size:18px;margin-bottom:10px">${winnerText} heeft gewonnen!</div>`;
  const rem = document.createElement("button");
  rem.textContent = "Rematch";
  rem.style.padding = "8px 12px";
  rem.style.borderRadius = "8px";
  rem.style.cursor = "pointer";
  rem.addEventListener("click", async () => {
    await update(ref(db, `games/${lobbyCode}/rematchRequests`), { [username]: true });
    // show local feedback
    const s = document.createElement("div");
    s.textContent = "Rematch aangevraagd, wachten op tegenstander...";
    s.style.marginTop = "8px";
    endModalEl.appendChild(s);
    // show local rematch indicator too
    setRematchIndicator(myBoardTitle, true);
  });
  endModalEl.appendChild(rem);
  endModalEl.style.display = "block";
}
function hideEndModal() {
  if (!endModalEl) return;
  endModalEl.style.display = "none";
  endModalEl.innerHTML = "";
}

// widen container so both boards fit nicer
function widenContainer() {
  const container = document.querySelector(".container");
  if (container) {
    container.style.maxWidth = "1400px";
    container.style.width = "95%";
  }
  const boardsContainer = document.querySelector(".boards");
  if (boardsContainer) {
    boardsContainer.style.display = "flex";
    boardsContainer.style.gap = "18px";
    boardsContainer.style.alignItems = "flex-start";
    boardsContainer.style.justifyContent = "center";
    boardsContainer.style.overflowX = "auto";
  }
}

// ---------- INIT ----------
(async function init() {
  widenContainer();

  // create ready/rematch indicators early
  ensureReadyIndicator(myBoardTitle);
  ensureReadyIndicator(enemyBoardTitle);
  ensureRematchIndicator(myBoardTitle);
  ensureRematchIndicator(enemyBoardTitle);

  // initial DB read
  const s = await get(lobbyRef);
  if (!s.exists()) { alert("Lobby niet gevonden."); location.href = "home.html"; return; }
  lobbyData = s.val();
  size = lobbyData.size || 10;
  mode = lobbyData.mode || "classic";
  shipLengths = shipsForSize(size);
  opponent = (lobbyData.host === username) ? lobbyData.guest : lobbyData.host;

  mySizeLabel.textContent = `${size}x${size}`;
  enemySizeLabel.textContent = `${size}x${size}`;
  placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;

  // create boards
  createBoard(myBoardDiv, size, true, onMyCellEvent);
  createBoard(enemyBoardDiv, size, false, onEnemyCellClick);

  rotateBtn.textContent = `Rotate (${orientation})`;

  // ensure /games node exists when both players present
  onValue(lobbyRef, async (lsnap) => {
    const data = lsnap.val() || {};
    lobbyData = data;
    opponent = (data.host === username) ? data.guest : data.host;
    if (data.host && data.guest) {
      const gsnap = await get(gameRef);
      if (!gsnap.exists()) {
        await set(gameRef, {
          [data.host]: { ships: [], shots: {} },
          [data.guest]: { ships: [], shots: {} },
          turn: null,
          rematchRequests: {}
        });
      }
    }
  });

  // main games listener
  onValue(gameRef, async (gsnap) => {
    const data = gsnap.val() || {};
    if (!data) return;

    // players present keys
    const playerKeys = Object.keys(data).filter(k => k !== "turn" && k !== "rematchRequests");
    if (!opponent && playerKeys.length >= 2) opponent = playerKeys.find(k => k !== username);

    const meNode = data[username] || {};
    const oppNode = data[opponent] || {};

    // update powerShots UI
    if (meNode.powerShots !== undefined) {
      myPowerShots = meNode.powerShots || 0;
      powerCountSpan.textContent = myPowerShots;
      usePowerBtn.style.display = myPowerShots > 0 ? "inline-block" : "none";
    }

    // adopt our ships from DB if present (e.g., page reload)
    if (meNode.ships && Array.isArray(meNode.ships) && meNode.ships.length > 0 && placedShips.length === 0) {
      placedShips = meNode.ships.slice();
      // render them locally
      placedShips.forEach(ship => ship.forEach(coord => {
        const c = findCell(myBoardDiv, coord);
        if (c) { c.style.background = "#4caf50"; c.textContent = "🚢"; }
      }));
      shipLengths = [];
      doneBtn.style.display = "none";
      if (rotateBtn) rotateBtn.style.display = "none";
    }

    // ready indicators
    setReadyIndicator(myBoardTitle, !!(meNode && meNode.ready));
    setReadyIndicator(enemyBoardTitle, !!(oppNode && oppNode.ready));

    // rematch indicators
    const remReq = data.rematchRequests || {};
    setRematchIndicator(myBoardTitle, !!remReq[username]);
    setRematchIndicator(enemyBoardTitle, !!remReq[opponent]);

    // render visuals (shots/hits and sunk detection)
    renderBoards(data);

    // both ready -> start playing
    if (meNode && oppNode && meNode.ready && oppNode.ready && phase !== "playing") {
      if (!data.turn) {
        const first = Math.random() < 0.5 ? username : opponent;
        await update(gameRef, { turn: first });
        lastTurnShown = first;
        showStartThenPersistTurn(first);
      } else {
        lastTurnShown = data.turn;
        showStartThenPersistTurn(data.turn);
      }
      phase = "playing";
      gameNote.textContent = "Spel gestart!";
      placeHint.textContent = ""; // remove waiting hint
      if (rotateBtn) rotateBtn.style.display = "none";
    }

    // always persistently show turn if set
    if (data.turn) {
      lastTurnShown = data.turn;
      persistTurnPopup(data.turn);
    }

    // handle rematch accepted & new game reset: if remReq both true -> reset DB (serverless)
    if (remReq[username] && remReq[opponent]) {
      // reset DB nodes for next round
      if (lobbyData && lobbyData.host && lobbyData.guest) {
        await set(gameRef, {
          [lobbyData.host]: { ships: [], shots: {}, ready: false, powerShots: 0 },
          [lobbyData.guest]: { ships: [], shots: {}, ready: false, powerShots: 0 },
          turn: null,
          rematchRequests: {}
        });
      }
      // reset local
      placedShips = [];
      shipLengths = shipsForSize(size);
      phase = "placing";
      placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;
      doneBtn.style.display = "none";
      if (rotateBtn) rotateBtn.style.display = "inline-block";
      hideEndModal();
      createBoard(myBoardDiv, size, true, onMyCellEvent);
      createBoard(enemyBoardDiv, size, false, onEnemyCellClick);
      // clear persistent turn popup
      if (turnPopup) turnPopup.style.display = "none";
      lastTurnShown = null;
    }

    // winner detection
    const winner = detectWinner(data);
    if (winner && phase !== "ended") {
      phase = "ended";
      showEndModal(winner === username ? "Jij" : winner);
      // hide persistent turn (optional)
      // turnPopup.style.display = "none";
    }
  });

  // rotate toggle
  rotateBtn.addEventListener("click", () => {
    orientation = (orientation === "horizontal") ? "vertical" : "horizontal";
    rotateBtn.textContent = `Rotate (${orientation})`;
  });

  // done -> write ships + ready
  doneBtn.addEventListener("click", async () => {
    if (shipLengths.length > 0) {
      alert(`Plaats eerst alle schepen! Nog: ${shipLengths.join(", ")}`);
      return;
    }
    await update(ref(db, `games/${lobbyCode}/${username}`), {
      ships: placedShips.slice(),
      shots: {},
      ready: true,
      powerShots: myPowerShots || 0
    });
    phase = "waiting";
    doneBtn.style.display = "none";
    if (rotateBtn) rotateBtn.style.display = "none";
    placeHint.textContent = "Wachten op tegenstander...";
    setReadyIndicator(myBoardTitle, true);
  });

  usePowerBtn.addEventListener("click", () => {
    if (myPowerShots <= 0) return;
    usingPowerMode = true;
    usePowerBtn.disabled = true;
    usePowerBtn.textContent = "Kies 3x3 target...";
  });

  backHome.addEventListener("click", () => { location.href = "home.html"; });
})(); // end init

// ---------- create board ----------
function createBoard(container, gridSize, clickable = false, handler = null) {
  container.innerHTML = "";
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${gridSize}, ${CELL_PX}px)`;
  container.style.gridTemplateRows = `repeat(${gridSize}, ${CELL_PX}px)`;
  container.classList.add("board-grid");
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.style.width = `${CELL_PX}px`;
      cell.style.height = `${CELL_PX}px`;
      cell.style.display = "flex";
      cell.style.alignItems = "center";
      cell.style.justifyContent = "center";
      cell.style.fontSize = "13px";
      cell.style.boxSizing = "border-box";
      cell.style.border = "1px solid rgba(0,0,0,0.06)";
      cell.style.background = "rgba(255,255,255,0.03)";
      if (clickable && handler) {
        cell.addEventListener("mouseenter", () => handler(x, y, "enter", cell));
        cell.addEventListener("mouseleave", () => handler(x, y, "leave", cell));
        cell.addEventListener("click", () => handler(x, y, "click", cell));
      } else if (handler) {
        cell.addEventListener("click", () => handler(x, y, "click", cell));
      }
      container.appendChild(cell);
    }
  }
}

// ---------- placing handler ----------
function onMyCellEvent(x, y, type, cellEl) {
  if (phase !== "placing" && phase !== "waiting") return;
  if (shipLengths.length === 0) return;
  const length = shipLengths[0];
  const coords = [];
  for (let i = 0; i < length; i++) {
    const cx = x + (orientation === "horizontal" ? i : 0);
    const cy = y + (orientation === "vertical" ? i : 0);
    if (cx >= size || cy >= size) { coords.length = 0; break; }
    coords.push(`${cx},${cy}`);
  }

  if (type === "enter") {
    const overlap = coords.some(c => placedShips.flat().includes(c));
    coords.forEach(coord => {
      const cc = findCell(myBoardDiv, coord);
      if (cc) cc.classList.add(overlap ? "preview-bad" : "preview-valid");
    });
  } else if (type === "leave") {
    [...myBoardDiv.children].forEach(c => c.classList.remove("preview-valid","preview-bad"));
  } else if (type === "click") {
    if (coords.length === 0) { alert("OOB: zet binnen het bord."); return; }
    if (coords.some(c => placedShips.flat().includes(c))) { alert("Schepen mogen niet overlappen."); return; }
    placedShips.push(coords.slice());
    coords.forEach(coord => {
      const cc = findCell(myBoardDiv, coord);
      if (cc) { cc.classList.remove("preview-valid"); cc.style.background = "#4caf50"; cc.textContent = "🚢"; }
    });
    shipLengths.shift();
    if (shipLengths.length > 0) placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;
    else { placeHint.textContent = `Alle schepen geplaatst — klik Klaar`; doneBtn.style.display = "inline-block"; }
  }
}

// ---------- enemy click (shoot) ----------
async function onEnemyCellClick(x, y, type, cellEl) {
  if (type !== "click") return;
  if (phase !== "playing") return;
  if (!opponent) return;

  // check turn from DB
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  if (!g.turn) return;
  if (g.turn !== username) return; // not your turn

  if (usingPowerMode) {
    // 3x3
    const toShot = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = x + dx, sy = y + dy;
        if (sx >= 0 && sx < size && sy >= 0 && sy < size) toShot.push(`${sx},${sy}`);
      }
    }
    const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
    const snapShots = await get(shotsRef);
    const current = snapShots.exists() ? snapShots.val() : {};
    toShot.forEach(k => current[k] = true);
    await update(shotsRef, current);
    myPowerShots = Math.max(0, myPowerShots - 1);
    await update(ref(db, `games/${lobbyCode}/${username}`), { powerShots: myPowerShots });
    usingPowerMode = false;
    usePowerBtn.disabled = false;
    usePowerBtn.textContent = `Use PowerShot (${myPowerShots})`;
    await resolveTurnAfterShots(current, true);
    return;
  }

  // normal shot
  const key = `${x},${y}`;
  const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
  const snapShots = await get(shotsRef);
  const current = snapShots.exists() ? snapShots.val() : {};
  if (current[key]) return;
  current[key] = true;
  await update(shotsRef, current);
  await resolveTurnAfterShots(current, false);
}

// ---------- hit detection & turn logic ----------
function didShotHit(shotsObj, opponentShipsGrouped) {
  for (let si = 0; si < opponentShipsGrouped.length; si++) {
    const ship = opponentShipsGrouped[si];
    const shipHitCount = ship.filter(c => shotsObj[c]).length;
    if (shipHitCount > 0) {
      const sunk = shipHitCount === ship.length;
      return { hit: true, sunkIndex: sunk ? si : null };
    }
  }
  return { hit: false, sunkIndex: null };
}

async function resolveTurnAfterShots(myShotsObj, wasPowerShot) {
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  const oppData = g[opponent] || {};
  const oppShips = oppData.ships || [];
  const result = didShotHit(myShotsObj, oppShips);

  if (mode === "streak") {
    if (result.hit) await update(gameRef, { turn: username });
    else await update(gameRef, { turn: opponent });
  } else {
    if (result.sunkIndex !== null && mode === "power") {
      const selfRef = ref(db, `games/${lobbyCode}/${username}`);
      const selfSnap = await get(selfRef);
      const selfData = selfSnap.exists() ? selfSnap.val() : {};
      const nowPower = (selfData.powerShots || 0) + 1;
      await update(selfRef, { powerShots: nowPower });
      myPowerShots = nowPower;
    }
    await update(gameRef, { turn: opponent });
  }
}

// ---------- render boards (with sunk detection) ----------
function renderBoards(data) {
  const myNode = data[username] || {};
  const oppNode = data[opponent] || {};

  // MY board: clear non-placed cells
  [...myBoardDiv.children].forEach(cell => {
    const key = `${cell.dataset.x},${cell.dataset.y}`;
    if (!placedShips.flat().includes(key)) {
      cell.style.background = "rgba(255,255,255,0.03)";
      cell.textContent = "";
    }
  });
  // Render my ships (normal)
  placedShips.flat().forEach(k => {
    const c = findCell(myBoardDiv, k);
    if (c) { c.style.background = "#4caf50"; c.textContent = "🚢"; }
  });

  // Opponent shots on my board -> mark misses/hits and sunk ships with 💀
  const oppShots = (oppNode && oppNode.shots) ? Object.keys(oppNode.shots) : [];
  // For each of my ships, check sunk
  placedShips.forEach(ship => {
    const allHit = ship.every(coord => oppShots.includes(coord));
    if (allHit) {
      // sunk: mark all ship cells black + skull
      ship.forEach(coord => {
        const c = findCell(myBoardDiv, coord);
        if (c) { c.style.background = "#111"; c.textContent = "💀"; c.style.color = "#fff"; }
      });
    } else {
      // partially hit cells should show 🔥
      ship.forEach(coord => {
        const c = findCell(myBoardDiv, coord);
        if (!c) return;
        if (oppShots.includes(coord)) {
          c.style.background = "#d9534f";
          c.textContent = "🔥";
        }
      });
    }
  });
  // show misses on my board (water) for shots that didn't hit ships
  oppShots.forEach(k => {
    if (!placedShips.flat().includes(k)) {
      const c = findCell(myBoardDiv, k);
      if (c) { c.style.background = "#4aa3ff"; c.textContent = "🌊"; }
    }
  });

  // ENEMY board: clear and show my shots; show sunk enemy ships as black + skull, but never show full enemy ships otherwise
  [...enemyBoardDiv.children].forEach(c => { c.style.background = "rgba(255,255,255,0.03)"; c.textContent = ""; });

  const myShots = myNode && myNode.shots ? Object.keys(myNode.shots) : [];

  // If oppNode.ships exists we can determine sunk enemy ships (only reveal sank ships)
  const enemyShips = (oppNode && oppNode.ships) ? oppNode.ships : [];

  // For each enemy ship, if ALL its coords are in myShots => mark them as sunk (💀)
  enemyShips.forEach(ship => {
    const sunk = ship.every(coord => myShots.includes(coord));
    if (sunk) {
      ship.forEach(coord => {
        const c = findCell(enemyBoardDiv, coord);
        if (c) { c.style.background = "#111"; c.textContent = "💀"; c.style.color = "#fff"; }
      });
    } else {
      // show hits for individual coords I hit
      ship.forEach(coord => {
        if (myShots.includes(coord)) {
          const c = findCell(enemyBoardDiv, coord);
          if (c) { c.style.background = "#d9534f"; c.textContent = "🔥"; }
        }
      });
    }
  });

  // show my misses (cells I shot that do not belong to any enemy ship)
  myShots.forEach(k => {
    const belongsToShip = enemyShips.some(ship => ship.includes(k));
    if (!belongsToShip) {
      const c = findCell(enemyBoardDiv, k);
      if (c) { c.style.background = "#4aa3ff"; c.textContent = "🌊"; }
    }
  });
}

// ---------- detect winner ----------
function detectWinner(gdata) {
  if (!gdata) return null;
  const playerKeys = Object.keys(gdata).filter(k => k !== "turn" && k !== "rematchRequests");
  if (playerKeys.length < 2) return null;
  const [pA, pB] = playerKeys;
  const aShips = (gdata[pA] && Array.isArray(gdata[pA].ships)) ? gdata[pA].ships.flat() : [];
  const bShips = (gdata[pB] && Array.isArray(gdata[pB].ships)) ? gdata[pB].ships.flat() : [];
  const aShots = (gdata[pA] && gdata[pA].shots) ? gdata[pA].shots : {};
  const bShots = (gdata[pB] && gdata[pB].shots) ? gdata[pB].shots : {};
  const aSunk = aShips.length > 0 && aShips.every(c => !!bShots[c]);
  const bSunk = bShips.length > 0 && bShips.every(c => !!aShots[c]);
  if (aSunk) return pB;
  if (bSunk) return pA;
  return null;
}

// ---------- util ----------
function findCell(board, key) {
  const [x, y] = key.split(",");
  return [...board.children].find(c => c.dataset.x == x && c.dataset.y == y);
}
