// game.js
import { db, dbRef as ref, dbSet as set, dbGet as get, dbUpdate as update, dbOnValue as onValue } from "./firebase.js";

const username = localStorage.getItem("username");
const isGuest = localStorage.getItem("isGuest")==="true";
const lobbyCode = localStorage.getItem("lobbyCode");
if(!username || !lobbyCode) window.location.href="home.html";

const myBoardDiv = document.getElementById("myBoard");
const enemyBoardDiv = document.getElementById("enemyBoard");
const rotateBtn = document.getElementById("rotateBtn");
const toHome = document.getElementById("toHome");
const turnPopup = document.getElementById("turnPopup");
const turnPlayer = document.getElementById("turnPlayer");
const gameNote = document.getElementById("gameNote");

let lobbyData = null;
let opponent = null;
let size = 10;
let shipLengths = [5,4,3];
let placedShips = []; // array of arrays of coordinates e.g. ["0,0","1,0","2,0"]
let hoverCells = [];
let orientation = "horizontal";
let phase = "placing"; // placing, waiting, playing, ended
let myShots = {}; // record of shots we've fired
let isMyTurn = false;

const lobbyRef = ref(db, "lobbies/" + lobbyCode);
const gameRef = ref(db, "games/" + lobbyCode);

// initialize: read lobby config and build grids
(async function init(){
  const snap = await get(lobbyRef);
  if(!snap.exists()) { alert("Lobby niet gevonden"); window.location.href="home.html"; return; }
  lobbyData = snap.val();
  size = lobbyData.size;
  opponent = (lobbyData.host === username) ? lobbyData.guest : lobbyData.host;
  createBoard(myBoardDiv, size, true, placePreviewHandler);
  createBoard(enemyBoardDiv, size, false, shootHandler);
  gameNote.textContent = `Plaats schepen: ${shipLengths.join(", ")} (in volgorde).`;
  // listen for game node creation & updates
  onValue(gameRef, (s) => {
    const data = s.val() || {};
    // If both players exist in games node and have ships, determine if both placed:
    const players = Object.keys(data).filter(k => k !== "turn");
    if(players.length === 2 && data[username] && data[opponent]) {
      // render boards as shots / hits occur
      renderBoards(data);
      // determine turn
      if(data.turn) {
        updateTurnDisplay(data.turn);
      }
    }
  });
})();

// board creation
function createBoard(boardDiv, gridSize, clickable=false, handler=null){
  boardDiv.innerHTML = "";
  boardDiv.style.gridTemplateColumns = `repeat(${gridSize}, 40px)`;
  boardDiv.style.gridTemplateRows = `repeat(${gridSize}, 40px)`;
  boardDiv.classList.add("board-grid");
  for(let y=0;y<gridSize;y++){
    for(let x=0;x<gridSize;x++){
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;
      if(clickable && handler){
        cell.addEventListener("mouseenter", ()=> handler(x,y,true));
        cell.addEventListener("mouseleave", ()=> handler(x,y,false));
        cell.addEventListener("click", ()=> handler(x,y,"place"));
      }
      boardDiv.appendChild(cell);
    }
  }
}

// preview & place handler for my board
function placePreviewHandler(x,y,action){
  if(phase !== "placing") return;
  if(shipLengths.length === 0) return;
  const length = shipLengths[0];
  const coords = [];
  for(let i=0;i<length;i++){
    const cx = x + (orientation === "horizontal" ? i : 0);
    const cy = y + (orientation === "vertical" ? i : 0);
    if(cx >= size || cy >= size) { return; } // out of bounds => no preview
    coords.push(`${cx},${cy}`);
  }

  if(action === true){
    // hover on: show preview (green) unless overlaps existing placed ships
    const overlaps = coords.some(c => placedShips.flat().includes(c));
    coords.forEach(c => {
      const [cx,cy] = c.split(",");
      const cell = [...myBoardDiv.children].find(n => n.dataset.x == cx && n.dataset.y == cy);
      if(cell) cell.style.background = overlaps ? "rgba(255,80,80,0.45)" : "rgba(0,200,120,0.35)";
      hoverCells.push(cell);
    });
  } else if(action === false){
    // hover out: reset hover cells
    hoverCells.forEach(c => { if(c) c.style.background = "rgba(255,255,255,0.03)"; });
    hoverCells = [];
  } else if(action === "place"){
    // place on click: check overlap, save and mark
    const overlaps = coords.some(c => placedShips.flat().includes(c));
    if(overlaps) { alert("Schepen mogen niet overlappen."); return; }
    placedShips.push(coords);
    coords.forEach(c => {
      const [cx,cy] = c.split(",");
      const cell = [...myBoardDiv.children].find(n => n.dataset.x == cx && n.dataset.y == cy);
      if(cell){ cell.style.background = "#4caf50"; cell.textContent = "🚢"; }
    });
    shipLengths.shift();
    if(shipLengths.length === 0){
      // finished placing locally — write to DB (unless guest)
      phase = "waiting";
      gameNote.textContent = "Schepen geplaatst. Klik in de LOBBY op Klaar (of als je al klaar bent, wacht).";
      // write ships to games node (create if necessary)
      if(!isGuest){
        // ensure game node exists; lobby page created initial game nodes when both players ready
        await set(ref(db, `games/${lobbyCode}/${username}`), { ships: placedShips.flat(), shots: {} });
      }
    } else {
      gameNote.textContent = `Volgende schip: ${shipLengths[0]}`;
    }
  }
}

// rotate button
rotateBtn.addEventListener("click", ()=> {
  orientation = (orientation === "horizontal") ? "vertical" : "horizontal";
  rotateBtn.textContent = `Rotate (${orientation})`;
});

