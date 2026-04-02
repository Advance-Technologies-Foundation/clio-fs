Start the clio-fs client UI and open it in the default browser.

1. Run in the background:
```bash
corepack pnpm run client-ui:open
```

2. Wait for the server to be ready, then open the browser:
```bash
until curl -sf http://127.0.0.1:4026 > /dev/null 2>&1; do sleep 0.5; done; open http://127.0.0.1:4026
```

Report back that the client is running at http://127.0.0.1:4026 and the browser has been opened.
