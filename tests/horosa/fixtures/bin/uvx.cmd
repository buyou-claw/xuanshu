@echo off
rem tests/horosa/fixtures/bin/uvx.cmd - the Windows batch form of the fake uvx.
rem
rem KEEP THIS FILE PURE ASCII. Do not add Chinese/CJK text, not even in comments.
rem Why: cmd.exe reads .cmd files with the OEM codepage (cp936 on the Chinese
rem Windows here), while this file is saved as UTF-8 without BOM. Multi-byte
rem characters get split into bytes that the command parser treats as command
rem separators, so a "rem" line with CJK text can be executed as commands and the
rem fake uvx never starts (symptom: waitMcpReady times out). Diagnosed 2026-10-13
rem by docs-verifier (T4) after a flake in P0; see tests/horosa/README.md.
rem
rem Why this file exists: XUANSHU_UVX_BIN may point at three Windows shapes --
rem   1) <abs>\uvx.mjs  (node runs it directly, the ticket-05 convention)
rem   2) <abs>\uvx.cmd  (this file: the most common PATHEXT shape; Node must go
rem      through cmd.exe because spawning a .cmd directly fails with EINVAL)
rem   3) the bare name "uvx" (PATH hits shape 2, same as production uvx)
rem All three must be dispatched correctly by the implementation under test.
setlocal
node "%~dp0uvx.mjs" %*
exit /b %ERRORLEVEL%
