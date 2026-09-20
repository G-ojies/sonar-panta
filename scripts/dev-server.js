// Programmatic Next dev server (the `next dev` CLI exits in non-TTY sandboxes).
const next = require('next'); const http = require('http');
const port = Number(process.env.PORT || 3000);
const app = next({ dev: true, dir: process.cwd() }); const handle = app.getRequestHandler();
app.prepare().then(() => { http.createServer((req, res) => handle(req, res)).listen(port, () => console.log(`ready on http://localhost:${port}`)); });
