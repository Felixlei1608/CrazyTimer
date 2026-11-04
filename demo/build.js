// Baut aus der echten App eine einzelne HTML-Datei mit Browser-Mock (Demo ohne Server):  node demo/build.js [ausgabe.html]
const fs = require('fs'), path = require('path');
const r = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const css = r('../public/style.css'), app = r('../public/app.js'), mock = r('mock-backend.js');
const out = `<title>Zeitfluss Demo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="app"></div><div id="modal" class="modal" hidden><div class="sheet" id="sheet"></div></div>
<script>${mock}</script>
<script>${app}</script>
`;
fs.writeFileSync(process.argv[2] || path.join(__dirname, 'zeitfluss-demo.html'), out); console.log('Demo gebaut:', (out.length / 1024).toFixed(0), 'KB');
