# Configuration

`clio-fs` supports configuration through `.conf` files with `KEY=value` pairs.

## File Format

- one setting per line
- `#` and `;` start comments
- values may be plain text or wrapped in single or double quotes
- environment variables still work and always override values loaded from `.conf`

Example:

```conf
CLIO_FS_SERVER_PORT=4020
CLIO_FS_SERVER_AUTH_TOKEN="change-me"
```

## Conventional Config Files

When a process starts, it automatically reads these files from the current working directory if they exist:

- `config/shared.conf`
- `config/server.conf`
- `config/client.conf`
- `config/client-ui.conf`

You do not need to set extra flags for these conventional paths.

## Explicit Config File Overrides

If you want to keep config files somewhere else, point the process at them with environment variables:

- `CLIO_FS_CONFIG_FILE`
- `CLIO_FS_SERVER_CONFIG_FILE`
- `CLIO_FS_CLIENT_CONFIG_FILE`
- `CLIO_FS_CLIENT_UI_CONFIG_FILE`

These files are loaded before direct environment variables. Direct environment variables still win.

## Server Configuration

Use [`config/server.conf.example`](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/config/server.conf.example) as the starting point.

The release template binds the server to `0.0.0.0` by default so the operator UI and API are reachable from other machines. Restrict access with your firewall and auth tokens as needed.

Typical settings:

- `CLIO_FS_SERVER_HOST`
- `CLIO_FS_SERVER_PORT`
- `CLIO_FS_SERVER_AUTH_TOKEN`
- `CLIO_FS_SERVER_AUTH_TOKENS`
- `CLIO_FS_SERVER_WORKSPACE_REGISTRY_FILE`
- `CLIO_FS_SERVER_WATCH_SETTINGS_FILE`
- `CLIO_FS_SERVER_CHANGE_JOURNAL_FILE`
- `CLIO_FS_SERVER_UPDATE_MANIFEST_URL`

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
- `CLIO_FS_CLIENT_UPDATE_MANIFEST_URL`
- `CLIO_FS_CLIENT_UI_HOST`
- `CLIO_FS_CLIENT_UI_PORT`
- `CLIO_FS_CLIENT_OPEN_BROWSER`

`CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL` must point to the public server origin. The runtime resolves API calls through `/api` on that same origin.
When `CLIO_FS_CLIENT_OPEN_BROWSER` is not set or is any value other than `0`, the client launcher opens both the local client UI and the public server origin in the default browser after startup.

## Recommended Pattern

For GitHub Release installs:

1. extract the release archive
2. create a `config/` folder next to the launcher
3. copy the appropriate `.example` file to a real `.conf` file
4. edit the values
5. start the launcher from that same extracted directory

Because the process reads `config/*.conf` from its working directory, this gives a simple zero-flag setup for both server and client deployments.

## Installer-Based Layout

The installer scripts under [install/server/install-server.sh](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/server/install-server.sh), [install/server/install-server.ps1](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/server/install-server.ps1), [install/client/install-client.sh](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/client/install-client.sh), and [install/client/install-client.ps1](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/client/install-client.ps1) create a shared config directory outside the versioned release folder and link it into `current`.

Matching uninstall scripts under [install/server/uninstall-server.sh](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/server/uninstall-server.sh), [install/server/uninstall-server.ps1](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/server/uninstall-server.ps1), [install/client/uninstall-client.sh](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/client/uninstall-client.sh), and [install/client/uninstall-client.ps1](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/client/uninstall-client.ps1) remove only the managed install content under those same roots: `current`, `releases`, `config`, and `data`.

Server install layout:

- macOS or Linux:
  - install root: `/opt/clio-fs/server`
  - active release: `/opt/clio-fs/server/current`
  - config directory: `/opt/clio-fs/server/config`
  - state directory: `/opt/clio-fs/server/data/.clio-fs`
- Windows:
  - install root: `C:\Program Files\ClioFS\server`
  - active release: `C:\Program Files\ClioFS\server\current`
  - config directory: `C:\Program Files\ClioFS\server\config`
  - state directory: `C:\Program Files\ClioFS\server\data\.clio-fs`

Client install layout:

- macOS or Linux:
  - install root: `/opt/clio-fs/client`
  - active release: `/opt/clio-fs/client/current`
  - config directory: `/opt/clio-fs/client/config`
  - state directory: `/opt/clio-fs/client/data/.clio-fs`
- Windows:
  - install root: `C:\Program Files\ClioFS\client`
  - active release: `C:\Program Files\ClioFS\client\current`
  - config directory: `C:\Program Files\ClioFS\client\config`
  - state directory: `C:\Program Files\ClioFS\client\data\.clio-fs`

Installer behavior:

- the first server install prompts for the server port, writes `CLIO_FS_SERVER_HOST=0.0.0.0`, and initializes `server.conf` in the shared config directory
- the first client install copies `.example` templates into the shared config directory if no real config file exists yet
- later installs preserve the existing config directory and only switch `current` to a new versioned release
- uninstall keeps unrelated extra files under the install root untouched and removes the install root itself only when it becomes empty
- runtime commands such as `version` and `healthcheck` should be executed from the `current` launcher path
- manual update apply uses these install roots:
  - server: `CLIO_FS_SERVER_INSTALL_ROOT`
  - client: `CLIO_FS_CLIENT_INSTALL_ROOT`
- if those variables are not set, development runs fall back to `.clio-fs/server/runtime` and `.clio-fs/client/runtime`

Typical installer workflow:

1. run the installer script for server or client
2. edit the config file under the shared `config` directory
3. verify with the launcher under `current`
4. start the launcher or register the matching service unit
