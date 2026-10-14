/* ============================================================
   Firebase config — AF Design Boards (/design/)
   ------------------------------------------------------------
   Same Firebase project as every tracker (af-hub-8f188, one
   login), but its OWN database: af-hub-8f188-design. Every
   project's Design Board lives there under /boards/<board>.
   No tracker reads or writes this database, and the design
   team is on no tracker list.

   Safety net: the database says what it is (/meta/project =
   "design"); the page checks that before reading or writing.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCfqxqfSalL6azSb-tF_UBAPJ0BvcLkfUk",
  authDomain: "af-hub-8f188.firebaseapp.com",
  databaseURL: "https://af-hub-8f188-design.firebaseio.com",
  projectId: "af-hub-8f188",
  storageBucket: "af-hub-8f188.firebasestorage.app",
  messagingSenderId: "614887588126",
  appId: "1:614887588126:web:e02c8123c96fab905e090f"
};
