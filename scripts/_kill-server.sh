#!/bin/bash
PID=80809
kill -TERM $PID
lsof -nP -iTCP:38888 -sTCP:LISTEN | head -5
echo "---"
ps -p $PID
