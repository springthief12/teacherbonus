@echo off
chcp 65001 > nul
title 그때 그 노래 서버
cd /d "%~dp0"

where node > nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js가 설치되어 있지 않아요.
  echo  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  처음 실행이라 필요한 파일을 내려받는 중이에요. 1~2분 걸려요.
  call npm install --omit=dev
)

node server\index.js
pause
