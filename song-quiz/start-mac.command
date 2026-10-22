#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js가 설치되어 있지 않아요."
  echo "  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  echo ""
  read -n 1 -s -r -p "아무 키나 누르면 닫혀요"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  처음 실행이라 필요한 파일을 내려받는 중이에요. 1~2분 걸려요."
  npm install --omit=dev
fi

node server/index.js
