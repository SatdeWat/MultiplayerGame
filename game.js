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

// DOM elements (from your HTML)
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

// container wrappers from your HTML
const boardsContainer = document.querySelector(".boards");
const myBoardCard = myBoardDiv.closest(".board-card");
const enemyBoardCard = enemyBoardDiv.closest(".board-card");
const myBoardTitle = myBoardCard ? myBoardCard.querySelector(".board-title") : null;
const enemyBoardTitle = enemyBoardCard ? enemyBoardCard.querySelector(".board-title") : null;

const lobbyRef = ref(db, `lobbies/${lobbyCode}`);
const gameRef = ref(db, `games/${lobbyCode}`);

let lobbyData = null;
let opponent = null;
let size = 10;
let shipLengths = []; // lengths remaining to place
let placedShips = []; // grouped arrays of coords like "x,y"
let orientation = "horizontal";
let phase = "placing"; // placing -> waiting -> playing -> ended
let myPowerShots = 0;
let mode = "classic"; // classic / streak / power

// small UI artifacts we create
let endModal = null;

// map board size to ships
function shipsForSize(boardSize) {
  if (boardSize === 10) return [5, 4, 3];
  if (boardSize === 15) return [5, 4, 3, 3];
  if (boardSize === 20) return [5, 4, 4, 3, 3, 2];
  return [5, 4, 3];
}

