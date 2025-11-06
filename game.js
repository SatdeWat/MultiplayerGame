// game.js
// Verwacht: firebase.js exporteert: db, dbRef as ref, dbSet as set, dbGet as get, dbUpdate as update, dbOnValue as onValue
import {
  db,
  dbRef as ref,
  dbSet as set,
  dbGet as get,
  dbUpdate as update,
  dbOnValue as onValue,
  dbOnValue as onValue /* keep consistent import name usage */
} from "./firebase.js";

const username = localStorage.getItem("username");
let lobbyCode = localStorage.getItem("lobbyCode");
if (!username || !lobbyCode) {
  window.location.href = "home.html";
}

// DOM
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

// Firebase refs (we will recreate when lobbyCode changes on rematch)
let lobbyRef = ref(db, `lobbies/${lobbyCode}`);
let gameRef = ref(db, `games/${lobbyCode}`);

// State
let lobbyData = null;
let opponent = null;
let size = 10;
let mode = "classic";
let orientation = "horizontal";
let shipLengths = [];
let placedShips = []; // local ships array-of-arrays
let phase = "placing";
let myPowerShots = 0;
let myPowerLocked = false; // nieuwe flag: nadat je een power hebt gebruikt blijft 'locked' true totdat je een nieuw schip zinkt
let usingPowerMode = false;
let awaitingTurnChange = false; // prevents multi-click per turn
let lastTurnShown = null;

// dynamic cell size per board size (20x20 smaller)
function getCellPxForSize(n) {
  if (n <= 10) return 30;
  if (n <= 15) return 26;
  return 18; // for 20x20 (or larger) make smaller
}
let CELL_PX = getCellPxForSize(size); // updated in init once size known

// ships mapping
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
  const s = ensureReadyIndicator(titleEl);
  if (!s) return;
  s.textContent = ready ? "✅" : "";
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
  const s = ensureRematchIndicator(titleEl);
  if (!s) return;
  s.textContent = requested ? " (rematch aangevraagd)" : "";
}

// persistent turn popup
function persistTurnPopup(name) {
  lastTurnShown = name;
  if (!turnPopup) return;
  const text = name === username ? "Jij" : name;
  turnPopup.innerHTML = `Aan de beurt: <strong id="turnPlayer">${text}</strong>`;
  turnPopup.style.display = "block";
}
function showTempPopup(msg, ms = 1000) {
  if (!turnPopup) return;
  const prev = lastTurnShown;
  turnPopup.innerHTML = `<strong>${msg}</strong>`;
  turnPopup.style.display = "block";
  setTimeout(() => {
    if (prev) persistTurnPopup(prev);
    else turnPopup.style.display = "none";
  }, ms);
}
function showStartThenPersist(first) {
  showTempPopup("Game starts!", 1100);
  setTimeout(() => persistTurnPopup(first), 1100);
}

