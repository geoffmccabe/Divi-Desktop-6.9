#!/bin/sh
# Put the payout service on the London node and start its timer.
#   sh contrib/rebels-room/payout/install.sh
# The secret file is copied from ~/.rebels-payout.env, which holds
# REBELS_PAYOUT_SECRET (the same one the worker has) and REBELS_ROOM_URL.
set -e
HOST=root@109.228.38.104
HERE=$(cd "$(dirname "$0")" && pwd)
scp -q "$HERE/divi-rebels-payout.py" "$HOST:/usr/local/bin/divi-rebels-payout.py"
scp -q "$HERE/divi-rebels-payout.service" "$HERE/divi-rebels-payout.timer" "$HOST:/etc/systemd/system/"
scp -q "$HOME/.rebels-payout.env" "$HOST:/etc/divi-rebels-payout.env"
ssh "$HOST" 'chmod 755 /usr/local/bin/divi-rebels-payout.py; chmod 600 /etc/divi-rebels-payout.env;
  systemctl daemon-reload; systemctl enable --now divi-rebels-payout.timer;
  echo "--- dry run ---"; set -a; . /etc/divi-scan.env; . /etc/divi-rebels-payout.env; set +a;
  python3 /usr/local/bin/divi-rebels-payout.py --dry-run;
  echo "--- timer ---"; systemctl list-timers divi-rebels-payout.timer --no-pager | head -3'
