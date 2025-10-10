// firebase-config.js — verbind je app met Firebase Realtime Database
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js"; // Firebase library om de app te starten
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js"; // helper voor Realtime DB

// hieronder staan jouw Firebase-instellingen (die je eerder gaf)
const firebaseConfig = { // var met alle instellingen die Firebase nodig heeft
  apiKey: "AIzaSyCdI588pB7GMPJcjDJTHLAWjOmADixFnvw", // sleutel die jouw site aan je Firebase-project koppelt
  authDomain: "zeeslag-game.firebaseapp.com", // domein voor auth (we gebruiken geen Firebase Auth maar het hoort erbij)
  databaseURL: "https://zeeslag-game-default-rtdb.europe-west1.firebasedatabase.app", // link naar jouw Realtime DB
  projectId: "zeeslag-game", // id van je Firebase project
  storageBucket: "zeeslag-game.appspot.com", // opslag-bucket (niet cruciaal voor dit spel)
  messagingSenderId: "638867155979", // voor push messaging (niet gebruikt in de game)
  appId: "1:638867155979:web:58b7c53a5c2bf734782b0e" // unieke id van je webapp
};

const app = initializeApp(firebaseConfig); // start Firebase met bovenstaande instellingen
export const db = getDatabase(app); // maak en exporteer de database-verbinding zodat andere scripts 'db' kunnen importeren
