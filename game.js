import { db, ref, set, get, onValue, update } from "./firebase.js";

const username = localStorage.getItem("username");
const lobbyCode = localStorage.getItem("lobbyCode");
const isGuest = localStorage.getItem("isGuest") === "true";

if (!username || !lobbyCode) window.location.href = "index.html";

// HTML elementen
const myBoardDiv = document.getElementById("myBoard");
const enemyBoardDiv = document.getElementById("enemyBoard");
const turnInfo = document.getElementById("turnInfo");
const gameMessage = document.getElementById("gameMessage");
const readyBtn = document.getElementById("readyBtn");
const rotateBtn = document.getElementById("rotateBtn");
const readyStatus = document.getElementById("readyStatus");

let lobbyData = null;
let opponent = null;
let size = 10;
let shipsArray = [3,4,5]; // schepen
let placedShips = [];
let hoverCells = [];
let orientation = "horizontal"; // horiz / vert
let myShots = {};
let phase = "placing"; // placing -> waiting -> playing -> ended
let isMyTurn = false;

const lobbyRef = ref(db, "lobbies/" + lobbyCode);
const gameRef = ref(db, "games/" + lobbyCode);

// --- Init ---
async function init() {
  const snap = await get(lobbyRef);
  if (!snap.exists()) { alert("Lobby niet gevonden!"); window.location.href="home.html"; return; }
  lobbyData = snap.val();

  size = lobbyData.size;
  opponent = (lobbyData.host === username) ? lobbyData.guest : lobbyData.host;

  createBoard(myBoardDiv, size, true, placeShipPreview);
  createBoard(enemyBoardDiv, size, false, shoot);

  gameMessage.textContent = `Plaats je schip van lengte ${shipsArray[0]}`;
}

init();

// --- Bord maken ---
function createBoard(boardDiv, size, clickable=false, clickHandler=null){
  boardDiv.innerHTML = "";
  boardDiv.style.display="grid";
  boardDiv.style.gridTemplateColumns = `repeat(${size},40px)`;
  boardDiv.style.gridTemplateRows = `repeat(${size},40px)`;

  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x=x;
      cell.dataset.y=y;
      if(clickable && clickHandler){
        cell.addEventListener("mouseenter",()=>clickHandler(x,y,true));
        cell.addEventListener("mouseleave",()=>clickHandler(x,y,false));
        cell.addEventListener("click",()=>clickHandler(x,y,"place"));
      }
      boardDiv.appendChild(cell);
    }
  }
}

// --- Hover / plaatsen ---
function placeShipPreview(x,y,action){
  if(phase!=="placing") return;
  const length = shipsArray[0];
  const coords = [];

  for(let i=0;i<length;i++){
    let cx = x + (orientation==="horizontal"?i:0);
    let cy = y + (orientation==="vertical"?i:0);
    if(cx>=size || cy>=size) return;
    coords.push(`${cx},${cy}`);
  }

  if(action===true){ // hover in
    coords.forEach(c=>{
      const [cx,cy]=c.split(",");
      const cell=[...myBoardDiv.children].find(d=>d.dataset.x==cx && d.dataset.y==cy);
      if(cell) { cell.style.background="rgba(0,255,0,0.4)"; hoverCells.push(cell);}
    });
  } else if(action===false){ // hover out
    hoverCells.forEach(c=>c.style.background="rgba(255,255,255,0.1)");
    hoverCells=[];
  } else if(action==="place"){ // klik
    coords.forEach(c=>{
      if(placedShips.flat().includes(c)) return alert("Schepen overlappen niet!");
    });
    placedShips.push(coords);
    coords.forEach(c=>{
      const [cx,cy]=c.split(",");
      const cell=[...myBoardDiv.children].find(d=>d.dataset.x==cx && d.dataset.y==cy);
      if(cell) { cell.style.background="#4caf50"; cell.textContent="🚢";}
    });
    shipsArray.shift();
    if(shipsArray.length>0) gameMessage.textContent=`Plaats je schip van lengte ${shipsArray[0]}`;
    else gameMessage.textContent="Klik op Klaar als je klaar bent!";
  }
}

// --- Rotate knop ---
rotateBtn.addEventListener("click",()=>{
  orientation = orientation==="horizontal"?"vertical":"horizontal";
});