// --- init ---
(async function init() {
  // ensure boards side-by-side using existing container .boards
  if (boardsContainer) {
    boardsContainer.style.display = "flex";
    boardsContainer.style.gap = "24px";
    // make sure each .board-card is flexible and doesn't wrap oddly
    [...boardsContainer.children].forEach(c => {
      c.style.flex = "0 0 auto";
    });
  } else {
    // fallback: wrap parent of myBoard & enemyBoard
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.gap = "24px";
    myBoardDiv.parentNode.insertBefore(wrapper, myBoardDiv);
    wrapper.appendChild(myBoardDiv);
    wrapper.appendChild(enemyBoardDiv);
  }

  // get lobby info
  const s = await get(lobbyRef);
  if (!s.exists()) {
    alert("Lobby niet gevonden.");
    location.href = "home.html";
    return;
  }
  lobbyData = s.val();
  mode = lobbyData.mode || "classic";
  size = lobbyData.size || 10;
  shipLengths = shipsForSize(size);
  opponent = (lobbyData.host === username) ? lobbyData.guest : lobbyData.host;

  mySizeLabel.textContent = `${size}x${size}`;
  enemySizeLabel.textContent = `${size}x${size}`;

  // prepare small ready indicators in titles (if not present)
  if (myBoardTitle && !myBoardTitle.querySelector(".ready-indicator")) {
    const span = document.createElement("span");
    span.className = "ready-indicator";
    span.style.marginLeft = "8px";
    span.textContent = ""; // set to ✅ when ready
    myBoardTitle.appendChild(span);
  }
  if (enemyBoardTitle && !enemyBoardTitle.querySelector(".ready-indicator")) {
    const span = document.createElement("span");
    span.className = "ready-indicator";
    span.style.marginLeft = "8px";
    span.textContent = "";
    enemyBoardTitle.appendChild(span);
  }

  // create two boards with handlers
  createBoard(myBoardDiv, size, true, onMyCellEvent);
  createBoard(enemyBoardDiv, size, false, onEnemyCellClick);

  rotateBtn.textContent = `Rotate (${orientation})`;
  placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;

  // ensure games node exists if two players present
  onValue(lobbyRef, async (snap) => {
    const data = snap.val() || {};
    lobbyData = data;
    opponent = (data.host === username) ? data.guest : data.host;
    // if both players present, create game node if missing
    if (data.host && data.guest) {
      const gsnap = await get(gameRef);
      if (!gsnap.exists()) {
        const initObj = {
          [data.host]: { ships: [], shots: {} },
          [data.guest]: { ships: [], shots: {} },
          turn: null,
          rematchRequests: {}
        };
        await set(ref(db, `games/${lobbyCode}`), initObj);
      }
    }
  });

  // listen to games node for changes
  onValue(gameRef, (snap) => {
    const data = snap.val() || {};
    // update power UI
    const selfData = data[username] || {};
    if (selfData.powerShots !== undefined) {
      myPowerShots = selfData.powerShots || 0;
      powerCountSpan.textContent = myPowerShots;
      usePowerBtn.style.display = myPowerShots > 0 ? "inline-block" : "none";
    }

    // if opponent name known from lobbyData, update enemy title text
    if (lobbyData) {
      const other = (lobbyData.host === username) ? lobbyData.guest : lobbyData.host;
      if (enemyBoardTitle) {
        enemyBoardTitle.childNodes.forEach(n => {
          if (n.nodeType === Node.TEXT_NODE) {
            // replace only the text node part (title label)
            n.textContent = `Tegenstander (${size}x${size})`;
          }
        });
      }
    }

    // render visuals
    renderBoards(data);

    // ready indicator handling
    const self = data[username] || {};
    const opp = data[opponent] || {};
    setReadyIndicator(myBoardTitle, !!self.ready);
    setReadyIndicator(enemyBoardTitle, !!opp.ready);

    // if both ready and not playing -> start
    if (self && opp && self.ready && opp.ready && phase !== "playing") {
      // if turn not set, set random
      if (!data.turn) {
        const first = Math.random() < 0.5 ? username : opponent;
        update(gameRef, { turn: first }).catch(() => {});
        // show 'Game starts!' then who starts
        showStartThenTurn(first);
      } else {
        // turn exists: still show start banner then show turn
        showStartThenTurn(data.turn);
      }
      phase = "playing";
      gameNote.textContent = "Spel gestart!";
      // hide rotate button for both clients (local hide already done on done click)
      try { rotateBtn.style.display = "none"; } catch (e) {}
    }

    // show turn popup when turn changes
    if (data.turn) {
      // show turn popup (the onValue will run many times - show briefly)
      showTurnPopup(data.turn);
    }

    // rematch handling: both requested -> reset game node and local state
    const remReq = data.rematchRequests || {};
    if (remReq[username] && remReq[opponent]) {
      // reset games node to empty initial state and let players place again
      (async () => {
        await set(gameRef, {
          [lobbyData.host]: { ships: [], shots: {}, ready: false, powerShots: 0 },
          [lobbyData.guest]: { ships: [], shots: {}, ready: false, powerShots: 0 },
          turn: null,
          rematchRequests: {}
        });
      })();
      // reset local
      placedShips = [];
      shipLengths = shipsForSize(size);
      phase = "placing";
      placeHint.textContent = `Plaats schip van lengte ${shipLengths[0]}`;
      doneBtn.style.display = "none";
      rotateBtn.style.display = "inline-block";
      hideEndModal();
    }

    // detect winner
    const winner = detectWinner(data);
    if (winner) {
      phase = "ended";
      showEndModal(winner === username ? "Jij" : winner);
    }
  });

  // rotate handler
  rotateBtn.addEventListener("click", () => {
    orientation = orientation === "horizontal" ? "vertical" : "horizontal";
    rotateBtn.textContent = `Rotate (${orientation})`;
  });

  // done handler (places ships to DB and sets ready)
  doneBtn.addEventListener("click", async () => {
    if (shipLengths.length > 0) {
      alert(`Plaats eerst alle schepen! Nog: ${shipLengths.join(", ")}`);
      return;
    }
    // send our ships & ready flag
    await update(ref(db, `games/${lobbyCode}/${username}`), {
      ships: placedShips.slice(),
      shots: {},
      ready: true,
      powerShots: myPowerShots
    });
    phase = "waiting";
    // local UI
    doneBtn.style.display = "none";
    rotateBtn.style.display = "none";
    placeHint.textContent = "Wachten op tegenstander...";
    setReadyIndicator(myBoardTitle, true);
  });

  // power button (simple mode)
  usePowerBtn.addEventListener("click", () => {
    if (myPowerShots <= 0) return;
    usingPowerMode = true;
    usePowerBtn.disabled = true;
    usePowerBtn.textContent = "Kies 3x3 target...";
  });

  // back home
  backHome.addEventListener("click", () => {
    window.location.href = "home.html";
  });
})();

// --------- helpers & handlers ----------

