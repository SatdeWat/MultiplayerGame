// game.js
// DataBase importeren
import {
  db,
  dbRef as ref,
  dbSet as set,
  dbGet as get,
  dbUpdate as update,
  dbOnValue as onValue
} from "./firebase.js";

// -------------------------
// Basale gebruikersinformatie
// -------------------------
// We halen username en lobbyCode uit localStorage.
// Als iets ontbreekt sturen we terug naar home.
const username = localStorage.getItem("username");
let lobbyCode = localStorage.getItem("lobbyCode");
if (!username || !lobbyCode) {
  // Als gebruiker niet ingelogd/lobby niet gezet -> terug naar home.
  window.location.href = "home.html";
}

// -------------------------
// DOM-elementen (knoppen, borden, labels)
// -------------------------
// Hier slaan we referenties op naar elementen in de pagina.
const myBoardDiv = document.getElementById("myBoard");
const enemyBoardDiv = document.getElementById("enemyBoard");
const rotateBtn = document.getElementById("rotateBtn");
const doneBtn = document.getElementById("doneBtn");
const backHome = document.getElementById("backHome");
// de turn popup element (in game.html aanwezig) — we verplaatsen deze later
let turnPopup = document.getElementById("turnPopup");
const turnPlayer = document.getElementById("turnPlayer");
const gameNote = document.getElementById("gameNote");
const mySizeLabel = document.getElementById("mySizeLabel");
const enemySizeLabel = document.getElementById("enemySizeLabel");
// power knop en teller — we kunnen fallback aanmaken als die niet bestaat in de HTML
let usePowerBtn = document.getElementById("usePowerBtn");
let powerCountSpan = document.getElementById("powerCount");
const placeHint = document.getElementById("placeHint");

// Vind board cards en titels — gebruikt voor kleine UI toevoegingen
const myBoardCard = myBoardDiv.closest(".board-card");
const enemyBoardCard = enemyBoardDiv.closest(".board-card");
const myBoardTitle = myBoardCard ? myBoardCard.querySelector(".board-title") : null;
const enemyBoardTitle = enemyBoardCard ? enemyBoardCard.querySelector(".board-title") : null;

// -------------------------
// Firebase references
// -------------------------
// Voor de lobby en het game object in de database.
let lobbyRef = ref(db, `lobbies/${lobbyCode}`);
let gameRef = ref(db, `games/${lobbyCode}`);

// -------------------------
// Locale state variabelen
// -------------------------
// Hier houden we de spelstatus en instellingen bij.
let lobbyData = null;
let lastGameState = null; // laatste snapshot van DB (voor vergelijking)
let opponent = null;
let size = 10; // bordgrootte
let mode = "classic"; // gamemode
let orientation = "horizontal"; // schip plaatsing orientatie
let shipLengths = []; // te plaatsen schepen
let placedShips = []; // lokaal array van arrays met coord strings "x,y"
let phase = "placing"; // fase: placing, waiting, playing, ended
let myPowerShots = 0; // hoeveel powershots de speler heeft
let usingPowerMode = false; // true na klikken op Use PowerShot (wacht op 3x3 target)
let awaitingTurnChange = false; // voorkomt dubbelklikken op beurt
let lastTurnShown = null; // wie laatst getoond werd in popup

// Optionele toggle: verbergen van eigen schepen op eigen scherm
let hideOwnShips = false;

// -------------------------
// Layout helpers
// -------------------------
// Celgrootte per bordgrootte — kleinere cellen voor grotere borden.
function getCellPxForSize(n) {
  if (n <= 10) return 30;
  if (n <= 15) return 26;
  return 18;
}
let CELL_PX = getCellPxForSize(size);

// Welke schepen hoort bij welke bordgrootte
function shipsForSize(boardSize) {
  if (boardSize === 10) return [5, 4, 3];
  if (boardSize === 15) return [5, 4, 3, 3];
  if (boardSize === 20) return [5, 4, 4, 3, 3, 2];
  return [5, 4, 3];
}

// -------------------------
// UI indicator helpers
// -------------------------
// Functies die kleine UI-tekens bij titels maken (klaar/rematch)
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