// --- Klaar knop ---
readyBtn.addEventListener("click",async()=>{
  if(shipsArray.length>0){ alert("Plaats eerst al je schepen!"); return; }
  phase="waiting";
  readyBtn.disabled=true;

  if(!isGuest){
    await set(ref(db,`games/${lobbyCode}/${username}`), {ships: placedShips.flat(), shots:{}, ready:true});
  }

  updateReadyStatus();
  waitForOpponent();
});

// --- Ready status realtime ---
function updateReadyStatus(){
  onValue(gameRef,snap=>{
    const data=snap.val()||{};
    const meReady=data[username]?.ready? "✅":"❌";
    const oppReady=data[opponent]?.ready? "✅":"❌";
    readyStatus.textContent=`Jij klaar: ${meReady} | Tegenstander klaar: ${oppReady}`;
  });
}

// --- Wacht tot beide klaar ---
function waitForOpponent(){
  onValue(gameRef,snap=>{
    const data=snap.val()||{};
    if(!data[username]?.ready || !data[opponent]?.ready) return;
    phase="playing";
    gameMessage.textContent="Spel gestart!";
    readyBtn.style.display="none";

    if(!data.turn){
      const first = Math.random()<0.5?username:opponent;
      update(gameRef,{turn:first});
    }

    // realtime updates
    onValue(gameRef,snap2=>{
      const d=snap2.val()||{};
      isMyTurn=d.turn===username;
      turnInfo.textContent=isMyTurn?"Jij bent aan de beurt!":"Tegenstander is aan de beurt...";
      myShots=d[username]?.shots||{};
      renderBoards(d);
      checkWin(d);
    });
  });
}

// --- Schieten ---
async function shoot(x,y){
  if(!isMyTurn || phase!=="playing") return;
  const key=`${x},${y}`;
  if(myShots[key]) return;

  myShots[key]=true;
  await update(ref(db,`games/${lobbyCode}/${username}/shots`),myShots);

  const dataSnap=await get(gameRef);
  const data=dataSnap.val();
  update(gameRef,{turn:opponent});
}

// --- Render borden ---
function renderBoards(data){
  // vijand schoten op mijn bord
  if(data[opponent]?.shots){
    Object.keys(data[opponent].shots).forEach(k=>{
      const [x,y]=k.split(",");
      const cell=[...myBoardDiv.children].find(c=>c.dataset.x==x && c.dataset.y==y);
      if(!cell) return;
      if(placedShips.flat().includes(k)){ cell.style.background="red"; cell.textContent="🔥"; }
      else { cell.style.background="blue"; cell.textContent="🌊"; }
    });
  }

  // mijn schoten op vijand
  if(data[username]?.shots && data[opponent]?.ships){
    Object.keys(data[username].shots).forEach(k=>{
      const [x,y]=k.split(",");
      const cell=[...enemyBoardDiv.children].find(c=>c.dataset.x==x && c.dataset.y==y);
      if(!cell) return;
      if(data[opponent].ships.includes(k)){ cell.style.background="red"; cell.textContent="🔥"; }
      else { cell.style.background="blue"; cell.textContent="🌊"; }
    });
  }
}

// --- Win check ---
function checkWin(data){
  if(!data[username]?.ships || !data[opponent]?.ships) return;
  const enemyShipsLeft = data[opponent].ships.filter(s=>!data[username].shots[s]);
  const myShipsLeft = placedShips.flat().filter(s=>!data[opponent]?.shots?.[s]);

  if(enemyShipsLeft.length===0){
    gameMessage.textContent="🎉 Jij hebt gewonnen!";
    if(!isGuest) endGame(username, opponent);
    phase="ended";
  } else if(myShipsLeft.length===0){
    gameMessage.textContent="💀 Je hebt verloren!";
    if(!isGuest) endGame(opponent, username);
    phase="ended";
  }
}

// --- Einde spel ---
async function endGame(winner,loser){
  const winnerRef = ref(db,"users/"+winner);
  const loserRef = ref(db,"users/"+loser);

  const wSnap=await get(winnerRef);
  const lSnap=await get(loserRef);

  const wData=wSnap.val();
  const lData=lSnap.val();

  await update(winnerRef,{wins:(wData?.wins||0)+1,games:(wData?.games||0)+1});
  await update(loserRef,{games:(lData?.games||0)+1});
}
