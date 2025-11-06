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

// extra UI containers (dynamically gemaakt als ze niet in HTML bestaan)
let playersStatusDiv = document.getElementById("playersStatus");
let startPopup = null;
let endPopup = null;

const lobbyRef = ref(db, `lobbies/${lobbyCode}`);
const gameRef = ref(db, `games/${lobbyCode}`);

let lobbyData = null;
let opponent = null;
let size = 10;
let shipLengths = []; // will be filled by size
let placedShips = []; // array of arrays (coords like "x,y")
let orientation = "horizontal";
let phase = "placing"; // placing -> waiting -> playing -> ended
let myPowerShots = 0; // for Power gamemode
let mode = "classic"; // classic / streak / power

// rematch state local
let rematchRequested = false;

// utility for mapping sizes -> ships
function shipsForSize(boardSize) {
  if (boardSize === 10) return [5, 4, 3]; // 3 ships
  if (boardSize === 15) return [5, 4, 3, 3]; // 4 ships
  if (boardSize === 20) return [5, 4, 4, 3, 3, 2]; // 6 ships
  return [5,4,3];
}

// --- small helper UI functions ---

function ensurePlayersStatusUI() {
  // create a top bar showing player names and ready checkmarks
  if (!playersStatusDiv) {
    playersStatusDiv = document.createElement("div");
    playersStatusDiv.id = "playersStatus";
    playersStatusDiv.style.display = "flex";
    playersStatusDiv.style.justifyContent = "space-between";
    playersStatusDiv.style.alignItems = "center";
    playersStatusDiv.style.marginBottom = "8px";
    playersStatusDiv.style.gap = "12px";
    // left: host/guest boxes
    const boxes = document.createElement("div");
    boxes.id = "playersBoxes";
    boxes.style.display = "flex";
    boxes.style.gap = "12px";
    playersStatusDiv.appendChild(boxes);
    // right: mode label
    const modeLabel = document.createElement("div");
    modeLabel.id = "gameModeLabel";
    modeLabel.textContent = `Mode: ${mode}`;
    modeLabel.style.fontWeight = "600";
    playersStatusDiv.appendChild(modeLabel);

    // insert above boards (try to put before myBoardDiv)
    const parent = myBoardDiv.parentNode;
    if (parent) parent.insertBefore(playersStatusDiv, myBoardDiv);
  }
}

function updatePlayersStatusUI(lobbyDataLocal) {
  ensurePlayersStatusUI();
  const boxes = document.getElementById("playersBoxes");
  boxes.innerHTML = "";

  const hostName = lobbyDataLocal.host || "Host";
  const guestName = lobbyDataLocal.guest || "Guest";

  // create player-box
  function makeBox(name) {
    const b = document.createElement("div");
    b.style.display = "flex";
    b.style.alignItems = "center";
    b.style.gap = "8px";
    b.style.padding = "6px 10px";
    b.style.borderRadius = "8px";
    b.style.background = "rgba(255,255,255,0.03)";
    const nameEl = document.createElement("div");
    nameEl.textContent = name === username ? `${name} (Jij)` : name;
    nameEl.style.fontWeight = name === username ? "700" : "500";
    const tick = document.createElement("div");
    tick.className = "readyTick";
    tick.dataset.player = name;
    tick.textContent = "⏳"; // default waiting
    b.appendChild(nameEl);
    b.appendChild(tick);
    return b;
  }

  boxes.appendChild(makeBox(hostName));
  boxes.appendChild(makeBox(guestName));

  // set mode label
  const modeLabel = document.getElementById("gameModeLabel");
  if (modeLabel) modeLabel.textContent = `Mode: ${mode}`;
}

function setPlayerReadyIndicator(name, ready) {
  const ticks = document.querySelectorAll(".readyTick");
  ticks.forEach(t => {
    if (t.dataset.player === name) {
      t.textContent = ready ? "✔️" : "⏳";
    }
  });
}

