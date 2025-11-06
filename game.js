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
let shipLengths = []; // will be filled by size
let placedShips = []; // array of arrays
let orientation = "horizontal";
let phase = "placing"; // placing -> waiting -> playing -> ended
let myPowerShots = 0; // for Power gamemode
let mode = "classic"; // classic / streak / power

// utility for mapping sizes -> ships
function shipsForSize(boardSize) {
  if (boardSize === 10) return [5, 4, 3]; // 3 ships
  if (boardSize === 15) return [5, 4, 3, 3]; // 4 ships
  if (boardSize === 20) return [5, 4, 4, 3, 3, 2]; // 6 ships
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

  // If there is already a games node for this lobby, keep listening
  onValue(lobbyRef, (snap) => {
    const data = snap.val() || {};
    opponent = (data.host === username) ? data.guest : data.host;
    // If both players present, ensure games node exists (lobby.html already did this typically)
    if (data.host && data.guest) {
      // create games node if not exist
      get(gameRef).then(gsnap => {
        if (!gsnap.exists()) {
          // create placeholders
          update(ref(db, `games/${lobbyCode}`), {
            [data.host]: { ships: [], shots: {} },
            [data.guest]: { ships: [], shots: {} },
            turn: null
          });
        }
      });
    }
  });

  // listen games node for changes (shots, turn, ships)
  onValue(gameRef, (snap) => {
    const data = snap.val() || {};
    if (!data) return;
    // update power count UI if exists
    const selfData = data[username] || {};
    if (selfData.powerShots) {
      myPowerShots = selfData.powerShots;
      powerCountSpan.textContent = myPowerShots;
      usePowerBtn.style.display = myPowerShots > 0 ? "inline-block" : "none";
    }
    // update rendering of shots/hits
    renderBoards(data);
    // update turn popup
    if (data.turn) {
      showTurnPopup(data.turn);
    }
    // if both players wrote their ships arrays and both players have "ready" (we'll use lobby ready flags), and both placed, set phase to playing if both clicked done
    // we rely on `done` clicks to set games/{lobby}/{player}/ready=true in DB when user clicks Done
    const p1 = data[Object.keys(data)[0]];
    const p2 = data[Object.keys(data)[1]];
  });

  // rotate handler
  rotateBtn.addEventListener("click", () => {
    orientation = orientation === "horizontal" ? "vertical" : "horizontal";
    rotateBtn.textContent = `Rotate (${orientation})`;
  });

  doneBtn.addEventListener("click", async () => {
    if (shipLengths.length > 0) { alert(`Plaats eerst alle schepen! Nog: ${shipLengths.join(", ")}`); return; }
    // write our placedShips to DB under games/{lobby}/{username}.ships (as grouped array) and set ready:true
    await set(ref(db, `games/${lobbyCode}/${username}`), { ships: placedShips.slice(), shots: {}, ready: true, powerShots: 0 });
    phase = "waiting";
    doneBtn.style.display = "none";
    gameNote.textContent = "Wachten op tegenstander...";
    // if opponent already has ships && ready -> start playing: set turn random if not set and both ready true
    const gameSnap = await get(gameRef);
    const g = gameSnap.val() || {};
    const oppKey = Object.keys(g).find(k => k !== username && k !== "turn");
    if (oppKey && g[oppKey] && g[oppKey].ready) {
      // both placed and ready -> determine turn if not set
      if (!g.turn) {
        const first = Math.random() < 0.5 ? username : opponent;
        await update(gameRef, { turn: first });
      }
      phase = "playing";
      gameNote.textContent = "Spel gestart!";
    }
  });

  // powershot button
  usePowerBtn.addEventListener("click", () => {
    if (myPowerShots <= 0) return;
    // Set a "usingPower" flag in client state so next click on enemy board triggers powerShot instead of normal shot
    usingPowerMode = true;
    usePowerBtn.textContent = "Kies 3x3 target...";
    usePowerBtn.disabled = true;
  });

  // go home
  backHome.addEventListener("click", () => {
    window.location.href = "home.html";
  });
})();

// --------- helpers & handlers ----------

function createBoard(container, gridSize, clickable = false, handler = null) {
  container.innerHTML = "";
  container.style.gridTemplateColumns = `repeat(${gridSize}, 40px)`;
  container.style.gridTemplateRows = `repeat(${gridSize}, 40px)`;
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

  // Re-evaluate sunk ships and remove? We keep ships recorded; detection done via shots.
  // After shots, re-render will occur via onValue listener.
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
  turnPopup.style.display = "block";
  turnPlayer.textContent = name === username ? "Jij" : name;
  // styling based on who
  if (name === username) {
    turnPopup.style.background = "linear-gradient(90deg,#00e676,#00c853)";
  } else {
    turnPopup.style.background = "rgba(0,0,0,0.55)";
  }
  // hide after 2.5s
  setTimeout(() => {
    turnPopup.style.display = "none";
  }, 2500);
}

// confirm shot safety (prevent accidental power use)
function confirmShotSafety() {
  return true; // placeholder: could prompt if needed
}

/* Additional listener: if opponent writes ships+ready to games node,
   and local placedShips already set and local has clicked done, we start playing. */
// watch games node to detect when both players placed and ready
onValue(gameRef, async (snap) => {
  const data = snap.val() || {};
  if (!data) return;
  const self = data[username] || {};
  const opp = data[opponent] || {};
  // if opponent exists and both have ships arrays & both ready flags (games/{lobby}/{player}.ready)
  if (self && opp && Array.isArray(self.ships) && Array.isArray(opp.ships) && self.ready && opp.ready) {
    // ensure local placedShips reflect self.ships if we just navigated here from lobby and not placed locally
    if (placedShips.length === 0 && self.ships.length > 0) {
      // adopt ships from DB (shouldn't normally happen if we placed locally)
      placedShips = self.ships;
      // render them on board
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
      // no local shipLengths left
      shipLengths = [];
      doneBtn.style.display = "none";
    }

    // if both ready and not yet playing, set turn if missing and go to playing
    if (!data.turn) {
      const first = Math.random() < 0.5 ? username : opponent;
      await update(gameRef, { turn: first });
    }
    phase = "playing";
    gameNote.textContent = "Spel gestart!";
  }
});
