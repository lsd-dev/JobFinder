// Firebase web app configuration for the dashboard (milestone 5).
//
// These values identify the project; they are not secrets and ship in every
// Firebase web app. Access to data is controlled by firestore.rules and the
// private space key, never by this file. Analytics is not used, so
// measurementId is left out.
export const firebaseConfig = {
  apiKey: "AIzaSyA-_bd8BCZifOiuiWLXGgzhsCitOGbdkH0",
  authDomain: "jobfinder-9a0fc.firebaseapp.com",
  projectId: "jobfinder-9a0fc",
  storageBucket: "jobfinder-9a0fc.firebasestorage.app",
  messagingSenderId: "117447288902",
  appId: "1:117447288902:web:f95d3adaaf3a4047b90247",
} as const;

// Web Push certificate key (public). Create it in Firebase console > Project
// settings > Cloud Messaging > Web Push certificates > Generate key pair, and
// paste the "Key pair" value here. Like the config above it is a public
// identifier, safe to commit. While it is empty, the dashboard does not offer
// push notifications.
export const vapidKey: string = "BPqmwI6DfhXMzizq9fH3TmIUpz-vTsp4j3TiGSie9iTDecrP0kJ-a6y41mwwfOHfd45_964LBN3z1GeUIRt0a_Q";