function showStartBannerAndThenTurn(firstPlayer) {
  // Create or reuse a short "Game starts!" banner and then show who starts
  if (!startPopup) {
    startPopup = document.createElement("div");
    startPopup.id = "startPopup";
    startPopup.style.position = "fixed";
    startPopup.style.left = "50%";
    startPopup.style.top = "20%";
    startPopup.style.transform = "translateX(-50%)";
    startPopup.style.padding = "18px 24px";
    startPopup.style.borderRadius = "12px";
    startPopup.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
    startPopup.style.zIndex = 9999;
    startPopup.style.fontSize = "18px";
    startPopup.style.textAlign = "center";
    document.body.appendChild(startPopup);
  }
  startPopup.textContent = "Game starts!";
  startPopup.style.background = "linear-gradient(90deg,#2196f3,#1e88e5)";
  startPopup.style.color = "#fff";
  startPopup.style.display = "block";

  // hide after 1.5s, then show turn popup
  setTimeout(() => {
    startPopup.style.display = "none";
    // now show who starts (turnPopup already exists in DOM; reuse showTurnPopup)
    showTurnPopup(firstPlayer);
  }, 1500);
}

function showEndModal(winnerName) {
  if (!endPopup) {
    endPopup = document.createElement("div");
    endPopup.id = "endPopup";
    endPopup.style.position = "fixed";
    endPopup.style.left = "50%";
    endPopup.style.top = "30%";
    endPopup.style.transform = "translateX(-50%)";
    endPopup.style.padding = "22px 26px";
    endPopup.style.borderRadius = "12px";
    endPopup.style.boxShadow = "0 12px 36px rgba(0,0,0,0.5)";
    endPopup.style.zIndex = 10000;
    endPopup.style.background = "#fff";
    endPopup.style.minWidth = "300px";
    endPopup.style.textAlign = "center";

    // winner text
    const txt = document.createElement("div");
    txt.id = "endText";
    txt.style.fontSize = "20px";
    txt.style.fontWeight = "700";
    txt.style.marginBottom = "8px";
    endPopup.appendChild(txt);

    // rematch button
    const btn = document.createElement("button");
    btn.id = "rematchBtn";
    btn.textContent = "Rematch";
    btn.style.padding = "8px 12px";
    btn.style.borderRadius = "8px";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", onRequestRematch);
    endPopup.appendChild(btn);

    // rematch status
    const status = document.createElement("div");
    status.id = "rematchStatus";
    status.style.marginTop = "10px";
    status.style.fontSize = "14px";
    endPopup.appendChild(status);

    document.body.appendChild(endPopup);
  }
  const textEl = document.getElementById("endText");
  textEl.textContent = `${winnerName} wint!`;
  document.getElementById("rematchStatus").textContent = "";

  endPopup.style.display = "block";
}

function hideEndModal() {
  if (endPopup) endPopup.style.display = "none";
}

async function onRequestRematch() {
  // set rematch request flag in DB
  rematchRequested = true;
  await update(ref(db, `games/${lobbyCode}/rematchRequests`), { [username]: true });
  const status = document.getElementById("rematchStatus");
  if (status) status.textContent = "Wachten op tegenstander...";
}

