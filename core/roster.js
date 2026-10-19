/* AF Hub — the roster: every project that has a dashboard (tracker) in the hub.
   Used by the hub overview (index.html) and the 🚚 Shop page (/send/).
   Live summaries merge on top on the overview; a project that has never pushed still
   gets a row, dimmed. The list must not be decided by whoever happened to write last.
   Add a row the same day you add hubId to a tracker's project-config.js.
   Trackers that live inside the hub (2026-10: AC3, Lexington, Cooper Park 2) link to their folder.
   (Projects WITHOUT a dashboard are added on the Shop page; they live in the hub database.) */
window.AF_ROSTER = [
  { id:'ac3', name:'Atlantic-Chestnut Building 3', unit:'openings',
    scope:'Storefront / Curtain Wall',
    url:'ac3/' },
  { id:'cp2', name:'Cooper Park 2', unit:'openings',
    scope:'Storefront — GF 71 · L2 6 · L13 5',
    url:'cp2/' },
  { id:'lex', name:'355 Lexington Avenue', unit:'pieces',
    scope:'Shower Door 159 · Terrace Divider 33 · Guardrail 8 · Equipment Screen 2',
    url:'lex/' },
  // Benji's Glass Replacement Tracker, hosted as-is (mn/hub-adapter.js pushes its summary)
  { id:'mn', name:'Morgan North', unit:'panes',
    scope:'Glass replacement',
    url:'mn/' },
];
