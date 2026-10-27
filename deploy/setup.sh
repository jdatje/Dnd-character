#!/usr/bin/env bash
# One-time setup of the character app on the home server (inside container 106 "dmdash", as root).
#   inside the container:   bash /opt/dnd-character/deploy/setup.sh
#   from the HomeDC Shell:  pct exec 106 -- bash /opt/dnd-character/deploy/setup.sh
# Safe to run again: it only (re)writes its own service, its own update command, its own settings file
# (/etc/dnd-character.env) and its own Tailscale port. It picks a free port by itself.
set -euo pipefail

APP=/opt/dnd-character
DATA=/var/lib/dnd-character
ENVFILE=/etc/dnd-character.env
HTTPS_PORT=8444

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "Node.js is not installed in this container." >&2; exit 1; fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then echo "Node.js $MAJOR is too old (need 22 or newer)." >&2; exit 1; fi

if [ ! -d "$APP/.git" ]; then
  git clone https://github.com/jdatje/dnd-character "$APP"
fi

mkdir -p "$DATA"
chmod 700 "$DATA"

# stop our own app first, so it does not count as "in use" below
systemctl stop dnd-character 2>/dev/null || true

port_free() {
  "$NODE" -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen($1,()=>s.close(()=>process.exit(0)))"
}

PORT=""
if [ -f "$ENVFILE" ]; then
  PORT="$(sed -n 's/^PORT=//p' "$ENVFILE" | head -n1)"
  if [ -n "$PORT" ] && ! port_free "$PORT"; then PORT=""; fi
fi
if [ -z "$PORT" ]; then
  for p in 3200 3210 3220 3230 3240 3250 3260 3270 3280 3290; do
    if port_free "$p"; then PORT="$p"; break; fi
  done
fi
if [ -z "$PORT" ]; then echo "Could not find a free port between 3200 and 3290." >&2; exit 1; fi
if [ "$PORT" != 3200 ] && command -v ss >/dev/null; then
  echo "Port 3200 is taken by another program, so the app uses port $PORT. (What is on 3200:)"
  ss -ltnp 2>/dev/null | grep ':3200 ' || true
fi

cat > "$ENVFILE" <<EOF
PORT=$PORT
DATA_DIR=$DATA
EOF

cat > /etc/systemd/system/dnd-character.service <<EOF
[Unit]
Description=D&D character app
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$ENVFILE
WorkingDirectory=$APP
ExecStart=$NODE $APP/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

install -m 755 "$APP/deploy/dnd-update" /usr/local/bin/dnd-update
systemctl daemon-reload
systemctl enable dnd-character >/dev/null 2>&1
systemctl restart dnd-character

echo "Waiting for the app to start on port $PORT..."
OK=0
for i in $(seq 1 15); do
  if "$NODE" -e "fetch('http://127.0.0.1:$PORT/api/health').then(r=>r.json()).then(d=>process.exit(d&&d.ok?0:1)).catch(()=>process.exit(1))"; then OK=1; break; fi
  sleep 1
done
if [ "$OK" != 1 ]; then
  echo "The app did not start. Last lines of its log:" >&2
  journalctl -u dnd-character -n 15 --no-pager -o cat >&2
  exit 1
fi

# private https address, only for devices on your Tailscale (next to the dashboard on 443 and the dinner planner on 8443)
tailscale serve --bg --https=$HTTPS_PORT http://127.0.0.1:$PORT >/dev/null
NAME="$(tailscale status --json | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,'')))")"

echo
echo "Done. Open on your phone (Tailscale on):"
echo "  https://$NAME:$HTTPS_PORT"
echo "Update later with:  dnd-update   (inside this container)"
