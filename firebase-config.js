// firebase-config.js
// Initialiseert Firebase Realtime Database en exporteert 'db'.
// VERVANG MET JE EIGEN CONFIG ALS JE WIL

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* --- JE CONFIG HIER --- */
const firebaseConfig = {
  apiKey: "AIzaSyCdI588pB7GMPJcjDJTHLAWjOmADixFnvw",
  authDomain: "zeeslag-game.firebaseapp.com",
  databaseURL: "https://zeeslag-game-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "zeeslag-game",
  storageBucket: "zeeslag-game.firebasedomain.app",
  messagingSenderId: "638867155979",
  appId: "1:638867155979:web:58b7c53a5c2bf734782b0e"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export default firebaseConfig;
