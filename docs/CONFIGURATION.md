# Configuration

`clio-fs` supports configuration through `.conf` files with `KEY=value` pairs.

## File Format

- one setting per line
- `#` and `;` start comments
- values may be plain text or wrapped in single or double quotes
- environment variables still work and always override values loaded from `.conf`

Example:

```conf
CLIO_FS_SERVER_PORT=4010
CLIO_FS_SERVER_AUTH_TOKEN="change-me"
```

## Conventional Config Files

When a process starts, it automatically reads these files from the current working directory if they exist:

- `config/shared.conf`
- `config/server.conf`
- `config/server-ui.conf`
- `config/client.conf`
- `config/client-ui.conf`

You do not need to set extra flags for these conventional paths.

## Explicit Config File Overrides

If you want to keep config files somewhere else, point the process at them with environment variables:

- `CLIO_FS_CONFIG_FILE`
- `CLIO_FS_SERVER_CONFIG_FILE`
- `CLIO_FS_SERVER_UI_CONFIG_FILE`
- `CLIO_FS_CLIENT_CONFIG_FILE`
- `CLIO_FS_CLIENT_UI_CONFIG_FILE`

These files are loaded before direct environment variables. Direct environment variables still win.

## Server Configuration

Use [`config/server.conf.example`](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/config/server.conf.example) as the starting point.

Typical settings:

- `CLIO_FS_SERVER_HOST`
- `CLIO_FS_SERVER_PORT`
- `CLIO_FS_SERVER_AUTH_TOKEN`
- `CLIO_FS_SERVER_AUTH_TOKENS`
- `CLIO_FS_SERVER_WORKSPACE_REGISTRY_FILE`
- `CLIO_FS_SERVER_WATCH_SETTINGS_FILE`
- `CLIO_FS_SERVER_CHANGE_JOURNAL_FILE`
- `CLIO_FS_SERVER_UI_HOST`
- `CLIO_FS_SERVER_UI_PORT`

## Client Configuration

Use [`config/client.conf.example`](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/config/client.conf.example) as the starting point.

Typical settings:

- `CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL`
- `CLIO_FS_CLIENT_CONTROL_PLANE_AUTH_TOKEN`
- `CLIO_FS_CLIENT_DEFAULT_WORKSPACE_ROOT`
- `CLIO_FS_CLIENT_SYNC_CONFIG_FILE`
- `CLIO_FS_CLIENT_STATE_FILE`
- `CLIO_FS_CLIENT_POLL_INTERVAL_MS`
- `CLIO_FS_CLIENT_LOCAL_WATCH_SCAN_INTERVAL_MS`
- `CLIO_FS_CLIENT_UI_HOST`
- `CLIO_FS_CLIENT_UI_PORT`

`CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL` can point either to the direct API origin or to the public server UI origin. When the configured path is empty, the runtime automatically resolves API calls through `/api` on the same origin.

## Recommended Pattern

For GitHub Release installs:

1. extract the release archive
2. create a `config/` folder next to the launcher
3. copy the appropriate `.example` file to a real `.conf` file
4. edit the values
5. start the launcher from that same extracted directory

Because the process reads `config/*.conf` from its working directory, this gives a simple zero-flag setup for both server and client deployments.
