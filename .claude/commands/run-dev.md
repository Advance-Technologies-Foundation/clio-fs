Start the clio-fs server and client UI together, and open the client UI in the default browser.

Run in the background:
```bash
corepack pnpm run dev:open
```

Wait until the client UI is reachable (the script handles opening the browser tab itself):
```bash
until curl -sf http://127.0.0.1:4026 > /dev/null 2>&1; do sleep 0.5; done
```

Report back that both apps are running:
- Server API: http://127.0.0.1:4025
- Client UI: http://127.0.0.1:4026
