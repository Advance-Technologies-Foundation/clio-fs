#!/usr/bin/env sh
set -eu

INSTALL_ROOT="${CLIO_FS_SERVER_INSTALL_ROOT:-/opt/clio-fs/server}"
FORCE_UNINSTALL="${CLIO_FS_FORCE_UNINSTALL:-0}"
APP_NAME="clio-fs-server"

confirm_uninstall() {
  if [ "$FORCE_UNINSTALL" = "1" ]; then
    return 0
  fi

  if [ ! -t 0 ]; then
    echo "Refusing to uninstall ${APP_NAME} without confirmation. Re-run with CLIO_FS_FORCE_UNINSTALL=1." >&2
    exit 1
  fi

  printf 'Uninstall %s from %s? This removes releases, config, and state [y/N]: ' "$APP_NAME" "$INSTALL_ROOT" >&2
  IFS= read -r response

  case "$response" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      echo "Uninstall cancelled." >&2
      exit 1
      ;;
  esac
}

remove_path_if_present() {
  target_path="$1"

  if [ -e "$target_path" ] || [ -L "$target_path" ]; then
    rm -rf "$target_path"
  fi
}

if [ ! -d "$INSTALL_ROOT" ] && [ ! -L "$INSTALL_ROOT" ]; then
  echo "${APP_NAME} is not installed at ${INSTALL_ROOT}"
  exit 0
fi

confirm_uninstall

remove_path_if_present "${INSTALL_ROOT}/current"
remove_path_if_present "${INSTALL_ROOT}/releases"
remove_path_if_present "${INSTALL_ROOT}/config"
remove_path_if_present "${INSTALL_ROOT}/data"

if rmdir "$INSTALL_ROOT" 2>/dev/null; then
  echo "Removed empty install root ${INSTALL_ROOT}"
fi

echo "Uninstalled ${APP_NAME} from ${INSTALL_ROOT}"
