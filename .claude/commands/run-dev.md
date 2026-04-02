Start the clio-fs server and client UI together, and open both in the default browser.

1. Run in the background:
```bash
corepack pnpm run dev:open
```

2. Wait for the server to be ready, then open both UIs:
```bash
until curl -sf http://127.0.0.1:4025 > /dev/null 2>&1; do sleep 0.5; done; open http://127.0.0.1:4025
until curl -sf http://127.0.0.1:4026 > /dev/null 2>&1; do sleep 0.5; done; open http://127.0.0.1:4026
```

Report back that both apps are running and the browser tabs have been opened:
- Server: http://127.0.0.1:4025
- Client UI: http://127.0.0.1:4026