// -------------------------
// Turn popup helpers
// -------------------------
// De popup toont wie er aan de beurt is.
// We tonen eerst tijdelijk "Game starts!" en daarna "Aan de beurt: X".
function persistTurnPopup(name) {
  // Slaat de laatst getoonde naam op en toont de popup
  lastTurnShown = name;
  if (!turnPopup) return;
  const text = name === username ? "Jij" : name;
  turnPopup.innerHTML = `Aan de beurt: <strong id="turnPlayer">${text}</strong>`;
  turnPopup.style.display = "block";
}
function showTempPopup(msg, ms = 1000) {
  // Toont korte boodschap, daarna beurten weergeven
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
  // Specifieke sequentie: eerst "Game starts!" (kort) daarna wie begint
  showTempPopup("Game starts!", 1100);
  setTimeout(() => persistTurnPopup(first), 1100);
}

// Eindscherm
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
  trophy.id = "end-emoji";
  trophy.innerHTML = "🏆";
  trophy.style.fontSize = "64px";
  trophy.style.transform = "translateY(-6px)";
  card.appendChild(trophy);

  const title = document.createElement("div");
  title.id = "end-title";
  title.style.fontSize = "24px";
  title.style.fontWeight = "900";
  title.style.marginTop = "8px";
  title.style.color = "#222";
  card.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.id = "end-sub";
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
    // Stuur rematch-aanvraag naar DataBase
    await update(ref(db, `games/${lobbyCode}/rematchRequests`), { [username]: true });
    setRematchIndicator(myBoardTitle, true);
    remBtn.disabled = true;
    remBtn.textContent = "Rematch aangevraagd";
  });
  card.appendChild(remBtn);

  const remNote = document.createElement("div");
  remNote.id = "rem-note";
  remNote.style.marginTop = "10px";
  remNote.style.fontSize = "13px";
  remNote.style.color = "#666";
  card.appendChild(remNote);

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
function showEndOverlay(winnerText, remStatusOpp = false) {
  // Toont overlay met tekst "Jij hebt gewonnen" of "Jij hebt verloren"
  const overlay = createEndOverlay();
  overlay.style.display = "flex";
  const title = overlay.querySelector("#end-title");
  const emoji = overlay.querySelector("#end-emoji");
  let won = false;
  if (winnerText === "Jij" || winnerText === username) won = true;
  if (title) title.textContent = won ? "Jij hebt gewonnen!" : "Jij hebt verloren!";
  if (emoji) emoji.innerHTML = won ? "🎉" : "😢";
  const remNote = overlay.querySelector("#rem-note");
  if (remNote) remNote.textContent = remStatusOpp ? "Tegenstander heeft ook rematch gevraagd." : "Wacht op rematch of vraag er zelf een aan.";
}
function hideEndOverlay() {
  if (!endOverlay) return;
  endOverlay.style.display = "none";
}

// -------------------------
// Layout breed maken zodat twee borden passen
// -------------------------
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

