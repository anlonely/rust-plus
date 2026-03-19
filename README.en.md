# Rust Toolbox / Rust 工具箱

[中文](./README.md) | [English](./README.en.md)

Rust Toolbox is a management system built around **Rust+**, with three product surfaces:

- `Public Web Edition`: deploy on a cloud server, support multiple registered users, each binding their own Steam / Rust+ account and managing their own Rust servers
- `macOS Desktop Edition`: personal local deployment with direct Steam / Rust+ login
- `Windows Desktop Edition`: personal local deployment with direct Steam / Rust+ login

## 1. Product Boundaries

### Public Web Edition

- Designed for cloud deployment
- Protected by outer email login
- Each user owns an isolated workspace
- Default workspace path: `config/web-users/<userId>/`
- Isolated files:
  - `servers.json`
  - `devices.json`
  - `rules.json`
  - `rustplus.config.json`

### macOS / Windows Desktop Editions

- Designed for local personal use
- No outer email account layer
- Direct Steam / Rust+ login
- Single-user local configuration model

Reference:

- [Product Boundaries](/Users/bing/Documents/openai-codex/rust-plus/docs/PRODUCT-BOUNDARIES.md)

## 2. Core Capabilities

- Steam / Rust+ login and recovery
- Web Steam Remote Login with hidden task tokens and local Chrome bridge callback
- Server pairing and device binding
- Team chat commands
- Team chat history sync and optimistic Web echo
- Event automation and system presets
- Vending machine search and map rendering
- Alerts for new vending machines and new stock
- CCTV code lookup
- Team chat rate limiting
- Call group integrations
  - Team chat
  - Phone
  - KOOK
  - Discord
- Web admin backend
  - User CRUD
  - Enable / disable
  - Steam binding summary
  - Global phone-call switch

## 3. Quick Start

### Install dependencies

```bash
npm install
```

### Start desktop edition

macOS:

```bash
bash start_gui.sh
```

Windows:

```bat
start_gui.bat
```

### Start Web edition

```bash
bash start_web.sh
```

Default address:

- `http://127.0.0.1:3080`

Deployment guide:

- [Web Deployment Guide](/Users/bing/Documents/openai-codex/rust-plus/platforms/web/README.md)

## 4. Web Login Flow

When the Web edition runs on a headless cloud server, Steam login is bridged through a local Chrome extension. Users no longer need to type a visible session code:

1. The user signs in to the Web account
2. The Web UI creates a one-time remote login task for that account
3. The user installs the task-specific local Chrome extension package
4. The extension opens the Rust+ login page automatically
5. The extension captures `rustplus_auth_token`
6. It sends the token back through `/steam-bridge/callback` / `/steam-bridge/complete`
7. The server writes it into that user's own `rustplus.config.json`
8. The server continues pairing and runtime status sync

Notes:

- The team chat page actively fetches history and echoes Web-sent messages immediately
- Vending events now notify both new vendors and newly listed items
- Long team chat messages are split automatically while still respecting the send interval

Relevant files:

- [Chrome Extension](/Users/bing/Documents/openai-codex/rust-plus/platforms/chrome-rustplus-bridge)
- [Bridge Tutorial](/Users/bing/Documents/openai-codex/rust-plus/docs/static/tutorial-steam-bridge.html)

## 5. Project Structure

```text
rust-plus/
├── src/
│   ├── ai/
│   ├── auth/
│   ├── call/
│   ├── commands/
│   ├── connection/
│   ├── events/
│   ├── map/
│   ├── notify/
│   ├── pairing/
│   ├── presets/
│   ├── steam/
│   ├── storage/
│   ├── tools/
│   ├── translate/
│   ├── utils/
│   └── index.js
├── electron/                   # macOS / Windows desktop app
├── web/                        # Web server and Web UI
├── platforms/                  # deployment and packaging scripts
├── docs/                       # project docs
├── assets/                     # static assets
├── config/                     # runtime config
└── test/                       # automated tests
```

See also:

- [Architecture](/Users/bing/Documents/openai-codex/rust-plus/docs/ARCHITECTURE.md)
- [Docs Index](/Users/bing/Documents/openai-codex/rust-plus/docs/README.md)

## 6. Key Documents

- [Docs Index](/Users/bing/Documents/openai-codex/rust-plus/docs/README.md)
- [Help](/Users/bing/Documents/openai-codex/rust-plus/docs/HELP.md)
- [Development](/Users/bing/Documents/openai-codex/rust-plus/docs/DEVELOPMENT.md)
- [Map Module](/Users/bing/Documents/openai-codex/rust-plus/docs/MAP_MODULE.md)
- [HTTP / WebSocket API](/Users/bing/Documents/openai-codex/rust-plus/docs/API.md)

## 7. Development and Verification

Development:

```bash
npm run dev
```

Tests:

```bash
npm test
```

Desktop builds:

```bash
npm run build:mac
npm run build:win
```

## 8. Security Notes

These are runtime or sensitive files and should never be committed:

- `.env`
- `config/auth-users.json`
- `config/root-admin-credentials.txt`
- `config/rustplus.config.json`
- `config/web-users/*`
- `logs/*`