// helper to reset local UI & state for new game
function localResetForRematch() {
  placedShips = [];
  shipLengths = shipsForSize(size);
  orientation = "horizontal";
  phase = "placing";
  myPowerShots = 0;
  rematchRequested = false;
  // update hints & buttons
  placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;
  rotateBtn.style.display = "inline-block";
  rotateBtn.textContent = `Rotate (${orientation})`;
  doneBtn.style.display = "none";
  gameNote.textContent = "Plaats je schepen...";
  // clear boards visually
  [...myBoardDiv.children].forEach(c => { c.style.background = "rgba(255,255,255,0.03)"; c.textContent = ""; });
  [...enemyBoardDiv.children].forEach(c => { c.style.background = "rgba(255,255,255,0.03)"; c.textContent = ""; });
  // update ready tick UI
  const ticks = document.querySelectorAll(".readyTick");
  ticks.forEach(t => t.textContent = "⏳");
  hideEndModal();
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

  // ensure boards are displayed next to each other by wrapping them
  ensureBoardLayoutSideBySide();

  createBoard(myBoardDiv, size, true, onMyCellEvent);
  createBoard(enemyBoardDiv, size, false, onEnemyCellClick);

  rotateBtn.textContent = `Rotate (${orientation})`;
  placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;

  // players status UI
  updatePlayersStatusUI(lobbyData);

  // If there is already a games node for this lobby, keep listening
  onValue(lobbyRef, (snap) => {
    const data = snap.val() || {};
    lobbyData = data;
    opponent = (data.host === username) ? data.guest : data.host;
    updatePlayersStatusUI(data);
    // If both players present, ensure games node exists (lobby.html already did this typically)
    if (data.host && data.guest) {
      // create games node if not exist
      get(gameRef).then(gsnap => {
        if (!gsnap.exists()) {
          // create placeholders
          update(ref(db, `games/${lobbyCode}`), {
            [data.host]: { ships: [], shots: {} },
            [data.guest]: { ships: [], shots: {} },
            turn: null,
            rematchRequests: {}
          });
        }
      });
    }
  });

  // listen games node for changes (shots, turn, ships, ready, rematchRequests)
  onValue(gameRef, async (snap) => {
    const data = snap.val() || {};
    if (!data) return;

    // update power count UI if exists
    const selfData = data[username] || {};
    if (selfData.powerShots) {
      myPowerShots = selfData.powerShots;
      powerCountSpan.textContent = myPowerShots;
      usePowerBtn.style.display = myPowerShots > 0 ? "inline-block" : "none";
    }

    // Render boards
    renderBoards(data);

    // update ready ticks if present
    const self = data[username] || {};
    const opp = data[opponent] || {};
    if (self && self.ready) setPlayerReadyIndicator(username, true);
    if (opp && opp.ready) setPlayerReadyIndicator(opponent, true);

    // show turn popup when turn in DB changes
    if (data.turn) {
      showTurnPopup(data.turn);
    }

    // handle rematchRequests: if both requested, reset
    const remReq = data.rematchRequests || {};
    const bothWantRematch = remReq[username] && remReq[opponent];
    if (bothWantRematch) {
      // reset the games node to initial state to start placing again
      await update(ref(db, `games/${lobbyCode}`), {
        [lobbyData.host]: { ships: [], shots: {}, ready: false, powerShots: 0 },
        [lobbyData.guest]: { ships: [], shots: {}, ready: false, powerShots: 0 },
        turn: null,
        rematchRequests: {}
      });
      localResetForRematch();
    }

    // Check win condition after each update
    const winner = detectWinner(data);
    if (winner) {
      // if phase already ended, ignore repeated
      if (phase !== "ended") {
        phase = "ended";
        gameNote.textContent = `${winner} heeft gewonnen!`;
        showEndModal(winner);
      }
      return;
    }

    // If both placed and ready -> start playing (ensure turn set)
    if (self && opp && Array.isArray(self.ships) && Array.isArray(opp.ships) && self.ready && opp.ready) {
      if (phase !== "playing") {
        // if turn not set, determine and set random
        if (!data.turn) {
          const first = Math.random() < 0.5 ? username : opponent;
          await update(gameRef, { turn: first });
          // show 'Game starts!' banner then show who starts
          showStartBannerAndThenTurn(first);
        } else {
          // turn exists, show start banner and turn
          showStartBannerAndThenTurn(data.turn);
        }
        phase = "playing";
        gameNote.textContent = "Spel gestart!";
      }
    }
  });

  // rotate handler
  rotateBtn.addEventListener("click", () => {
    orientation = orientation === "horizontal" ? "vertical" : "horizontal";
    rotateBtn.textContent = `Rotate (${orientation})`;
  });

  doneBtn.addEventListener("click", async () => {
    if (shipLengths.length > 0) { alert(`Plaats eerst alle schepen! Nog: ${shipLengths.join(", ")}`); return; }
    // write our placedShips to DB under games/{lobby}/{username} and set ready:true
    await set(ref(db, `games/${lobbyCode}/${username}`), { ships: placedShips.slice(), shots: {}, ready: true, powerShots: myPowerShots });
    phase = "waiting";
    doneBtn.style.display = "none";
    // show tick and hide rotate
    setPlayerReadyIndicator(username, true);
    rotateBtn.style.display = "none";
    gameNote.textContent = "Wachten op tegenstander...";

    // check opponent ready to possibly start immediately
    const gameSnap = await get(gameRef);
    const g = gameSnap.val() || {};
    const oppKey = Object.keys(g).find(k => k !== username && k !== "turn");
    if (oppKey && g[oppKey] && g[oppKey].ready) {
      // both placed and ready -> determine turn if not set
      if (!g.turn) {
        const first = Math.random() < 0.5 ? username : opponent;
        await update(gameRef, { turn: first });
        // show "Game starts!" and who is first
        showStartBannerAndThenTurn(first);
      } else {
        showStartBannerAndThenTurn(g.turn);
      }
      phase = "playing";
      gameNote.textContent = "Spel gestart!";
    }
  });

  // powershot button
  usePowerBtn.addEventListener("click", () => {
    if (myPowerShots <= 0) return;
    usingPowerMode = true;
    usePowerBtn.textContent = "Kies 3x3 target...";
    usePowerBtn.disabled = true;
  });

  // go home
  backHome.addEventListener("click", () => {
    window.location.href = "home.html";
  });
})();

