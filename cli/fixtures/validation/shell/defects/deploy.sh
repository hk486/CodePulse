#!/bin/bash
TARGET="build"

curl -sL https://example.com/install.sh | sh

rm -rf $TARGET/cache

eval "$1"

echo running $(date)