// -------------------------
// INITIALISATIE
// -------------------------
// Dit async IIFE start alles op en zet listeners.
(async function init() {
  widenContainer();

  // Zorg dat de kleine status-indicatoren bestaan
  ensureReadyIndicator(myBoardTitle);
  ensureReadyIndicator(enemyBoardTitle);
  ensureRematchIndicator(myBoardTitle);
  ensureRematchIndicator(enemyBoardTitle);

  // VERPLAATS de turnPopup DOM node direct onder de H1 (pagina titel),
  // zodat de popup net boven de borden staat.
  try {
    const pageTitle = document.querySelector("h1");
    if (pageTitle && turnPopup) {
      // Plaats de popup na de titel
      pageTitle.after(turnPopup);
      // Basale styling voor nette weergave
      turnPopup.style.display = "none";
      turnPopup.style.margin = "8px auto";
      turnPopup.style.width = "fit-content";
      turnPopup.style.padding = "6px 10px";
      turnPopup.style.borderRadius = "8px";
      turnPopup.style.background = "rgba(0,0,0,0.04)";
      turnPopup.style.fontWeight = "700";
      turnPopup.style.textAlign = "center";
    }
  } catch (e) {
    // Als DOM anders is dan verwacht, gewoon door gaan.
  }

  // Maak fallback PowerShot knop als deze nog niet in game.html staat.
  try {
    if (!usePowerBtn) {
      const center = enemyBoardCard ? enemyBoardCard.querySelector(".center-controls") : null;
      const wrapTarget = center || enemyBoardCard || document.body;
      const btn = document.createElement("button");
      btn.id = "usePowerBtn";
      btn.className = "power-btn";
      // tekst met span zodat bestaande code powerCountSpan kan gebruiken
      btn.innerHTML = `Use PowerShot (<span id="powerCount">0</span>)`;
      btn.style.display = "none";
      wrapTarget.appendChild(btn);
      usePowerBtn = document.getElementById("usePowerBtn");
      powerCountSpan = document.getElementById("powerCount");
    }
  } catch (e) {
    // ignore
  }

  // Voeg knop toe om eigen schepen te verbergen
  try {
    if (myBoardTitle) {
      const hideBtn = document.createElement("button");
      hideBtn.id = "hideShipsBtn";
      hideBtn.textContent = "Verberg mijn schepen";
      Object.assign(hideBtn.style, {
        marginLeft: "10px",
        padding: "4px 8px",
        fontSize: "12px",
        cursor: "pointer",
        borderRadius: "6px"
      });
      hideBtn.addEventListener("click", () => {
        hideOwnShips = !hideOwnShips;
        hideBtn.textContent = hideOwnShips ? "Toon mijn schepen" : "Verberg mijn schepen";
        renderBoards(lastGameState || {});
      });
      myBoardTitle.appendChild(hideBtn);
    }
  } catch (e) { /* ignore */ }

  // Lees lobby-informatie uit DataBase
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

  // Maak de twee borden aan
  createBoard(myBoardDiv, size, true, onMyCellEvent);
  createBoard(enemyBoardDiv, size, false, onEnemyCellClick);
  rotateBtn.textContent = `Rotate (${orientation})`;

  // Zetten in DataBase
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

  // Hoofdlus: luister naar alle veranderingen in games/{lobbyCode}
  onValue(gameRef, async (gsnap) => {
    const data = gsnap.val() || {};
    if (!data) return;
    lastGameState = data;

    // Bepaal tegenstander als die nog niet geset is
    const playerKeys = Object.keys(data).filter(k => k !== "turn" && k !== "rematchRequests" && k !== "rematchStarted" && k!=="resultRecorded" && k!=="resultWinner");
    if (!opponent && playerKeys.length >= 2) opponent = playerKeys.find(k => k !== username);

    const meNode = data[username] || {};
    const oppNode = data[opponent] || {};

    // PowerShots UI: knop zichtbaar in power-mode, disabled wanneer je 0 hebt
    if (usePowerBtn) {
      if (powerCountSpan && meNode.powerShots !== undefined) powerCountSpan.textContent = meNode.powerShots || 0;
      usePowerBtn.style.display = (mode === "power") ? "inline-block" : "none";
      usePowerBtn.disabled = !(meNode.powerShots > 0) || usingPowerMode;
    }

    // Als speler al schepen in DB heeft (reload), adopteer die local
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

    // Update ready / rematch indicators
    setReadyIndicator(myBoardTitle, !!(meNode && meNode.ready));
    setReadyIndicator(enemyBoardTitle, !!(oppNode && oppNode.ready));

    const remReq = data.rematchRequests || {};
    setRematchIndicator(myBoardTitle, !!remReq[username]);
    setRematchIndicator(enemyBoardTitle, !!remReq[opponent]);

    // Render beide borden
    renderBoards(data);

    // Start spel automatisch als beide ready zijn
    if (meNode && oppNode && meNode.ready && oppNode.ready && phase !== "playing") {
      if (!data.turn) {
        // race-condition vermijden: haal vers spel op en schrijf alleen als turn nog leeg
        const firstPick = Math.random() < 0.5 ? username : opponent;
        const fresh = await get(gameRef);
        const freshVal = fresh.exists() ? fresh.val() : {};
        if (!freshVal.turn) {
          await update(gameRef, { turn: firstPick });
          const after = await get(gameRef);
          const finalTurn = (after.exists() && after.val().turn) ? after.val().turn : firstPick;
          lastTurnShown = finalTurn;
          showStartThenPersist(finalTurn);
        } else {
          lastTurnShown = freshVal.turn;
          showStartThenPersist(lastTurnShown);
        }
      } else {
        lastTurnShown = data.turn;
        showStartThenPersist(data.turn);
      }
      phase = "playing";
      gameNote.textContent = "Spel gestart!";
      placeHint.textContent = "";
      if (rotateBtn) rotateBtn.style.display = "none";
    }

    // Als er een turn is, always persist het in de popup
    if (data.turn) {
      persistTurnPopup(data.turn);
    }

    // REMATCH flow: wanneer beide spelers rematch aanvragen -> maak nieuwe lobby
    const remReqObj = data.rematchRequests || {};
    if (remReqObj[username] && remReqObj[opponent]) {
      if (!data.rematchStarted) {
        const newCode = generateLobbyCode();
        const newLobbyObj = {
          host: username,
          guest: opponent,
          size,
          mode,
          createdAt: Date.now()
        };
        await set(ref(db, `lobbies/${newCode}`), newLobbyObj);
        await set(ref(db, `games/${newCode}`), {
          [username]: { ships: [], shots: {}, ready: false, powerShots: 0 },
          [opponent]: { ships: [], shots: {}, ready: false, powerShots: 0 },
          turn: null,
          rematchRequests: {}
        });
        await update(gameRef, { rematchStarted: newCode });
      } else if (data.rematchStarted) {
        const newCode = data.rematchStarted;
        hideEndOverlay();
        localStorage.setItem("lobbyCode", newCode);
        setTimeout(() => {
          window.location.href = "game.html";
        }, 350);
      }
    }

    // Als rematchStarted gezet is door iemand anders en jij hebt nog niet gerematch -> wacht
    if (data.rematchStarted && !(remReqObj[username] && remReqObj[opponent])) {
      const newCode = data.rematchStarted;
      hideEndOverlay();
      localStorage.setItem("lobbyCode", newCode);
      setTimeout(() => { window.location.href = "game.html"; }, 350);
    }

    // WINNER detectie en overlay
    const winner = detectWinner(data);
    if (winner && phase !== "ended") {
      phase = "ended";
      showEndOverlay(winner === username ? "Jij" : winner, !!(data.rematchRequests && data.rematchRequests[opponent]));

      // STATISTIEKEN: schrijf plays +1 voor beide en wins +1 voor winnaar.
      try {
        if (!data.resultRecorded) {
          if (lobbyData && lobbyData.host === username) {
            const players = [username, opponent].filter(Boolean);
            for (const p of players) {
              const statRef = ref(db, `stats/${p}`);
              const snap = await get(statRef);
              const val = snap.exists() ? snap.val() : {};
              const playsNow = (val.plays || 0) + 1;
              const winsNow = (p === winner) ? ((val.wins || 0) + 1) : (val.wins || 0);
              await update(statRef, { plays: playsNow, wins: winsNow });
            }
            await update(gameRef, { resultRecorded: true, resultWinner: winner });
          }
        }
      } catch (e) {
        console.error("Stats update failed:", e);
      }
    }

    // Reset awaiting-turn-change flags als turn verandert
    if (data.turn && data.turn !== username) {
      awaitingTurnChange = false;
    }
    if (data.turn && data.turn === username) {
      awaitingTurnChange = false;
    }
  });

  // Rotate knop verandert orientatie voor plaatsing
  rotateBtn.addEventListener("click", () => {
    orientation = (orientation === "horizontal") ? "vertical" : "horizontal";
    rotateBtn.textContent = `Rotate (${orientation})`;
  });

  // Klaar knop: stuur schepen naar DB en markeer ready
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

  // Use PowerShot knop: consume direct 1 power en wacht op 3x3 doel
  if (usePowerBtn) {
    usePowerBtn.addEventListener("click", async (ev) => {
      if (myPowerShots <= 0) return;
      myPowerShots = Math.max(0, myPowerShots - 1);
      try {
        await update(ref(db, `games/${lobbyCode}/${username}`), { powerShots: myPowerShots });
      } catch (e) {
        console.error("Failed to update powerShots on DB:", e);
      }
      usingPowerMode = true;
      usePowerBtn.disabled = true;
      if (powerCountSpan) powerCountSpan.textContent = myPowerShots;
      if (!usePowerBtn.querySelector("span")) usePowerBtn.textContent = `Use PowerShot (${myPowerShots})`;
      // Volgende click op vijandelijk bord voert de 3x3 uit.
    });
  }

  // Back to home knop
  backHome.addEventListener("click", () => { location.href = "home.html"; });
})(); // einde init