// ensure the two board containers are side-by-side
function ensureBoardLayoutSideBySide() {
  // wrap both boards into a horizontal flex container
  const existingWrapper = document.getElementById("boardsWrapper");
  if (existingWrapper) return;
  const wrapper = document.createElement("div");
  wrapper.id = "boardsWrapper";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "row";
  wrapper.style.gap = "16px";
  wrapper.style.alignItems = "flex-start";
  // set width constraints so two 10x10 (40px cells) fit
  wrapper.style.width = "100%";
  // move myBoardDiv and enemyBoardDiv into wrapper
  const parent = myBoardDiv.parentNode;
  if (!parent) return;
  parent.insertBefore(wrapper, myBoardDiv);
  wrapper.appendChild(myBoardDiv);
  wrapper.appendChild(enemyBoardDiv);
}

// --------- helpers & handlers ----------

// Use original size 40px as requested
function createBoard(container, gridSize, clickable = false, handler = null) {
  container.innerHTML = "";
  const CELL_PX = 40; // terug naar origineel
  container.style.gridTemplateColumns = `repeat(${gridSize}, ${CELL_PX}px)`;
  container.style.gridTemplateRows = `repeat(${gridSize}, ${CELL_PX}px)`;
  container.classList.add("board-grid");
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      // basic inline styles so cells look reasonable even without external CSS
      cell.style.width = `${CELL_PX}px`;
      cell.style.height = `${CELL_PX}px`;
      cell.style.display = "flex";
      cell.style.alignItems = "center";
      cell.style.justifyContent = "center";
      cell.style.fontSize = "16px";
      cell.style.boxSizing = "border-box";
      cell.style.border = "1px solid rgba(0,0,0,0.08)";
      cell.style.background = "rgba(255,255,255,0.03)";
      if (clickable && handler) {
        cell.addEventListener("mouseenter", () => handler(x, y, "enter", cell));
        cell.addEventListener("mouseleave", () => handler(x, y, "leave", cell));
        cell.addEventListener("click", () => handler(x, y, "click", cell));
      }
      container.appendChild(cell);
    }
  }
}

let usingPowerMode = false;

