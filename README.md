# kakaotalk-hook

> **[한국어 문서](README.ko.md)**

Frida hooking toolkit and TypeScript client library for KakaoTalk, based on reverse-engineered LOCO protocol.

## Features

- **Frida Hooking** — Monitor HTTP/LOCO traffic, bypass anti-detection, spoof device properties
- **LOCO Protocol Client** — TypeScript implementation of KakaoTalk's LOCO protocol (auth, messaging, session management)
- **ADB Device Management** — Automated device connection, frida-server deployment, APK/XAPK/split APK installation

## Project Structure

```
├── index.js                # CLI entry point (interactive menu)
├── config.js               # JSON-based config loader
├── setup.js                # Interactive config wizard
├── adb/                    # ADB device management
│   ├── device-manager.js   # Device listing / selection / shell
│   ├── frida-server.js     # frida-server download & deployment
│   └── xapk-installer.js   # XAPK/APK/split APK installation
├── frida/                  # Frida scripts
│   ├── script-manager.js   # Script loading & session management
│   └── scripts/
│       ├── bypass/         # Anti-detection, process protection, device spoofing
│       └── hooks/          # HTTP/LOCO monitoring, Activity/SharedPref hooks
└── src/                    # TypeScript client library
    ├── client.ts           # KakaoClient (login, messaging)
    ├── auth.ts             # HTTP auth (email/password login, device registration)
    ├── protocol/           # LOCO binary protocol (BSON, encryption, packets)
    ├── transport/          # TLS socket, heartbeat, reconnection
    ├── application/        # Command dispatcher, event bus, push handler
    ├── domain/             # Chat log, message builder, session state
    └── types/              # Shared types & error definitions
```

## Prerequisites

- Node.js 18+
- Android device (USB debugging enabled)
- ADB (Android SDK Platform-Tools)
- Rooted device (for Frida)

## Installation

```bash
git clone https://github.com/your-username/kakaotalk-hook.git
cd kakaotalk-hook
npm install
```

## Configuration

An interactive setup wizard runs automatically on first launch. To configure manually:

```bash
# Interactive setup
npm run setup

# Or copy the example and edit directly
cp config.example.json config.json
```

Key settings (`config.json`):
- `adbPath` — Path to ADB executable (required)
- `deviceSerial` — Target device serial
- `scripts` — Enable/disable individual Frida scripts and set log levels
- `deviceSpoof` — Device spoofing parameters

## Usage

```bash
npm start
```

The interactive menu provides the following options:
1. List connected devices
2. Install APK / XAPK / split APK (single `.apk`, `.xapk`/`.apks` bundle, or a directory containing `base.apk` + `split_config.*.apk`)
3. Deploy frida-server
4. Start hooking (spawn/attach)
5. Stop frida-server
6. Change settings

## Disclaimer

This project is intended for educational and research purposes only. Do not use it in ways that violate KakaoTalk's terms of service.