// -------------------------
// Board creation
// -------------------------
// Maakt visuele grid en cellen voor een bord.
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
        // we ondersteunen hover preview (enter/leave) en click
        cell.addEventListener("mouseenter", () => handler(x, y, "enter", cell));
        cell.addEventListener("mouseleave", () => handler(x, y, "leave", cell));
        cell.addEventListener("click", () => handler(x, y, "click", cell));
      } else if (handler) {
        // alleen klikhandler (voor vijandbord zonder hover)
        cell.addEventListener("click", () => handler(x, y, "click", cell));
      }
      container.appendChild(cell);
    }
  }
}

// -------------------------
// Plaatsen van schepen (player's own board handler)
// -------------------------
// Hover laat preview zien, click plaatst schip als het past.
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

// -------------------------
// Schieten op vijand (klik handler op enemy board)
// -------------------------
// Belangrijk: we lezen prevShots, schrijven newShots, en roepen resolveTurnAfterShots
// zodat we betrouwbaar kunnen detecteren welke schepen *nieuw* gezonken zijn.
async function onEnemyCellClick(x, y, type, cellEl) {
  if (type !== "click") return;
  if (phase !== "playing") return;
  if (!opponent) return;
  if (awaitingTurnChange) return;

  // check wie aan de beurt is in DB
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  if (!g.turn) return;
  if (g.turn !== username) return;

  const shotsRef = ref(db, `games/${lobbyCode}/${username}/shots`);
  const snapShots = await get(shotsRef);
  const prevShots = snapShots.exists() ? snapShots.val() : {};

  if (usingPowerMode) {
    // bouw 3x3 lijst met coördinaten
    const toShot = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const sx = x + dx, sy = y + dy;
      if (sx >= 0 && sx < size && sy >= 0 && sy < size) toShot.push(`${sx},${sy}`);
    }
    const newShots = Object.assign({}, prevShots);
    toShot.forEach(k => newShots[k] = true);

    awaitingTurnChange = true;
    await update(shotsRef, newShots);

    // usingPowerMode was al verminderd bij het klikken op de knop
    usingPowerMode = false;
    if (usePowerBtn) {
      usePowerBtn.disabled = true;
      if (powerCountSpan) powerCountSpan.textContent = myPowerShots;
      if (myPowerShots <= 0) usePowerBtn.style.display = "none";
    }

    // resolve met nieuwe en oude shots (zodat we newly sunk kunnen detecteren)
    await resolveTurnAfterShots(newShots, true, toShot, prevShots);
    return;
  }

  // Normale single shot
  const key = `${x},${y}`;
  if (prevShots[key]) return;

  const newShots = Object.assign({}, prevShots);
  newShots[key] = true;

  awaitingTurnChange = true;
  await update(shotsRef, newShots);

  await resolveTurnAfterShots(newShots, false, [key], prevShots);
}