// Player placing handler (hover and click)
function onMyCellEvent(x, y, type, cellEl) {
  if (phase !== "placing" && phase !== "waiting") return;
  if (shipLengths.length === 0) return;
  const length = shipLengths[0];
  // compute coords for prospective ship
  const coords = [];
  for (let i = 0; i < length; i++) {
    const cx = x + (orientation === "horizontal" ? i : 0);
    const cy = y + (orientation === "vertical" ? i : 0);
    if (cx >= size || cy >= size) {
      coords.length = 0;
      break;
    }
    coords.push(`${cx},${cy}`);
  }
  if (type === "enter") {
    // preview
    const overlap = coords.some(c => placedShips.flat().includes(c));
    coords.forEach(c => {
      const [cx, cy] = c.split(",");
      const cell = [...myBoardDiv.children].find(n => n.dataset.x == cx && n.dataset.y == cy);
      if (cell) {
        cell.classList.add(overlap ? "preview-bad" : "preview-valid");
        if (!overlap) cell.style.background = "rgba(76,175,80,0.25)";
        else cell.style.background = "rgba(217,83,79,0.25)";
      }
    });
  } else if (type === "leave") {
    // clear preview
    [...myBoardDiv.children].forEach(c => {
      c.classList.remove("preview-valid");
      c.classList.remove("preview-bad");
      // reset non-placed cells color if needed
      if (!placedShips.flat().includes(`${c.dataset.x},${c.dataset.y}`)) {
        c.style.background = "rgba(255,255,255,0.03)";
        c.textContent = "";
      }
    });
  } else if (type === "click") {
    if (coords.length === 0) { alert("OOB: zet binnen het bord."); return; }
    // overlap?
    if (coords.some(c => placedShips.flat().includes(c))) { alert("Schepen mogen niet overlappen."); return; }
    // place ship
    placedShips.push(coords.slice());
    coords.forEach(c => {
      const [cx, cy] = c.split(",");
      const cell = [...myBoardDiv.children].find(n => n.dataset.x == cx && n.dataset.y == cy);
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
      placeHint.textContent = `Alle schepen geplaatst — klik Klaar wanneer je klaar bent`;
      doneBtn.style.display = "inline-block";
    }
  }
}

// Enemy board click (shoot or power)
async function onEnemyCellClick(x, y, type, cellEl) {
  if (type !== "click") return;
  if (phase !== "playing") return;
  if (!opponent) return;
  if (!confirmShotSafety()) return; // guard if needed

  // decide whether powershot mode is active
  if (usingPowerMode) {
    // apply 3x3 centered on x,y
    const toShot = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = x + dx, sy = y + dy;
        if (sx >= 0 && sx < size && sy >= 0 && sy < size) toShot.push(`${sx},${sy}`);
      }
    }
    // write all these shots into games/{lobby}/{username}/shots
    const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
    const snap = await get(shotsRef);
    const current = snap.exists() ? snap.val() : {};
    toShot.forEach(k => current[k] = true);
    await update(ref(db, `games/${lobbyCode}/${username}/shots`), current);
    // consume one powerShot
    myPowerShots = Math.max(0, myPowerShots - 1);
    await update(ref(db, `games/${lobbyCode}/${username}`), { powerShots: myPowerShots });
    usingPowerMode = false;
    usePowerBtn.textContent = `Use PowerShot (${myPowerShots})`;
    usePowerBtn.disabled = false;
    // After power shots, determine turn-change per mode
    await resolveTurnAfterShots(current, true);
    return;
  }

  // Normal single shot
  const key = `${x},${y}`;
  const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
  const snap = await get(shotsRef);
  const current = snap.exists() ? snap.val() : {};
  if (current[key]) return; // already shot
  current[key] = true;
  await update(shotsRef, current);
  // after writing shot decide whether to switch turn based on mode and hit result
  await resolveTurnAfterShots(current, false);
}

