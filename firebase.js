import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, update, onValue } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCdI588pB7GMPJcjDJTHLAWjOmADixFnvw",
  authDomain: "zeeslag-game.firebaseapp.com",
  databaseURL: "https://zeeslag-game-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "zeeslag-game",
  storageBucket: "zeeslag-game.appspot.com",
  messagingSenderId: "638867155979",
  appId: "1:638867155979:web:58b7c53a5c2bf734782b0e"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, get, update, onValue };