// fancy end overlay with simple confetti + rematch button
let endOverlay = null;
function createEndOverlay() {
  if (endOverlay) return endOverlay;
  endOverlay = document.createElement("div");
  Object.assign(endOverlay.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 99999,
    pointerEvents: "auto"
  });
  // background blur + gradient
  const bg = document.createElement("div");
  Object.assign(bg.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.7))",
    display: "block"
  });
  endOverlay.appendChild(bg);

  // container
  const card = document.createElement("div");
  Object.assign(card.style, {
    position: "relative",
    zIndex: 100000,
    background: "#fff",
    padding: "28px",
    borderRadius: "14px",
    boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
    textAlign: "center",
    width: "min(720px, 92%)"
  });

  const trophy = document.createElement("div");
  trophy.innerHTML = "🏆";
  trophy.style.fontSize = "64px";
  trophy.style.transform = "translateY(-6px)";
  card.appendChild(trophy);

  const title = document.createElement("div");
  title.id = "end-title";
  title.style.fontSize = "20px";
  title.style.fontWeight = "800";
  title.style.marginTop = "8px";
  card.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.style.marginTop = "8px";
  subtitle.style.color = "#555";
  subtitle.innerText = "Goed gespeeld! Wil je nog een potje?";
  card.appendChild(subtitle);

  const remBtn = document.createElement("button");
  remBtn.textContent = "Rematch";
  Object.assign(remBtn.style, {
    marginTop: "16px",
    padding: "10px 14px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(90deg,#42a5f5,#1e88e5)",
    color: "#fff",
    fontWeight: "700"
  });
  remBtn.addEventListener("click", async () => {
    // set rematch request for this player
    await update(ref(db, `games/${lobbyCode}/rematchRequests`), { [username]: true });
    // local feedback
    setRematchIndicator(myBoardTitle, true);
    remBtn.disabled = true;
    remBtn.textContent = "Rematch aangevraagd";
  });
  card.appendChild(remBtn);

  // small note about opponent's rematch
  const remNote = document.createElement("div");
  remNote.id = "rem-note";
  remNote.style.marginTop = "10px";
  remNote.style.fontSize = "13px";
  remNote.style.color = "#666";
  card.appendChild(remNote);

  // confetti simple: floating colored dots
  const confettiWrap = document.createElement("div");
  Object.assign(confettiWrap.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
  for (let i = 0; i < 24; i++) {
    const dot = document.createElement("div");
    const sizeRand = 6 + Math.floor(Math.random() * 10);
    Object.assign(dot.style, {
      position: "absolute",
      left: `${Math.random() * 100}%`,
      top: `-10%`,
      width: `${sizeRand}px`,
      height: `${sizeRand}px`,
      borderRadius: "50%",
      background: ["#f44336", "#ff9800", "#ffeb3b", "#66bb6a", "#42a5f5", "#9c27b0"][Math.floor(Math.random()*6)],
      opacity: "0.95",
      transform: `translateY(0) rotate(${Math.random()*360}deg)`,
      animation: `fall ${(3 + Math.random()*2).toFixed(2)}s linear ${Math.random()*0.5}s forwards`
    });
    confettiWrap.appendChild(dot);
  }
  // add a style tag for the fall animation
  const styleEl = document.createElement("style");
  styleEl.innerHTML = `
    @keyframes fall {
      to { transform: translateY(110vh) rotate(720deg); opacity: 0.9; }
    }
  `;
  card.appendChild(styleEl);

  endOverlay.appendChild(confettiWrap);
  endOverlay.appendChild(card);
  document.body.appendChild(endOverlay);
  endOverlay.style.display = "none";
  return endOverlay;
}
function showEndOverlay(winnerKey, remStatusOpp = false) {
  const overlay = createEndOverlay();
  overlay.style.display = "flex";
  const title = overlay.querySelector("#end-title");
  if (title) {
    if (winnerKey === username) {
      title.textContent = `Je hebt gewonnen!`;
    } else {
      title.textContent = `Je hebt verloren!`;
    }
  }
  const remNote = overlay.querySelector("#rem-note");
  if (remNote) remNote.textContent = remStatusOpp ? "Tegenstander heeft ook rematch gevraagd." : "Wacht op rematch of vraag er zelf een aan.";
}
function hideEndOverlay() {
  if (!endOverlay) return;
  endOverlay.style.display = "none";
}

