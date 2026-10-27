#!/usr/bin/env bash
# One-time setup of the character app on the home server (inside container 106 "dmdash", as root).
#   pct exec 106 -- bash -c "git clone https://github.com/jdatje/dnd-character /opt/dnd-character && bash /opt/dnd-character/deploy/setup.sh"
# Safe to run again: it only (re)writes its own service, its own update command and its own Tailscale port.
set -euo pipefail

APP=/opt/dnd-character
DATA=/var/lib/dnd-character
PORT=3200
HTTPS_PORT=8444

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "Node.js is not installed in this container." >&2; exit 1; fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then echo "Node.js $MAJOR is too old (need 22 or newer)." >&2; exit 1; fi

if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --quiet origin main
  git -C "$APP" reset --hard --quiet origin/main
else
  git clone https://github.com/jdatje/dnd-character "$APP"
fi

mkdir -p "$DATA"
chmod 700 "$DATA"

cat > /etc/systemd/system/dnd-character.service <<EOF
[Unit]
Description=D&D character app
After=network-online.target
Wants=network-online.target

[Service]
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA
WorkingDirectory=$APP
ExecStart=$NODE $APP/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

install -m 755 "$APP/deploy/dnd-update" /usr/local/bin/dnd-update
systemctl daemon-reload
systemctl enable --now dnd-character
systemctl restart dnd-character

echo "Waiting for the app to start..."
for i in $(seq 1 15); do
  if "$NODE" -e "fetch('http://127.0.0.1:$PORT/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then OK=1; break; fi
  sleep 1
done
if [ "${OK:-0}" != 1 ]; then
  echo "The app did not start. Log:" >&2
  journalctl -u dnd-character -n 30 --no-pager >&2
  exit 1
fi

# private https address, only for devices on your Tailscale (next to the dashboard on 443 and the dinner planner on 8443)
tailscale serve --bg --https=$HTTPS_PORT http://127.0.0.1:$PORT >/dev/null
NAME="$(tailscale status --json | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,'')))")"

echo
echo "Done. Open on your phone (Tailscale on):"
echo "  https://$NAME:$HTTPS_PORT"
echo "Update later with:  pct exec 106 -- dnd-update"
