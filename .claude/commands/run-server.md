Start the clio-fs server and open it in the default browser.

1. Run in the background:
```bash
corepack pnpm run server:open
```

2. Wait for the server to be ready, then open the browser:
```bash
until curl -sf http://127.0.0.1:4025 > /dev/null 2>&1; do sleep 0.5; done; open http://127.0.0.1:4025
```

Report back that the server is running at http://127.0.0.1:4025 and the browser has been opened.
