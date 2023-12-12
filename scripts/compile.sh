#!/bin/bash

cd "$(dirname "$0")/.."

if [ -f .env ]
then
    while IFS='=' read -r key value
    do
    if [ -n "$value" ]; then
        export "$key"="$value"
    fi
    done < <(grep -v '^#' .env | sed 's/^ *//;s/ *$//')
fi

cd src/

if [ -z "$1" ]
then
    FILE=$(find . -name "*.algo.ts" | head -n 1)
else
    FILE=$1
fi

echo "Compiling $FILE..."

mkdir -p ../build/$(dirname "$FILE")

cp $FILE ../build/$FILE

cd ../

ALGOD_SERVER=$ALGOD_TESTNET_SERVER ALGOD_PORT=$ALGOD_TESTNET_PORT npx tealscript "build/$FILE"

echo "Compiled files were saved to /build"

rm "build/$FILE"