// shoot handler for enemy board
async function shootHandler(x,y){
  if(phase !== "playing") return;
  if(!isMyTurn) return;
  const key = `${x},${y}`;
  // prevent double shot
  const myShotsSnap = await get(ref(db, `games/${lobbyCode}/${username}/shots`));
  const myShotsNow = myShotsSnap.exists() ? myShotsSnap.val() : {};
  if(myShotsNow[key]) return; // already shot
  myShotsNow[key] = true;
  await update(ref(db, `games/${lobbyCode}/${username}/shots`), myShotsNow);
  // switch turn
  const gf = await get(ref(db, `games/${lobbyCode}`));
  const data = gf.val() || {};
  const other = Object.keys(data).find(k => k !== "turn" && k !== username);
  if(other) await update(ref(db, `games/${lobbyCode}`), { turn: other });
}

// render boards and hits/misses
function renderBoards(data){
  // opponent shots on my board
  const oppShots = data[opponent] && data[opponent].shots ? Object.keys(data[opponent].shots) : [];
  oppShots.forEach(k => {
    const [x,y] = k.split(",");
    const cell = [...myBoardDiv.children].find(n => n.dataset.x == x && n.dataset.y == y);
    if(!cell) return;
    const wasShip = placedShips.flat().includes(k);
    if(wasShip){ cell.style.background = "#d9534f"; cell.textContent = "🔥"; } // hit
    else { cell.style.background = "#4aa3ff"; cell.textContent = "🌊"; } // miss
  });

  // my shots on enemy board
  const myShotsNode = data[username] && data[username].shots ? Object.keys(data[username].shots) : [];
  myShotsNode.forEach(k => {
    const [x,y] = k.split(",");
    const cell = [...enemyBoardDiv.children].find(n => n.dataset.x == x && n.dataset.y == y);
    if(!cell) return;
    const enemyShips = data[opponent] && data[opponent].ships ? data[opponent].ships : [];
    if(enemyShips.includes(k)){ cell.style.background = "#d9534f"; cell.textContent = "🔥"; }
    else { cell.style.background = "#4aa3ff"; cell.textContent = "🌊"; }
  });
}

// update turn popup UI
function updateTurnDisplay(turnName){
  isMyTurn = (turnName === username);
  turnPopup.style.display = "block";
  turnPlayer.textContent = turnName;
  // color
  turnPopup.style.background = isMyTurn ? "linear-gradient(90deg,#00e676,#00c853)" : "rgba(0,0,0,0.5)";
}

// check win condition and redirect to end
function checkWin(data){
  if(!data[username] || !data[opponent]) return;
  const enemyShips = data[opponent].ships || [];
  const myShotsSet = data[username].shots || {};
  const enemyHitsCount = enemyShips.filter(s => myShotsSet[s]).length;
  if(enemyHitsCount === enemyShips.length){
    // we win
    if(!isGuest) endGame(username, opponent);
    phase = "ended";
    localStorage.setItem("winner", username);
    setTimeout(()=> location.href="end.html", 900);
  }
  // check if opponent sunk all our ships
  const myShipsFlat = placedShips.flat();
  const oppShots = data[opponent] && data[opponent].shots ? Object.keys(data[opponent].shots) : [];
  const hitsOnMe = myShipsFlat.filter(s => oppShots.includes(s)).length;
  if(hitsOnMe === myShipsFlat.length){
    if(!isGuest) endGame(opponent, username);
    phase = "ended";
    localStorage.setItem("winner", opponent);
    setTimeout(()=> location.href="end.html", 900);
  }
}

// end game update leaderboard
async function endGame(winner, loser){
  const wSnap = await get(ref(db, "users/" + winner));
  const lSnap = await get(ref(db, "users/" + loser));
  const w = wSnap.exists() ? wSnap.val() : { wins:0, games:0 };
  const l = lSnap.exists() ? lSnap.val() : { wins:0, games:0 };
  await update(ref(db, "users/" + winner), { wins: (w.wins||0) + 1, games: (w.games||0) + 1 });
  await update(ref(db, "users/" + loser), { games: (l.games||0) + 1 });
}

// listen lobby and game updated states
onValue(lobbyRef, async (snap) => {
  const data = snap.val() || {};
  opponent = (data.host === username) ? data.guest : data.host;
  // if both ready and both have placed their ships in games node - start playing
  // Note: lobbyReady handled earlier in lobby.html; here we also watch the games node
  const gSnap = await get(ref(db, "games/" + lobbyCode));
  const gdata = gSnap.val() || {};
  // when both players have a 'ships' array in games node -> show that both placed
  if(gdata[username] && gdata[opponent] && gdata[username].ships && gdata[opponent].ships){
    // if local hasn't written our ships yet, make sure they are present
    if(placedShips.length > 0 && (!gdata[username] || !gdata[username].ships || gdata[username].ships.length===0)){
      // write our ships
      await set(ref(db, `games/${lobbyCode}/${username}`), { ships: placedShips.flat(), shots: {} });
    }
    // proceed to playing when turn exists or after setting initial turn
    if(!gdata.turn){
      // set random first turn
      const first = Math.random() < 0.5 ? username : opponent;
      await update(ref(db, `games/${lobbyCode}`), { turn: first });
    }
    // set phase playing
    phase = "playing";
  }
});

// watch games node for realtime updates to render boards and turn
onValue(gameRef, (snap) => {
  const data = snap.val() || {};
  if(Object.keys(data).length === 0) return;
  renderBoards(data);
  if(data.turn) updateTurnDisplay(data.turn);
  checkWin(data);
});

// navigate to home
toHome.addEventListener("click", ()=>{
  window.location.href = "home.html";
});
