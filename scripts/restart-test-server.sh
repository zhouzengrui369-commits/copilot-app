#!/bin/bash
set -e
TEST_PORT=38889
TEST_DATA_DIR=/tmp/wb-test-data
TEST_WS_DIR=/tmp/wb-test-ws
LOG_FILE=/tmp/wb-test-38889.log
SERVER_DIR=/Users/njx/openclaw_data/openclaw_workbench/apps/server

mkdir -p ${TEST_DATA_DIR} ${TEST_WS_DIR}

if lsof -nP -iTCP:${TEST_PORT} -sTCP:LISTEN > /dev/null 2>&1; then
 echo "test server already running on port ${TEST_PORT}"
 lsof -nP -iTCP:${TEST_PORT} -sTCP:LISTEN
 exit 0
fi

cd ${SERVER_DIR}

echo "starting test server on port ${TEST_PORT}..."
nohup env OPENCLAW_WORKBENCH_PORT=${TEST_PORT} OPENCLAW_WORKBENCH_NOTE_GATEWAY_AGENT=main OPENCLAW_WORKSPACE=${TEST_WS_DIR} node --experimental-sqlite dist/index.js < /dev/null > ${LOG_FILE} 2>&1 &
SERVER_PID=$!
disown
echo "PID: $SERVER_PID"
echo "log: ${LOG_FILE}"

for i in 1 2 3 4 5 6 7 8 9 10; do
 if curl -s -m2 "http://localhost:${TEST_PORT}/api/health" > /dev/null 2>&1; then
 echo "READY after ${i}s"
 echo "url: http://localhost:${TEST_PORT}"
 exit 0
 fi
 sleep 1
done

echo "ERROR: test server not ready after 10s"
echo "--- log tail ---"
tail -30 ${LOG_FILE}
exit 1