function createBoard(container, gridSize, clickable = false, handler = null) {
  container.innerHTML = "";
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${gridSize}, 40px)`;
  container.style.gridTemplateRows = `repeat(${gridSize}, 40px)`;
  container.classList.add("board-grid");
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      // sensible inline styles so things show even if CSS missing
      cell.style.width = "40px";
      cell.style.height = "40px";
      cell.style.display = "flex";
      cell.style.alignItems = "center";
      cell.style.justifyContent = "center";
      cell.style.fontSize = "16px";
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

let usingPowerMode = false;

// Player placing handler (hover and click)
function onMyCellEvent(x, y, type, cellEl) {
  if (phase !== "placing" && phase !== "waiting") return;
  if (shipLengths.length === 0) return;
  const length = shipLengths[0];
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
    // preview ship
    const overlap = coords.some(c => placedShips.flat().includes(c));
    coords.forEach(c => {
      const cell = findCell(myBoardDiv, c);
      if (cell) {
        cell.classList.add(overlap ? "preview-bad" : "preview-valid");
      }
    });
  } else if (type === "leave") {
    [...myBoardDiv.children].forEach(c => {
      c.classList.remove("preview-valid", "preview-bad");
      // reset unplaced visuals
      if (!placedShips.flat().includes(`${c.dataset.x},${c.dataset.y}`)) {
        c.style.background = "rgba(255,255,255,0.03)";
        c.textContent = "";
      }
    });
  } else if (type === "click") {
    if (coords.length === 0) { alert("OOB: zet binnen het bord."); return; }
    if (coords.some(c => placedShips.flat().includes(c))) { alert("Schepen mogen niet overlappen."); return; }
    placedShips.push(coords.slice());
    coords.forEach(c => {
      const cell = findCell(myBoardDiv, c);
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
  // guard: check turn
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  if (!g.turn) return; // shouldn't happen, wait
  if (g.turn !== username) {
    // not your turn
    return;
  }

  if (usingPowerMode) {
    // 3x3 power shot
    const toShot = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = x + dx, sy = y + dy;
        if (sx >= 0 && sx < size && sy >= 0 && sy < size) toShot.push(`${sx},${sy}`);
      }
    }
    const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
    const snap = await get(shotsRef);
    const current = snap.exists() ? snap.val() : {};
    toShot.forEach(k => current[k] = true);
    await update(ref(db, `games/${lobbyCode}/${username}/shots`), current);
    // consume power
    myPowerShots = Math.max(0, myPowerShots - 1);
    await update(ref(db, `games/${lobbyCode}/${username}`), { powerShots: myPowerShots });
    usingPowerMode = false;
    usePowerBtn.disabled = false;
    usePowerBtn.textContent = `Use PowerShot (${myPowerShots})`;
    // determine turn after shots
    await resolveTurnAfterShots(current, true);
    return;
  }

  // normal shot
  const key = `${x},${y}`;
  const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
  const snap2 = await get(shotsRef);
  const current2 = snap2.exists() ? snap2.val() : {};
  if (current2[key]) return; // already shot
  current2[key] = true;
  await update(shotsRef, current2);
  await resolveTurnAfterShots(current2, false);
}

// helper: check hits against opponent ships
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

// resolve turn change logic depending on mode
async function resolveTurnAfterShots(myShotsObj, wasPowerShot) {
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  const oppData = g[opponent] || {};
  const oppShips = oppData.ships || [];
  const result = didShotHit(myShotsObj, oppShips);

  if (mode === "streak") {
    if (result.hit) {
      // keep turn
      await update(gameRef, { turn: username });
    } else {
      await update(gameRef, { turn: opponent });
    }
  } else {
    // power: grant powerShot when ship sunk
    if (result.sunkIndex !== null && mode === "power") {
      const selfRef = ref(db, `games/${lobbyCode}/${username}`);
      const selfSnap = await get(selfRef);
      const selfData = selfSnap.exists() ? selfSnap.val() : {};
      const nowPower = (selfData.powerShots || 0) + 1;
      await update(selfRef, { powerShots: nowPower });
      myPowerShots = nowPower;
    }
    // classic & power: switch turn after shot
    await update(gameRef, { turn: opponent });
  }
}

// render boards: show my ships, show enemy shots & my shots
function renderBoards(data) {
  const myNode = data[username] || {};
  const oppNode = data[opponent] || {};

  // clear my board non-placed cells
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
    const cell = findCell(myBoardDiv, k);
    if (cell) {
      cell.style.background = "#4caf50";
      cell.textContent = "🚢";
    }
  });

  // opponent shots on my board (show hits/misses)
  const oppShots = (oppNode && oppNode.shots) ? Object.keys(oppNode.shots) : [];
  oppShots.forEach(k => {
    const cell = findCell(myBoardDiv, k);
    if (!cell) return;
    if (placedShips.flat().includes(k)) {
      cell.style.background = "#d9534f";
      cell.textContent = "🔥";
    } else {
      cell.style.background = "#4aa3ff";
      cell.textContent = "🌊";
    }
  });

  // enemy board: show my shots (hits/misses)
  [...enemyBoardDiv.children].forEach(c => { c.style.background = "rgba(255,255,255,0.03)"; c.textContent = ""; });
  const myShots = (myNode && myNode.shots) ? Object.keys(myNode.shots) : [];
  myShots.forEach(k => {
    const cell = findCell(enemyBoardDiv, k);
    if (!cell) return;
    const enemyShips = (oppNode && oppNode.ships) ? oppNode.ships : [];
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

// show turn popup (reuses your #turnPopup element)
function showTurnPopup(name) {
  if (!turnPopup) return;
  turnPopup.style.display = "block";
  if (name === "Game starts!") {
    turnPopup.innerHTML = `<strong>${name}</strong>`;
  } else {
    turnPlayer.textContent = name === username ? "Jij" : name;
    // keep "Aan de beurt:" prefix from HTML
  }
  // style briefly then hide
  setTimeout(() => {
    if (turnPopup) turnPopup.style.display = "none";
  }, 2500);
}

// show "Game starts!" then who starts
function showStartThenTurn(first) {
  if (!turnPopup) return;
  turnPopup.style.display = "block";
  turnPopup.innerHTML = `<strong>Game starts!</strong>`;
  setTimeout(() => {
    turnPopup.style.display = "block";
    turnPopup.innerHTML = `Aan de beurt: <strong id="turnPlayer">${first === username ? "Jij" : first}</strong>`;
    setTimeout(() => { if (turnPopup) turnPopup.style.display = "none"; }, 2500);
  }, 1400);
}

// set small ready indicator in title element
function setReadyIndicator(titleEl, ready) {
  if (!titleEl) return;
  const span = titleEl.querySelector(".ready-indicator");
  if (!span) return;
  span.textContent = ready ? " ✅" : "";
}

// confirm shot safety (placeholder; let through)
function confirmShotSafety() { return true; }

// UTILITY to find cell by "x,y"
function findCell(board, coord) {
  const [x, y] = coord.split(",");
  return [...board.children].find(c => c.dataset.x == x && c.dataset.y == y);
}

// DETECT WINNER
// If all of a player's ship coords are present in opponent.shots -> they lost
function detectWinner(gdata) {
  if (!gdata) return null;
  const keys = Object.keys(gdata).filter(k => k !== "turn" && k !== "rematchRequests");
  if (keys.length < 2) return null;
  const p1 = keys[0], p2 = keys[1];
  const p1ships = (gdata[p1] && gdata[p1].ships) ? gdata[p1].ships : [];
  const p2ships = (gdata[p2] && gdata[p2].ships) ? gdata[p2].ships : [];
  const p1shots = (gdata[p1] && gdata[p1].shots) ? gdata[p1].shots : {};
  const p2shots = (gdata[p2] && gdata[p2].shots) ? gdata[p2].shots : {};
  // all coords flattened
  const p1coords = p1ships.flat();
  const p2coords = p2ships.flat();
  // if all p1coords are shot by p2 -> p2 wins
  const p1AllSunk = p1coords.length > 0 && p1coords.every(c => !!p2shots[c]);
  const p2AllSunk = p2coords.length > 0 && p2coords.every(c => !!p1shots[c]);
  if (p1AllSunk) return p2;
  if (p2AllSunk) return p1;
  return null;
}

// END MODAL & REMATCH
function showEndModal(winnerName) {
  // create if not exists
  if (!endModal) {
    endModal = document.createElement("div");
    endModal.style.position = "fixed";
    endModal.style.left = "50%";
    endModal.style.top = "30%";
    endModal.style.transform = "translateX(-50%)";
    endModal.style.background = "#fff";
    endModal.style.padding = "20px 24px";
    endModal.style.borderRadius = "10px";
    endModal.style.boxShadow = "0 12px 40px rgba(0,0,0,0.3)";
    endModal.style.zIndex = "9999";
    endModal.style.textAlign = "center";

    const h = document.createElement("div");
    h.id = "endModalText";
    h.style.fontSize = "20px";
    h.style.fontWeight = "700";
    h.style.marginBottom = "12px";
    endModal.appendChild(h);

    const rem = document.createElement("button");
    rem.textContent = "Rematch";
    rem.style.padding = "8px 12px";
    rem.style.borderRadius = "8px";
    rem.style.cursor = "pointer";
    rem.addEventListener("click", async () => {
      // set rematchRequests/{username}: true
      await update(ref(db, `games/${lobbyCode}/rematchRequests`), { [username]: true });
      const status = document.createElement("div");
      status.textContent = "Wachten op tegenstander...";
      status.style.marginTop = "10px";
      endModal.appendChild(status);
    });
    endModal.appendChild(rem);
    document.body.appendChild(endModal);
  }
  // set text
  const txt = endModal.querySelector("#endModalText");
  if (txt) txt.textContent = `${winnerName} heeft gewonnen!`;
  endModal.style.display = "block";
}

// hide end modal
function hideEndModal() {
  if (endModal) endModal.style.display = "none";
}
