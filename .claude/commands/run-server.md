Start the clio-fs server and open it in the default browser.

Run in the background:
```bash
corepack pnpm run server:open
```

Wait until the server is reachable (the script handles opening the browser tab itself):
```bash
until curl -sf http://127.0.0.1:4025 > /dev/null 2>&1; do sleep 0.5; done
```

Report back that the server is running at http://127.0.0.1:4025.
