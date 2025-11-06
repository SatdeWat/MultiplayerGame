import { db, ref, set, get, onValue, update } from "./firebase.js";

const username = localStorage.getItem("username");
const isGuest = localStorage.getItem("isGuest") === "true";
const lobbyCode = localStorage.getItem("lobbyCode");

if(!username || !lobbyCode) window.location.href="index.html";

const lobbyScreen = document.getElementById("lobbyScreen");
const gameScreen = document.getElementById("gameScreen");
const readyBtn = document.getElementById("readyBtn");
const rotateBtn = document.getElementById("rotateBtn");
const playerNameSpan = document.getElementById("playerName");
const opponentNameSpan = document.getElementById("opponentName");
const lobbyCodeDisplay = document.getElementById("lobbyCodeDisplay");
const myBoardDiv = document.getElementById("myBoard");
const enemyBoardDiv = document.getElementById("enemyBoard");
const turnInfo = document.getElementById("turnInfo");
const gameMessage = document.getElementById("gameMessage");

let lobbyData = null;
let opponent = null;
let size = 10;
let shipsArray = [];
let placedShips = [];
let hoverCells = [];
let orientation = "horizontal";
let phase = "placing";
let myShots = {};
let isMyTurn = false;

const lobbyRef = ref(db,"lobbies/"+lobbyCode);
const gameRef = ref(db,"games/"+lobbyCode);

async function init(){
  const snap = await get(lobbyRef);
  if(!snap.exists()){ alert("Lobby niet gevonden!"); window.location.href="home.html"; return; }
  lobbyData = snap.val();
  size = lobbyData.size;
  shipsArray = Array(lobbyData.ships).fill(0).map((_,i)=>lobbyData.ships-i);
  opponent = (lobbyData.host === username)?lobbyData.guest:lobbyData.host;
  lobbyCodeDisplay.textContent = lobbyCode;
  playerNameSpan.textContent = username + " ❌";
  createBoard(myBoardDiv,size,true,placeShipPreview);
  createBoard(enemyBoardDiv,size,false,shoot);

  onValue(lobbyRef,snap=>{
    const data = snap.val();
    opponent = (lobbyData.host === username)?data.guest:data.host;
    opponentNameSpan.textContent = (opponent || "Wachten...") + ((data.ready?.[opponent])?" ✅":" ❌");

    if(data.ready?.[username] && data.ready?.[opponent]){
      startGame();
    }
  });
}
init();

// --- Bord maken ---
function createBoard(boardDiv,size,clickable=false,handler=null){
  boardDiv.innerHTML="";
  boardDiv.style.gridTemplateColumns=`repeat(${size},40px)`;
  boardDiv.style.gridTemplateRows=`repeat(${size},40px)`;
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x=x;
      cell.dataset.y=y;
      if(clickable && handler){
        cell.addEventListener("mouseenter",()=>handler(x,y,true));
        cell.addEventListener("mouseleave",()=>handler(x,y,false));
        cell.addEventListener("click",()=>handler(x,y,"place"));
      }
      boardDiv.appendChild(cell);
    }
  }
}

// --- Hover / Plaats ---
function placeShipPreview(x,y,action){
  if(phase!=="placing") return;
  const length = shipsArray[0];
  const coords=[];
  for(let i=0;i<length;i++){
    let cx = x + (orientation==="horizontal"?i:0);
    let cy = y + (orientation==="vertical"?i:0);
    if(cx>=size || cy>=size) return;
    coords.push(`${cx},${cy}`);
  }

  if(action===true){coords.forEach(c=>{ const [cx,cy]=c.split(","); const cell=[...myBoardDiv.children].find(d=>d.dataset.x==cx&&d.dataset.y==cy); if(cell) {cell.style.background="rgba(0,255,0,0.4)"; hoverCells.push(cell);}});}
  else if(action===false){hoverCells.forEach(c=>c.style.background="rgba(255,255,255,0.1)"); hoverCells=[];}
  else if(action==="place"){
    if(coords.flat().some(c=>placedShips.flat().includes(c))) return alert("Schepen overlappen niet!");
    placedShips.push(coords);
    coords.forEach(c=>{ const [cx,cy]=c.split(","); const cell=[...myBoardDiv.children].find(d=>d.dataset.x==cx&&d.dataset.y==cy); if(cell){ cell.style.background="#4caf50"; cell.textContent="🚢";}});
    shipsArray.shift();
    if(shipsArray.length>0) gameMessage.textContent=`Plaats schip van lengte ${shipsArray[0]}`;
    else gameMessage.textContent="Klik op Klaar als je klaar bent!";
  }
}

// --- Rotate ---
rotateBtn.addEventListener("click",()=>{orientation=orientation==="horizontal"?"vertical":"horizontal";});

// --- Klaar ---
readyBtn.addEventListener("click", async ()=>{
  if(shipsArray.length>0){ alert("Plaats eerst alle schepen!"); return; }
  phase="waiting";
  readyBtn.disabled=true;
  if(!isGuest){
    await update(ref(db,`lobbies/${lobbyCode}/ready`),{[username]:true});
    await set(ref(db,`games/${lobbyCode}/${username}`),{ships:placedShips.flat(),shots:{},ready:true});
  }
});

// --- Start spel ---
function startGame(){
  lobbyScreen.style.display="none";
  gameScreen.style.display="block";
  phase="playing";
  gameMessage.textContent="Spel gestart!";

  onValue(gameRef,snap=>{
    const d=snap.val()||{};
    isMyTurn=d.turn===username;
    turnInfo.textContent=isMyTurn?"Jij bent aan de beurt!":"Tegenstander is aan de beurt...";
    renderBoards(d);
    checkWin(d);
  });

  // bepaal eerste beurt als nog niet gezet
  get(gameRef).then(snap=>{
    const d=snap.val()||{};
    if(!d.turn){
      const first = Math.random()<0.5?username:opponent;
      update(gameRef,{turn:first});
    }
  });
}

// --- Schieten ---
async function shoot(x,y){
  if(!isMyTurn || phase!=="playing") return;
  const key=`${x},${y}`;
  const myDataSnap = await get(ref(db,`games/${lobbyCode}/${username}/shots`));
  const myData = myDataSnap.val()||{};
  if(myData[key]) return;

  myData[key]=true;
  await update(ref(db,`games/${lobbyCode}/${username}/shots`),myData);
  await update(gameRef,{turn:opponent});
}

// --- Render ---
function renderBoards(data){
  if(data[opponent]?.shots){
    Object.keys(data[opponent].shots).forEach(k=>{
      const [x,y]=k.split(",");
      const cell=[...myBoardDiv.children].find(c=>c.dataset.x==x && c.dataset.y==y);
      if(!cell) return;
      if(placedShips.flat().includes(k)){ cell.style.background="red"; cell.textContent="🔥"; }
      else { cell.style.background="blue"; cell.textContent="🌊"; }
    });
  }
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
    setTimeout(()=>window.location.href="end.html",2000);
  } else if(myShipsLeft.length===0){
    gameMessage.textContent="💀 Je hebt verloren!";
    if(!isGuest) endGame(opponent, username);
    phase="ended";
    setTimeout(()=>window.location.href="end.html",2000);
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