// helper: check whether shot hit any of opponent ships
function didShotHit(shotsObj, opponentShipsGrouped) {
  // returns object with {hit: boolean, sunkShipIndex: null|index}
  for (let si = 0; si < opponentShipsGrouped.length; si++) {
    const ship = opponentShipsGrouped[si];
    // if any coord in shots matches ship coords -> that's a hit on that ship
    const shipHitCount = ship.filter(c => shotsObj[c]).length;
    if (shipHitCount > 0) {
      // is fully sunk if shipHitCount === ship.length
      const sunk = shipHitCount === ship.length;
      return { hit: true, sunkIndex: sunk ? si : null };
    }
  }
  return { hit: false, sunkIndex: null };
}

// resolve turn change logic depending on mode
async function resolveTurnAfterShots(myShotsObj, wasPowerShot) {
  // read latest game and opponent ships
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  const oppData = g[opponent] || {};
  const oppShips = oppData.ships || []; // expect grouped arrays
  // determine if any shot hit
  const result = didShotHit(myShotsObj, oppShips);
  if (mode === "streak") {
    // if hit, keep turn; else switch
    if (result.hit) {
      // Keep turn (no change)
      await update(gameRef, { turn: username });
    } else {
      await update(gameRef, { turn: opponent });
    }
  } else {
    // classic or power: normally switch turn after shot, but for Power if we sunk a ship grant powershot
    if (result.sunkIndex !== null && mode === "power") {
      // grant a powerShot to shooter
      const selfRef = ref(db, `games/${lobbyCode}/${username}`);
      const selfSnap = await get(selfRef);
      const selfData = selfSnap.exists() ? selfSnap.val() : {};
      const nowPower = (selfData.powerShots || 0) + 1;
      await update(selfRef, { powerShots: nowPower });
      // update local counter
      myPowerShots = nowPower;
      powerCountSpan.textContent = myPowerShots;
      usePowerBtn.style.display = myPowerShots > 0 ? "inline-block" : "none";
    }
    // always switch turn after normal/power shot
    await update(gameRef, { turn: opponent });
  }
}

// render boards: show my ships, show enemy shots & my shots
function renderBoards(data) {
  // render my board: my placed ships and opponent shots
  const myNode = data[username] || {};
  const oppNode = data[opponent] || {};

  // clear boards first (but keep placed ships visuals)
  [...myBoardDiv.children].forEach(cell => {
    const key = `${cell.dataset.x},${cell.dataset.y}`;
    if (!placedShips.flat().includes(key)) {
      cell.style.background = "rgba(255,255,255,0.03)";
      cell.textContent = "";
    }
  });
  // mark placed ships (local)
  placedShips.flat().forEach(k => {
    const [x, y] = k.split(",");
    const cell = [...myBoardDiv.children].find(c => c.dataset.x == x && c.dataset.y == y);
    if (cell) {
      cell.style.background = "#4caf50";
      cell.textContent = "🚢";
    }
  });

  // opponent shots on my board
  const oppShots = (oppNode && oppNode.shots) ? Object.keys(oppNode.shots) : [];
  oppShots.forEach(k => {
    const [x, y] = k.split(",");
    const cell = [...myBoardDiv.children].find(c => c.dataset.x == x && c.dataset.y == y);
    if (!cell) return;
    if (placedShips.flat().includes(k)) {
      // hit
      cell.style.background = "#d9534f";
      cell.textContent = "🔥";
    } else {
      // miss
      cell.style.background = "#4aa3ff";
      cell.textContent = "🌊";
    }
  });

  // enemy board: show my shots and hits/misses (but not enemy ships)
  const myShots = (myNode && myNode.shots) ? Object.keys(myNode.shots) : [];
  myShots.forEach(k => {
    const [x, y] = k.split(",");
    const cell = [...enemyBoardDiv.children].find(c => c.dataset.x == x && c.dataset.y == y);
    if (!cell) return;
    const enemyShips = (oppNode && oppNode.ships) ? oppNode.ships : [];
    // if any ship contains k -> hit, else miss
    const isHit = enemyShips.some(ship => ship.includes(k));
    if (isHit) {
      cell.style.background = "#d9534f";
      cell.textContent = "🔥";
    } else {
      cell.style.background = "#4aa3ff";
      cell.textContent = "🌊";
    }
  });
}

