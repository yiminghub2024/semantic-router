# Jev Duo desktop client

Jev Duo connects Windows and macOS to System Duo, TypeSafe Jev, or a local decision service and OpenAI-compatible model pool. The interface starts in English. The sidebar language menu switches to Simplified Chinese and persists the selection.

## Build and launch

Run the commands from this directory. The client uses the existing System One and Chat Completions endpoints.

- Windows 11 x64: install x64 Node.js with built-in SQLite, then run `powershell -ExecutionPolicy Bypass -File desktop/build.ps1`. Extract the ZIP under `dist` and start `JevDuo.exe`.
- macOS 15 or newer: install Xcode Command Line Tools and run `bash macos/build.sh`. Extract the ZIP under `dist` and open Jev Duo.app. The script builds for the host architecture and verifies the checksum of its bundled Node.js runtime.

Open **Settings** to edit the decision model, generation models, endpoint URLs, input capabilities, and API keys. The Windows client uses DPAPI to protect connection profiles. The macOS client uses the login keychain.

## Conversation handling

Each successful turn is saved in a separate local SQLite archive. A text follow-up reuses previous messages and extracted answers. Binary attachments are sent to a model only on the turn that explicitly attaches them. Enable **Stream response** to read partial text and **Show routing reason** to request System Duo routing traces.

## Verification

- Run `npm ci` and `npm test` for request construction, routing, isolated history, streaming, and interruption tests.
- Run `python desktop/test_gui.py <path-to-JevDuo.exe>` on Windows with pywinauto installed. It tests both interface languages, persistence, and replies from a local HTTP fixture.
- On macOS, run `bash macos/test.sh arm64` or `bash macos/test.sh x64` after building the ZIP to test the packaged application.

The source in this directory is distributed under its included MIT license.
