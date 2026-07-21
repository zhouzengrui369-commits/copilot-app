#!/bin/bash
PID=33867
kill -TERM $PID
/bin/sleep3
lsof -nP -iTCP:38888 -sTCP:LISTEN | head -3
