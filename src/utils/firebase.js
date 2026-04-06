import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, update, onValue, off } from 'firebase/database';


const firebaseConfig = {
  apiKey: "AIzaSyDCKkb_5q7bzmlxPVx1_j6owEWzpHkdXTc",
  authDomain: "ipl-auction-game-fa001.firebaseapp.com",
  databaseURL: "https://ipl-auction-game-fa001-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ipl-auction-game-fa001",
  storageBucket: "ipl-auction-game-fa001.firebasestorage.app",
  messagingSenderId: "112532987630",
  appId: "1:112532987630:web:2f69878fda17d3738addff"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export { ref, set, get, update, onValue, off };