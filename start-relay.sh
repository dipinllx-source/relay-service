#!/bin/bash
cd /opt/relay-service
pkill -9 -f 'node src/app.js' 2>/dev/null
sleep 2
setsid nohup node src/app.js > /opt/relay-service/logs/stdout.log 2>&1 < /dev/null &
