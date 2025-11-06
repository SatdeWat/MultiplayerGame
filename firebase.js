// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, push, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCdI588pB7GMPJcjDJTHLAWjOmADixFnvw",
  authDomain: "zeeslag-game.firebaseapp.com",
  databaseURL: "https://zeeslag-game-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "zeeslag-game",
  storageBucket: "zeeslag-game.firebasestorage.app",
  messagingSenderId: "638867155979",
  appId: "1:638867155979:web:58b7c53a5c2bf734782b0e"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export { ref, set, get, update, onValue, push, remove };