// widen page so two boards comfortably fit
function widenContainer() {
  const container = document.querySelector(".container");
  if (container) {
    container.style.maxWidth = "1400px";
    container.style.width = "96%";
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

// ---------- initialization ----------
(async function init() {
  widenContainer();

  // ensure indicators exist
  ensureReadyIndicator(myBoardTitle);
  ensureReadyIndicator(enemyBoardTitle);
  ensureRematchIndicator(myBoardTitle);
  ensureRematchIndicator(enemyBoardTitle);

  // read lobby
  lobbyRef = ref(db, `lobbies/${lobbyCode}`);
  gameRef = ref(db, `games/${lobbyCode}`);

  const s = await get(lobbyRef);
  if (!s.exists()) { alert("Lobby niet gevonden."); location.href = "home.html"; return; }
  lobbyData = s.val();
  size = lobbyData.size || 10;
  mode = lobbyData.mode || "classic";
  shipLengths = shipsForSize(size);
  opponent = (lobbyData.host === username) ? lobbyData.guest : lobbyData.host;

  CELL_PX = getCellPxForSize(size);

  mySizeLabel.textContent = `${size}x${size}`;
  enemySizeLabel.textContent = `${size}x${size}`;
  placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;

  createBoard(myBoardDiv, size, true, onMyCellEvent);
  createBoard(enemyBoardDiv, size, false, onEnemyCellClick);
  rotateBtn.textContent = `Rotate (${orientation})`;

  // Ensure games node exists when both players present
  onValue(lobbyRef, async (lsnap) => {
    const data = lsnap.val() || {};
    lobbyData = data;
    opponent = (data.host === username) ? data.guest : data.host;
    if (data.host && data.guest) {
      const gsnap = await get(gameRef);
      if (!gsnap.exists()) {
        await set(ref(db, `games/${lobbyCode}`), {
          [data.host]: { ships: [], shots: {} },
          [data.guest]: { ships: [], shots: {} },
          turn: null,
          rematchRequests: {}
        });
      }
    }
  });

  // main game listener
  onValue(gameRef, async (gsnap) => {
    const data = gsnap.val() || {};
    if (!data) return;

    // player keys present
    const playerKeys = Object.keys(data).filter(k => k !== "turn" && k !== "rematchRequests" && k !== "rematchStarted");
    if (!opponent && playerKeys.length >= 2) opponent = playerKeys.find(k => k !== username);

    const meNode = data[username] || {};
    const oppNode = data[opponent] || {};

    // powerShots UI (nu met lock)
    if (meNode.powerShots !== undefined || meNode.powerLocked !== undefined) {
      myPowerShots = meNode.powerShots || 0;
      myPowerLocked = !!meNode.powerLocked;
      powerCountSpan.textContent = myPowerShots;
      usePowerBtn.style.display = myPowerShots > 0 ? "inline-block" : "none";
      // disable if no shots or locked
      usePowerBtn.disabled = myPowerShots <= 0 || myPowerLocked;
      if (!usingPowerMode) {
        usePowerBtn.textContent = `Use PowerShot (${myPowerShots})`;
      }
    }

    // adopt ships from DB if page reloaded
    if (meNode.ships && Array.isArray(meNode.ships) && meNode.ships.length > 0 && placedShips.length === 0) {
      placedShips = meNode.ships.slice();
      placedShips.forEach(ship => ship.forEach(coord => {
        const c = findCell(myBoardDiv, coord);
        if (c) { c.style.background = "#4caf50"; c.textContent = "🚢"; c.style.color = ""; }
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

    // render
    renderBoards(data);

    // both ready -> start
    if (meNode && oppNode && meNode.ready && oppNode.ready && phase !== "playing") {
      if (!data.turn) {
        const first = Math.random() < 0.5 ? username : opponent;
        await update(gameRef, { turn: first });
        lastTurnShown = first;
        showStartThenPersist(first);
      } else {
        lastTurnShown = data.turn;
        showStartThenPersist(data.turn);
      }
      phase = "playing";
      gameNote.textContent = "Spel gestart!";
      placeHint.textContent = "";
      if (rotateBtn) rotateBtn.style.display = "none";
    }

    // persist turn popup always when turn present
    if (data.turn) {
      persistTurnPopup(data.turn);
    }

    // rematch: if both requested and rematch not yet started -> create new lobby & redirect both
    const remReqObj = data.rematchRequests || {};
    if (remReqObj[username] && remReqObj[opponent]) {
      // only create once: check rematchStarted flag
      if (!data.rematchStarted) {
        // create new lobby code
        const newCode = generateLobbyCode();
        // create lobbies/newCode and games/newCode
        const newLobbyObj = {
          host: username,
          guest: opponent,
          size,
          mode,
          createdAt: Date.now()
        };
        await set(ref(db, `lobbies/${newCode}`), newLobbyObj);
        await set(ref(db, `games/${newCode}`), {
          [username]: { ships: [], shots: {}, ready: false, powerShots: 0, powerLocked: false },
          [opponent]: { ships: [], shots: {}, ready: false, powerShots: 0, powerLocked: false },
          turn: null,
          rematchRequests: {}
        });
        // write rematchStarted so both clients pick it up
        await update(gameRef, { rematchStarted: newCode });
      } else if (data.rematchStarted) {
        // when rematchStarted exists: both clients should redirect once to the new lobby code
        const newCode = data.rematchStarted;
        // clear end overlay & prepare to redirect to same game.html with new lobbyCode
        hideEndOverlay();
        // update localStorage and navigate (reload) so the init logic picks new lobby
        localStorage.setItem("lobbyCode", newCode);
        // small delay to let DB updates flush on both sides
        setTimeout(() => {
          window.location.href = "game.html";
        }, 350);
      }
    }

    // if rematchStarted exists (maybe created by opponent first) - ensure we redirect
    if (data.rematchStarted && !(remReqObj[username] && remReqObj[opponent])) {
      // other side created rematchStarted but we didn't yet request rematch -> still redirect to new lobby immediately
      const newCode = data.rematchStarted;
      hideEndOverlay();
      localStorage.setItem("lobbyCode", newCode);
      setTimeout(() => { window.location.href = "game.html"; }, 350);
    }

    // winner detection
    const winner = detectWinner(data);
    if (winner && phase !== "ended") {
      phase = "ended";
      // show animated overlay — nu met echte winnaar-key zodat we kunnen zeggen of jij gewonnen of verloren hebt
      showEndOverlay(winner, !!(data.rematchRequests && data.rematchRequests[opponent]));
      // show rematch indicator as well
    }

    // clear awaiting-turn flag when the DB turn changes away from me
    if (data.turn && data.turn !== username) {
      awaitingTurnChange = false;
    }
    // also if turn becomes me again (after server change) clear awaiting
    if (data.turn && data.turn === username) {
      awaitingTurnChange = false;
    }
  });

  // rotate
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
      powerShots: myPowerShots || 0,
      powerLocked: myPowerLocked || false
    });
    phase = "waiting";
    doneBtn.style.display = "none";
    if (rotateBtn) rotateBtn.style.display = "none";
    placeHint.textContent = "Wachten op tegenstander...";
    setReadyIndicator(myBoardTitle, true);
  });

  // use power btn
  usePowerBtn.addEventListener("click", async () => {
    if (myPowerShots <= 0) return;
    if (myPowerLocked) return; // respect locked state
    usingPowerMode = true;
    usePowerBtn.disabled = true;
    usePowerBtn.textContent = "Kies 3x3 target...";
    // we do NOT set powerLocked in DB yet; we only lock after the shot is actually performed (consume)
  });

  // back
  backHome.addEventListener("click", () => { location.href = "home.html"; });
})(); // init end

// ---------- board creation ----------
function createBoard(container, gridSize, clickable = false, handler = null) {
  container.innerHTML = "";
  const cellPx = getCellPxForSize(gridSize);
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${gridSize}, ${cellPx}px)`;
  container.style.gridTemplateRows = `repeat(${gridSize}, ${cellPx}px)`;
  container.classList.add("board-grid");
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.style.width = `${cellPx}px`;
      cell.style.height = `${cellPx}px`;
      cell.style.display = "flex";
      cell.style.alignItems = "center";
      cell.style.justifyContent = "center";
      cell.style.fontSize = `${Math.max(10, Math.floor(cellPx/2.2))}px`;
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
      if (cc) { cc.classList.remove("preview-valid"); cc.style.background = "#4caf50"; cc.textContent = "🚢"; cc.style.color = ""; }
    });
    shipLengths.shift();
    if (shipLengths.length > 0) placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;
    else { placeHint.textContent = `Alle schepen geplaatst — klik Klaar`; doneBtn.style.display = "inline-block"; }
  }
}

// ---------- enemy clicks (shoot/powershot) ----------
async function onEnemyCellClick(x, y, type, cellEl) {
  if (type !== "click") return;
  if (phase !== "playing") return;
  if (!opponent) return;
  if (awaitingTurnChange) return; // block extra clicks while waiting

  // check turn from DB
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  if (!g.turn) return;
  if (g.turn !== username) return;

  // get current shots snapshot (before writing)
  const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
  const snapShots = await get(shotsRef);
  const prevShots = snapShots.exists() ? snapShots.val() : {};

  // powershot active?
  if (usingPowerMode) {
    // build 3x3
    const toShot = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const sx = x + dx, sy = y + dy;
      if (sx >= 0 && sx < size && sy >= 0 && sy < size) toShot.push(`${sx},${sy}`);
    }
    // write shots: merge prevShots + toShot
    const current = Object.assign({}, prevShots);
    toShot.forEach(k => current[k] = true);
    // set awaiting to block further clicks until DB turn changes
    awaitingTurnChange = true;
    await update(shotsRef, current);
    // consume one powerShot locally & in DB and lock until next sink
    myPowerShots = Math.max(0, myPowerShots - 1);
    myPowerLocked = true;
    await update(ref(db, `games/${lobbyCode}/${username}`), { powerShots: myPowerShots, powerLocked: true });
    usingPowerMode = false;
    usePowerBtn.disabled = true;
    usePowerBtn.textContent = `Use PowerShot (${myPowerShots})`;
    // resolve turn logic (power mode still switches after power shot unless streak rule)
    const newShotKeys = toShot.slice();
    await resolveTurnAfterShots(prevShots, current, newShotKeys, true);
    return;
  }

  // normal single shot
  const key = `${x},${y}`;
  const current = Object.assign({}, prevShots);
  if (current[key]) return;
  current[key] = true;
  // block multi-clicks until DB updates
  awaitingTurnChange = true;
  await update(shotsRef, current);
  await resolveTurnAfterShots(prevShots, current, [key], false);
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

async function resolveTurnAfterShots(prevShotsObj, myShotsObj, newShotKeys, wasPowerShot) {
  // read latest game & opponent ships
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  const oppData = g[opponent] || {};
  const oppShips = oppData.ships || [];

  // Determine whether any of the newly fired shot keys hit an enemy ship
  let anyNewHit = false;
  for (let i = 0; i < newShotKeys.length; i++) {
    const k = newShotKeys[i];
    if (oppShips.some(ship => ship.includes(k))) { anyNewHit = true; break; }
  }

  // Determine how many ships were newly sunk as a result of these shots
  let newlySunkCount = 0;
  for (let si = 0; si < oppShips.length; si++) {
    const ship = oppShips[si];
    const wasSunkBefore = ship.every(c => !!prevShotsObj[c]);
    const isSunkNow = ship.every(c => !!myShotsObj[c]);
    if (!wasSunkBefore && isSunkNow) newlySunkCount++;
  }

  if (mode === "streak") {
    // in streak: keep turn on hit, else switch
    if (anyNewHit) {
      await update(gameRef, { turn: username });
    } else {
      await update(gameRef, { turn: opponent });
    }
  } else {
    // classic & power: switch normally, but in power mode grant powers for newly sunk ships
    if (mode === "power" && newlySunkCount > 0) {
      // grant one powerShot per newly sunk ship; also unlock the power button (powerLocked = false)
      const selfRef = ref(db, `games/${lobbyCode}/${username}`);
      const selfSnap = await get(selfRef);
      const selfData = selfSnap.exists() ? selfSnap.val() : {};
      const nowPower = (selfData.powerShots || 0) + newlySunkCount;
      await update(selfRef, { powerShots: nowPower, powerLocked: false });
      myPowerShots = nowPower;
      myPowerLocked = false;
      // update UI locally
      powerCountSpan.textContent = myPowerShots;
      usePowerBtn.style.display = myPowerShots > 0 ? "inline-block" : "none";
      usePowerBtn.disabled = myPowerLocked || myPowerShots <= 0;
      usePowerBtn.textContent = `Use PowerShot (${myPowerShots})`;
    }
    await update(gameRef, { turn: opponent });
  }
  // awaitingTurnChange will be cleared by onValue listener once the DB turn changes
}

// ---------- render boards (sunk detection + skulls) ----------
function renderBoards(data) {
  const myNode = data[username] || {};
  const oppNode = data[opponent] || {};

  // MY board: reset non-placed
  [...myBoardDiv.children].forEach(cell => {
    const key = `${cell.dataset.x},${cell.dataset.y}`;
    if (!placedShips.flat().includes(key)) {
      cell.style.background = "rgba(255,255,255,0.03)";
      cell.textContent = "";
      cell.style.color = "";
    }
  });
  // mark placed ships normally
  placedShips.flat().forEach(k => {
    const c = findCell(myBoardDiv, k);
    if (c) { c.style.background = "#4caf50"; c.textContent = "🚢"; c.style.color = ""; }
  });

  // opponent shots on my board -> hits/misses and sunk (💀)
  const oppShots = (oppNode && oppNode.shots) ? Object.keys(oppNode.shots) : [];
  placedShips.forEach(ship => {
    const allHit = ship.every(coord => oppShots.includes(coord));
    if (allHit) {
      ship.forEach(coord => {
        const c = findCell(myBoardDiv, coord);
        if (c) { c.style.background = "#111"; c.textContent = "💀"; c.style.color = "#fff"; }
      });
    } else {
      ship.forEach(coord => {
        const c = findCell(myBoardDiv, coord);
        if (!c) return;
        if (oppShots.includes(coord)) {
          c.style.background = "#d9534f";
          c.textContent = "🔥";
          c.style.color = "#fff";
        }
      });
    }
  });
  // show misses on my board
  oppShots.forEach(k => {
    if (!placedShips.flat().includes(k)) {
      const c = findCell(myBoardDiv, k);
      if (c) { c.style.background = "#4aa3ff"; c.textContent = "🌊"; c.style.color = ""; }
    }
  });

  // ENEMY board: only show my shots (hits/misses). reveal full ship only when sunk
  [...enemyBoardDiv.children].forEach(c => { c.style.background = "rgba(255,255,255,0.03)"; c.textContent = ""; c.style.color = ""; });

  const myShots = (myNode && myNode.shots) ? Object.keys(myNode.shots) : [];
  const enemyShips = (oppNode && oppNode.ships) ? oppNode.ships : [];

  // show sunk enemy ships (full reveal as skull)
  enemyShips.forEach(ship => {
    const sunk = ship.every(coord => myShots.includes(coord));
    if (sunk) {
      ship.forEach(coord => {
        const c = findCell(enemyBoardDiv, coord);
        if (c) { c.style.background = "#111"; c.textContent = "💀"; c.style.color = "#fff"; }
      });
    } else {
      // show hits on ship parts only
      ship.forEach(coord => {
        if (myShots.includes(coord)) {
          const c = findCell(enemyBoardDiv, coord);
          if (c) { c.style.background = "#d9534f"; c.textContent = "🔥"; c.style.color = "#fff"; }
        }
      });
    }
  });

  // show misses (shots not hitting any ship)
  myShots.forEach(k => {
    const belongsToShip = enemyShips.some(ship => ship.includes(k));
    if (!belongsToShip) {
      const c = findCell(enemyBoardDiv, k);
      if (c) { c.style.background = "#4aa3ff"; c.textContent = "🌊"; c.style.color = ""; }
    }
  });
}

// ---------- winner detection ----------
function detectWinner(gdata) {
  if (!gdata) return null;
  const playerKeys = Object.keys(gdata).filter(k => k !== "turn" && k !== "rematchRequests" && k !== "rematchStarted");
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

// generate lobby code (6 chars)
function generateLobbyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
