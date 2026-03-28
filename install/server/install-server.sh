#!/usr/bin/env sh
set -eu

REPOSITORY="${CLIO_FS_GITHUB_REPOSITORY:-Advance-Technologies-Foundation/clio-fs}"
INSTALL_ROOT="${CLIO_FS_SERVER_INSTALL_ROOT:-/opt/clio-fs/server}"
APP_DIR_NAME="clio-fs-server"
DEFAULT_SERVER_HOST="${CLIO_FS_SERVER_HOST:-0.0.0.0}"
DEFAULT_SERVER_PORT="${CLIO_FS_SERVER_PORT:-4020}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

normalize_tag() {
  case "$1" in
    v*) printf '%s\n' "$1" ;;
    *) printf 'v%s\n' "$1" ;;
  esac
}

copy_if_missing() {
  source_path="$1"
  destination_path="$2"

  if [ -f "$source_path" ] && [ ! -f "$destination_path" ]; then
    cp "$source_path" "$destination_path"
  fi
}

is_valid_port() {
  case "$1" in
    ''|*[!0-9]*)
      return 1
      ;;
  esac

  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

prompt_for_server_port() {
  if is_valid_port "$DEFAULT_SERVER_PORT"; then
    default_port="$DEFAULT_SERVER_PORT"
  else
    default_port="4020"
  fi

  if [ -n "${CLIO_FS_SERVER_PORT:-}" ]; then
    if is_valid_port "$CLIO_FS_SERVER_PORT"; then
      printf '%s\n' "$CLIO_FS_SERVER_PORT"
      return 0
    fi

    echo "Invalid CLIO_FS_SERVER_PORT: ${CLIO_FS_SERVER_PORT}" >&2
    exit 1
  fi

  if [ ! -t 0 ]; then
    echo "No interactive terminal detected; using default server port ${default_port}" >&2
    printf '%s\n' "$default_port"
    return 0
  fi

  while true; do
    printf 'Server port [default %s]: ' "$default_port" >&2
    IFS= read -r selected_port

    if [ -z "$selected_port" ]; then
      selected_port="$default_port"
    fi

    if is_valid_port "$selected_port"; then
      printf '%s\n' "$selected_port"
      return 0
    fi

    echo "Port must be an integer between 1 and 65535." >&2
  done
}

write_initial_server_config() {
  config_path="$1"
  host="$2"
  port="$3"
  tmp_config_path="${config_path}.tmp"

  awk -v host="$host" -v port="$port" '
    BEGIN {
      host_written = 0
      port_written = 0
    }
    /^CLIO_FS_SERVER_HOST=/ {
      print "CLIO_FS_SERVER_HOST=" host
      host_written = 1
      next
    }
    /^CLIO_FS_SERVER_PORT=/ {
      print "CLIO_FS_SERVER_PORT=" port
      port_written = 1
      next
    }
    { print }
    END {
      if (!host_written) {
        print "CLIO_FS_SERVER_HOST=" host
      }
      if (!port_written) {
        print "CLIO_FS_SERVER_PORT=" port
      }
    }
  ' "$config_path" > "$tmp_config_path"

  mv "$tmp_config_path" "$config_path"
}

require_command curl
require_command tar
require_command mktemp

platform="$(uname -s)"

case "$platform" in
  Linux) asset_platform="linux" ;;
  Darwin) asset_platform="macos" ;;
  *)
    echo "Unsupported platform: $platform" >&2
    exit 1
    ;;
esac

if [ "${CLIO_FS_VERSION:-}" ]; then
  release_tag="$(normalize_tag "$CLIO_FS_VERSION")"
else
  release_tag="$(
    curl -fsSL "https://api.github.com/repos/$REPOSITORY/releases/latest" |
      sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
      head -n 1
  )"

  if [ -z "$release_tag" ]; then
    echo "Unable to resolve latest release tag for $REPOSITORY" >&2
    exit 1
  fi
fi

release_version="${release_tag#v}"
asset_name="clio-fs-${release_tag}-${asset_platform}.tar.gz"
download_url="https://github.com/${REPOSITORY}/releases/download/${release_tag}/${asset_name}"
tmp_dir="$(mktemp -d)"
archive_path="${tmp_dir}/${asset_name}"
extract_dir="${tmp_dir}/extract"
source_dir="${extract_dir}/${APP_DIR_NAME}-${release_tag}"
release_root="${INSTALL_ROOT}/releases/${release_version}"
current_link="${INSTALL_ROOT}/current"
shared_config_dir="${INSTALL_ROOT}/config"
shared_data_dir="${INSTALL_ROOT}/data"
shared_state_dir="${shared_data_dir}/.clio-fs"

cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT INT TERM

echo "Downloading ${download_url}"
curl -fL "$download_url" -o "$archive_path"
mkdir -p "$extract_dir"
tar -xzf "$archive_path" -C "$extract_dir"

if [ ! -d "$source_dir" ]; then
  echo "Release archive did not contain ${APP_DIR_NAME}-${release_tag}" >&2
  exit 1
fi

if [ -e "$release_root" ]; then
  echo "Install target already exists: $release_root" >&2
  exit 1
fi

mkdir -p "${INSTALL_ROOT}/releases" "$shared_config_dir" "$shared_state_dir"
cp -R "$source_dir" "$release_root"

rm -rf "${release_root}/config" "${release_root}/.clio-fs"
ln -s "$shared_config_dir" "${release_root}/config"
ln -s "$shared_state_dir" "${release_root}/.clio-fs"

is_fresh_install="false"

if [ ! -f "${shared_config_dir}/server.conf" ]; then
  is_fresh_install="true"
fi

copy_if_missing "$source_dir/config/shared.conf.example" "${shared_config_dir}/shared.conf"
copy_if_missing "$source_dir/config/server.conf.example" "${shared_config_dir}/server.conf"

if [ "$is_fresh_install" = "true" ]; then
  selected_port="$(prompt_for_server_port)"
  write_initial_server_config "${shared_config_dir}/server.conf" "$DEFAULT_SERVER_HOST" "$selected_port"
  echo "Initialized ${shared_config_dir}/server.conf with host ${DEFAULT_SERVER_HOST} and port ${selected_port}"
fi

rm -f "$current_link"
ln -s "$release_root" "$current_link"

echo "Installed ${APP_DIR_NAME} ${release_version}"
echo "Current release: $current_link"
echo "Config directory: $shared_config_dir"
echo "State directory: $shared_state_dir"
echo "Next step: edit ${shared_config_dir}/server.conf and start ${current_link}/clio-fs-server"