// show turn popup
function showTurnPopup(name) {
  if (!turnPopup) return;
  turnPopup.style.display = "block";
  turnPlayer.textContent = name === username ? "Jij" : name;
  // styling based on who
  if (name === username) {
    turnPopup.style.background = "linear-gradient(90deg,#00e676,#00c853)";
    turnPopup.style.color = "#000";
  } else {
    turnPopup.style.background = "rgba(0,0,0,0.55)";
    turnPopup.style.color = "#fff";
  }
  // hide after 2.5s
  setTimeout(() => {
    if (turnPopup) turnPopup.style.display = "none";
  }, 2500);
}

// confirm shot safety (prevent accidental power use)
function confirmShotSafety() {
  return true; // placeholder: could prompt if needed
}

/* WIN DETECTION
   If all coordinates of a player's ships are present in the opponent's shots -> that player lost.
   Return winner name or null.
*/
function detectWinner(g) {
  if (!g) return null;
  const pNames = Object.keys(g).filter(k => k !== "turn" && k !== "rematchRequests");
  if (pNames.length < 2) return null;
  const pA = pNames[0], pB = pNames[1];

  const dataA = g[pA] || {};
  const dataB = g[pB] || {};

  // helper to see if all ships of player P are sunk by shotsFromOther
  function allSunk(playerShips, shotsFromOtherObj) {
    if (!Array.isArray(playerShips)) return false;
    const shots = shotsFromOtherObj || {};
    for (let si = 0; si < playerShips.length; si++) {
      const ship = playerShips[si];
      // every coord must be present in shots
      const allCoordsHit = ship.every(c => shots[c]);
      if (!allCoordsHit) return false;
    }
    return true;
  }

  // shots recorded under opponent nodes
  const shotsByA = (dataA && dataA.shots) ? dataA.shots : {};
  const shotsByB = (dataB && dataB.shots) ? dataB.shots : {};

  // if all of A's ships are sunk by shotsByB -> B wins
  if (allSunk(dataA.ships || [], shotsByB)) return pB;
  // if all of B's ships are sunk by shotsByA -> A wins
  if (allSunk(dataB.ships || [], shotsByA)) return pA;
  return null;
}

async function onRequestRematch() {
  // wrapper so same function signature as earlier
  rematchRequested = true;
  await update(ref(db, `games/${lobbyCode}/rematchRequests`), { [username]: true });
  const status = document.getElementById("rematchStatus");
  if (status) status.textContent = "Wachten op tegenstander...";
}

// watch games node to detect when both players placed and ready (legacy listener left for compatibility)
onValue(gameRef, async (snap) => {
  const data = snap.val() || {};
  if (!data) return;
  const self = data[username] || {};
  const opp = data[opponent] || {};
  // adopt ships from DB if necessary
  if (self && Array.isArray(self.ships) && placedShips.length === 0 && self.ships.length > 0) {
    placedShips = self.ships;
    placedShips.forEach(ship => {
      ship.forEach(k => {
        const [cx, cy] = k.split(",");
        const cell = [...myBoardDiv.children].find(c => c.dataset.x == cx && c.dataset.y == cy);
        if (cell) {
          cell.style.background = "#4caf50";
          cell.textContent = "🚢";
        }
      });
    });
    shipLengths = [];
    doneBtn.style.display = "none";
    setPlayerReadyIndicator(username, !!self.ready);
  }
  if (self && self.ready) {
    rotateBtn.style.display = "none";
  }
  // start playing if both ready
  if (self && opp && Array.isArray(self.ships) && Array.isArray(opp.ships) && self.ready && opp.ready) {
    if (!data.turn) {
      const first = Math.random() < 0.5 ? username : opponent;
      await update(gameRef, { turn: first });
      showStartBannerAndThenTurn(first);
    }
    phase = "playing";
    gameNote.textContent = "Spel gestart!";
  }
});
