import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBFTaTXzXUDJzG7vqWRsuKnu3faCziK_68",
  authDomain: "organizadorcasos.firebaseapp.com",
  projectId: "organizadorcasos",
  storageBucket: "organizadorcasos.firebasestorage.app",
  messagingSenderId: "736147068663",
  appId: "1:736147068663:web:0e409e5b83a504ad5125f2",
  measurementId: "G-GBP2L2KNGF"
};

const app = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);
