/* Tracker databases the AF Helper can open (same list as platform/projects.json,
   which is not deployed). platform/tests/design.test.cjs fails if they differ. */
window.AF_PROJECTS = [
  {
    "id": "ac3",
    "name": "Atlantic-Chestnut Building 3",
    "databaseURL": "https://af-hub-8f188-ac3.firebaseio.com"
  },
  {
    "id": "cp2",
    "name": "Cooper Park 2",
    "databaseURL": "https://af-hub-8f188-cp2.firebaseio.com"
  },
  {
    "id": "lex",
    "name": "355 Lexington Avenue",
    "databaseURL": "https://af-hub-8f188-lex.firebaseio.com"
  }
];
