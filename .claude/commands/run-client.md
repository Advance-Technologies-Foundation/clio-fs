Start the clio-fs client UI and open it in the default browser.

Run in the background:
```bash
corepack pnpm run client-ui:open
```

Wait until the UI is reachable (the script handles opening the browser tab itself):
```bash
until curl -sf http://127.0.0.1:4026 > /dev/null 2>&1; do sleep 0.5; done
```

Report back that the client is running at http://127.0.0.1:4026.
