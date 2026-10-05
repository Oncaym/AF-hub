/* ============================================================
   Firebase config — Atlantic-Chestnut Building 3
   ------------------------------------------------------------
   AF Hub: every project lives in the shared Firebase project
   af-hub-8f188 (one login for all projects) but has its OWN
   database: af-hub-8f188-ac3. Only databaseURL differs between
   projects.

   Safety net: the database stores which project it is
   (/meta/project = "ac3"), and project-config.js says which
   project this page is (PROJECT.hubId). If the two ever
   disagree — e.g. this file was copied from another project and
   not edited — the page stops with a red message and the rules
   refuse every save. So when you copy a project folder, change
   BOTH files.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCfqxqfSalL6azSb-tF_UBAPJ0BvcLkfUk",
  authDomain: "af-hub-8f188.firebaseapp.com",
  databaseURL: "https://af-hub-8f188-ac3.firebaseio.com",
  projectId: "af-hub-8f188",
  storageBucket: "af-hub-8f188.firebasestorage.app",
  messagingSenderId: "614887588126",
  appId: "1:614887588126:web:e02c8123c96fab905e090f"
};