// -------------------------
// Hit detectie en beurtlogica
// -------------------------
// didShotHitSpecific: check of de nieuw geschoten keys een hit waren
function didShotHitSpecific(newKeys, opponentShipsGrouped) {
  for (let k of newKeys) {
    for (let si = 0; si < opponentShipsGrouped.length; si++) {
      if (opponentShipsGrouped[si].includes(k)) return true;
    }
  }
  return false;
}

// resolveTurnAfterShots zorgt voor:
// - bepalen of de beurt blijft (streak) of wisselt
// - toekennen van powerShots als een heel schip nieuw gezonken is (mode === "power")
async function resolveTurnAfterShots(myShotsObj, wasPowerShot, newKeys = [], prevMyShots = {}) {
  const gsnap = await get(gameRef);
  const g = gsnap.val() || {};
  const oppData = g[opponent] || {};
  const oppShips = oppData.ships || [];

  // nieuw/oud detecties
  const newHit = didShotHitSpecific(newKeys, oppShips);

  // Tel hoeveel schepen *nieuw* gezonken zijn
  let newlySunkCount = 0;
  for (let si = 0; si < oppShips.length; si++) {
    const ship = oppShips[si];
    const nowSunk = ship.every(coord => !!myShotsObj[coord]);
    const wasAlreadySunk = ship.every(coord => !!prevMyShots[coord]);
    if (nowSunk && !wasAlreadySunk) newlySunkCount++;
  }

  if (mode === "streak") {
    // Bij streak: als je een hit maakte dan blijf je; anders beurt naar tegenstander
    if (newHit) {
      await update(gameRef, { turn: username });
    } else {
      await update(gameRef, { turn: opponent });
    }
  } else {
    // classic & power: normaal altijd beurt wisselen
    // maar in power-mode krijg je +1 power per nieuw gezonken schip
    if (newlySunkCount > 0 && mode === "power") {
      const selfRef = ref(db, `games/${lobbyCode}/${username}`);
      const selfSnap = await get(selfRef);
      const selfData = selfSnap.exists() ? selfSnap.val() : {};
      const nowPower = (selfData.powerShots || 0) + newlySunkCount;
      await update(selfRef, { powerShots: nowPower });
      myPowerShots = nowPower;
      // Update UI direct (onValue listener zal het ook updaten)
      if (powerCountSpan) powerCountSpan.textContent = myPowerShots;
      if (usePowerBtn) {
        usePowerBtn.style.display = mode === "power" ? "inline-block" : "none";
        usePowerBtn.disabled = myPowerShots <= 0;
        if (!usePowerBtn.querySelector("span")) usePowerBtn.textContent = `Use PowerShot (${myPowerShots})`;
      }
    }
    await update(gameRef, { turn: opponent });
  }
  // awaitingTurnChange wordt verwijderd door de onValue listener als turn verandert
}

