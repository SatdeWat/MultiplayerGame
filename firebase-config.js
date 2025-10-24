// firebase-config.js — verbindt deze app met jouw Firebase Realtime DB
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js"; // Firebase app starter
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js"; // RTDB helper

// Vervang hieronder niet tenzij je een andere Firebase hebt
const firebaseConfig = { // jouw projectinstellingen
  apiKey: "AIzaSyCdI588pB7GMPJcjDJTHLAWjOmADixFnvw", // API sleutel
  authDomain: "zeeslag-game.firebaseapp.com", // auth domein (niet direct gebruikt)
  databaseURL: "https://zeeslag-game-default-rtdb.europe-west1.firebasedatabase.app", // database url
  projectId: "zeeslag-game", // project id
  storageBucket: "zeeslag-game.appspot.com", // storage (niet gebruikt)
  messagingSenderId: "638867155979", // messaging id (niet gebruikt)
  appId: "1:638867155979:web:58b7c53a5c2bf734782b0e" // app id
};

const app = initializeApp(firebaseConfig); // start Firebase met instellingen
export const db = getDatabase(app); // exporteer database voor andere scripts

