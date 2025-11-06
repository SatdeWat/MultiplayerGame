// game.js
import { db, ref, onValue, set, update, get } from "./firebase.js";

const username = localStorage.getItem("username");
const lobbyCode = localStorage.getItem("lobbyCode");
const isGuest = localStorage.getItem("isGuest")==="true";

if(!username || !lobbyCode) window.location.href="index.html";

const myBoardDiv = document.getElementById("myBoard");
const enemyBoardDiv = document.getElementById("enemyBoard");
const turnInfo = document.getElementById("turnInfo");
const gameMessage = document.getElementById("gameMessage");

let lobbyData = null;
let myShips = [];
let myShots = {};
let phase = "placing";
let size=10;
let shipsCount=3;
let opponent = null;

const lobbyRef = ref(db,"lobbies/"+lobbyCode);
const gameRef = ref(db,"games/"+lobbyCode);

async function init(){
  const snap = await get(lobbyRef);
  if(!snap.exists()) return alert("Lobby niet gevonden!");
  lobbyData = snap.val();
  size = lobbyData.size;
  shipsCount = lobbyData.ships;

  opponent = (lobbyData.host===username) ? lobbyData.guest : lobbyData.host;

  createBoard(myBoardDiv, size, true, placeShip);
  createBoard(enemyBoardDiv, size, false);

  gameMessage.textContent = `Plaats je ${shipsCount} schepen`;
}

init();

// --- Maak bord ---
function createBoard(boardDiv, size, clickable=false, clickHandler=null){
  boardDiv.innerHTML="";
  boardDiv.style.display="grid";
  boardDiv.style.gridTemplateColumns=`repeat(${size},40px)`;
  boardDiv.style.gridTemplateRows=`repeat(${size},40px)`;

  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const cell=document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x=x;
      cell.dataset.y=y;
      if(clickable && clickHandler) cell.addEventListener("click",()=>clickHandler(x,y,cell));
      boardDiv.appendChild(cell);
    }
  }
}

// --- Schepen plaatsen ---
function placeShip(x,y,cell){
  if(phase!=="placing") return;
  const key=`${x},${y}`;
  if(myShips.includes(key)) return;
  myShips.push(key);
  cell.style.background="#4caf50";
  cell.textContent="🚢";

  if(myShips.length===shipsCount){
    phase="waiting";
    gameMessage.textContent="Wachten op tegenstander...";
    if(!isGuest){
      set(ref(db,`games/${lobbyCode}/${username}`),{ships:myShips,shots:{}});
    }
    checkBothReady();
  }
}

// --- Check of beide klaar ---
function checkBothReady(){
  onValue(gameRef,snapshot=>{
    const data = snapshot.val() || {};
    const players = Object.keys(data).filter(p=>p!=="turn");
    if(players.length<2) return;

    const playerShipsReady = players.every(p=>data[p] && data[p].ships && data[p].ships.length>0);

    if(playerShipsReady) startGame(players);
  });
}

// --- Start spel ---
function startGame(players){
  phase="playing";
  if(!opponent) opponent = players.find(p=>p!==username);
  gameMessage.textContent="Spel gestart!";

  // Realtime listener
  onValue(gameRef,snapshot=>{
    const data = snapshot.val() || {};
    if(!data[username]) return;

    myShots = data[username].shots || {};
    updateTurn(data.turn);
    renderBoards(data);
    checkWin(data);
  });

  // Init turn
  get(gameRef).then(snap=>{
    const data = snap.val() || {};
    if(!data.turn){
      const first = Math.random()<0.5 ? username : opponent;
      update(gameRef,{turn:first});
    }
  });
}

// --- Beurt update ---
let isMyTurn=false;
function updateTurn(turn){
  isMyTurn = turn===username;
  turnInfo.textContent = isMyTurn ? "Jij bent aan de beurt!" : "Tegenstander is aan de beurt...";
}

// --- Schieten ---
async function shoot(x,y){
  if(!isMyTurn || phase!=="playing") return;
  const key=`${x},${y}`;
  if(myShots[key]) return;

  myShots[key]=true;
  await update(ref(db,`games/${lobbyCode}/${username}/shots`),myShots);

  // Wissel beurt
  const dataSnap = await get(gameRef);
  const data = dataSnap.val();
  if(data) update(gameRef,{turn:opponent});
}

// --- Render boards ---
function renderBoards(data){
  // Vijand's shots op mijn bord
  if(data[opponent] && data[opponent].shots){
    Object.keys(data[opponent].shots).forEach(k=>{
      const [x,y]=k.split(",");
      const cell = [...myBoardDiv.children].find(c=>c.dataset.x==x && c.dataset.y==y);
      if(!cell) return;
      if(myShips.includes(k)){ cell.style.background="red"; cell.textContent="🔥"; }
      else{ cell.style.background="blue"; cell.textContent="🌊"; }
    });
  }

  // Mijn shots op vijand bord
  if(data[username] && data[username].shots && data[opponent] && data[opponent].ships){
    Object.keys(data[username].shots).forEach(k=>{
      const [x,y]=k.split(",");
      const cell = [...enemyBoardDiv.children].find(c=>c.dataset.x==x && c.dataset.y==y);
      if(!cell) return;
      if(data[opponent].ships.includes(k)){ cell.style.background="red"; cell.textContent="🔥"; }
      else{ cell.style.background="blue"; cell.textContent="🌊"; }
    });
  }
}

// --- Check overwinning ---
function checkWin(data){
  if(!data[username] || !data[opponent]) return;
  const enemyShipsLeft = data[opponent].ships.filter(s=>!data[username].shots[s]);
  const myShipsLeft = myShips.filter(s=>!data[opponent].shots || !Object.keys(data[opponent].shots).includes(s));

  if(enemyShipsLeft.length===0){
    gameMessage.textContent="🎉 Jij hebt gewonnen!";
    if(!isGuest) endGame(username,opponent);
    phase="ended";
  }else if(myShipsLeft.length===0){
    gameMessage.textContent="💀 Je hebt verloren!";
    if(!isGuest) endGame(opponent,username);
    phase="ended";
  }
}

// --- Einde spel ---
async function endGame(winner,loser){
  const winnerRef = ref(db,"users/"+winner);
  const loserRef = ref(db,"users/"+loser);

  const winnerSnap = await get(winnerRef);
  const loserSnap = await get(loserRef);

  const winnerData = winnerSnap.val();
  const loserData = loserSnap.val();

  await update(winnerRef,{wins:(winnerData?.wins||0)+1,games:(winnerData?.games||0)+1});
  await update(loserRef,{games:(loserData?.games||0)+1});
}