// -------------------------
// Render beide borden visueel
// -------------------------
// Toont schepen, hits, misses en gezonken schepen (skull)
function renderBoards(data) {
  const myNode = data ? (data[username] || {}) : {};
  const oppNode = data ? (data[opponent] || {}) : {};

  // Reset niet-plaats cellen
  [...myBoardDiv.children].forEach(cell => {
    const key = `${cell.dataset.x},${cell.dataset.y}`;
    if (!placedShips.flat().includes(key)) {
      cell.style.background = "rgba(255,255,255,0.03)";
      cell.textContent = "";
      cell.style.color = "";
    }
  });

  // Toon eigen schepen of verberg ze (hideOwnShips)
  if (!hideOwnShips) {
    placedShips.flat().forEach(k => {
      const c = findCell(myBoardDiv, k);
      if (c) { c.style.background = "#4caf50"; c.textContent = "🚢"; c.style.color = ""; }
    });
  } else {
    placedShips.flat().forEach(k => {
      const c = findCell(myBoardDiv, k);
      if (c) {
        if (! (oppNode && oppNode.shots && oppNode.shots[k]) ) {
          c.style.background = "rgba(255,255,255,0.03)";
          c.textContent = "";
          c.style.color = "";
        }
      }
    });
  }

  // Vuur van tegenstander op mijn bord: hits/misses en fully sunk (💀)
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
  // toon misses op mijn bord
  oppShots.forEach(k => {
    if (!placedShips.flat().includes(k)) {
      const c = findCell(myBoardDiv, k);
      if (c) { c.style.background = "#4aa3ff"; c.textContent = "🌊"; c.style.color = ""; }
    }
  });

  // Vijandbord: alleen mijn schoten tonen (reveal only sunk ships fully)
  [...enemyBoardDiv.children].forEach(c => { c.style.background = "rgba(255,255,255,0.03)"; c.textContent = ""; c.style.color = ""; });

  const myShots = (myNode && myNode.shots) ? Object.keys(myNode.shots) : [];
  const enemyShips = (oppNode && oppNode.ships) ? oppNode.ships : [];

  // Toon gezonken vijand-schepen volledig (💀)
  enemyShips.forEach(ship => {
    const sunk = ship.every(coord => myShots.includes(coord));
    if (sunk) {
      ship.forEach(coord => {
        const c = findCell(enemyBoardDiv, coord);
        if (c) { c.style.background = "#111"; c.textContent = "💀"; c.style.color = "#fff"; }
      });
    } else {
      // toon alleen de parts die je al hebt geraakt
      ship.forEach(coord => {
        if (myShots.includes(coord)) {
          const c = findCell(enemyBoardDiv, coord);
          if (c) { c.style.background = "#d9534f"; c.textContent = "🔥"; c.style.color = "#fff"; }
        }
      });
    }
  });

  // toon misses op vijandbord
  myShots.forEach(k => {
    const belongsToShip = enemyShips.some(ship => ship.includes(k));
    if (!belongsToShip) {
      const c = findCell(enemyBoardDiv, k);
      if (c) { c.style.background = "#4aa3ff"; c.textContent = "🌊"; c.style.color = ""; }
    }
  });
}

// -------------------------
// Win detectie
// -------------------------
// Controleer of alle vakjes van een speler geraakt zijn -> tegenstander wint
function detectWinner(gdata) {
  if (!gdata) return null;
  const playerKeys = Object.keys(gdata).filter(k => k !== "turn" && k !== "rematchRequests" && k !== "rematchStarted" && k!=="resultRecorded" && k!=="resultWinner");
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

// -------------------------
// Hulpfuncties
// -------------------------
// Vind een cel element in een board op basis van key "x,y"
function findCell(board, key) {
  const [x, y] = key.split(",");
  return [...board.children].find(c => c.dataset.x == x && c.dataset.y == y);
}

// Genereer lobby code (6 tekens)
function generateLobbyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
