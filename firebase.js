// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getDatabase,
  ref as dbRef,
  get as dbGet,
  set as dbSet,
  onValue as dbOnValue,
  push as dbPush,
  update as dbUpdate,
  remove as dbRemove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// --- jouw Firebase config (zoals door jou gegeven) ---
const firebaseConfig = {
  apiKey: "AIzaSyCdI588pB7GMPJcjDJTHLAWjOmADixFnvw",
  authDomain: "zeeslag-game.firebaseapp.com",
  databaseURL: "https://zeeslag-game-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "zeeslag-game",
  storageBucket: "zeeslag-game.firebasestorage.app",
  messagingSenderId: "638867155979",
  appId: "1:638867155979:web:58b7c53a5c2bf734782b0e"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, dbRef, dbGet, dbSet, dbOnValue, dbPush, dbUpdate, dbRemove };
