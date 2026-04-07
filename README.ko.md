# kakaotalk-hook

> **[English](README.md)**

KakaoTalk LOCO 프로토콜 리버스 엔지니어링 기반의 Frida hooking 도구 및 TypeScript 클라이언트 라이브러리.

## 주요 기능

- **Frida Hooking** — KakaoTalk 앱의 HTTP/LOCO 통신 모니터링, 안티 디텍션 우회, 디바이스 스푸핑
- **LOCO 프로토콜 클라이언트** — TypeScript로 구현된 KakaoTalk LOCO 프로토콜 (인증, 메시징, 세션 관리)
- **ADB 디바이스 관리** — 디바이스 연결, frida-server 배포, APK/XAPK 설치 자동화

## 프로젝트 구조

```
├── index.js                # CLI 진입점 (인터랙티브 메뉴)
├── config.js               # JSON 기반 설정 로더
├── setup.js                # 인터랙티브 설정 위저드
├── adb/                    # ADB 디바이스 관리
│   ├── device-manager.js   # 디바이스 목록/선택/셸 실행
│   ├── frida-server.js     # frida-server 다운로드/배포
│   └── xapk-installer.js   # XAPK/APK 설치
├── frida/                  # Frida 스크립트
│   ├── script-manager.js   # 스크립트 로딩 및 세션 관리
│   └── scripts/
│       ├── bypass/         # 안티 디텍션, 프로세스 보호, 디바이스 스푸핑
│       └── hooks/          # HTTP/LOCO 모니터링, Activity/SharedPref 후킹
└── src/                    # TypeScript 클라이언트 라이브러리
    ├── client.ts           # KakaoClient (로그인, 메시징)
    ├── auth.ts             # HTTP 인증 (이메일/비밀번호 로그인, 기기 등록)
    ├── protocol/           # LOCO 바이너리 프로토콜 (BSON, 암호화, 패킷)
    ├── transport/          # TLS 소켓, 하트비트, 재연결
    ├── application/        # 커맨드 디스패처, 이벤트 버스, 푸시 핸들러
    ├── domain/             # 채팅 로그, 메시지 빌더, 세션 상태 관리
    └── types/              # 공통 타입 및 에러 정의
```

## 요구 사항

- Node.js 18+
- Android 디바이스 (USB 디버깅 활성화)
- ADB (Android SDK Platform-Tools)
- Rooted 디바이스 (Frida 사용 시)

## 설치

```bash
git clone https://github.com/your-username/kakaotalk-hook.git
cd kakaotalk-hook
npm install
```

## 설정

처음 실행하면 인터랙티브 설정이 자동으로 시작됩니다. 수동으로 설정하려면:

```bash
# 인터랙티브 설정
npm run setup

# 또는 직접 config.json 작성 (config.example.json 참고)
cp config.example.json config.json
```

주요 설정 (`config.json`):
- `adbPath` — ADB 실행 파일 경로 (필수)
- `deviceSerial` — 대상 디바이스 시리얼
- `scripts` — 개별 Frida 스크립트 활성화/비활성화 및 로그 레벨
- `deviceSpoof` — 디바이스 스푸핑 파라미터

## 사용법

```bash
npm start
```

인터랙티브 메뉴에서 다음 작업을 수행할 수 있습니다:
1. 연결된 디바이스 목록 확인
2. APK/XAPK 설치
3. frida-server 배포
4. KakaoTalk 후킹 시작 (spawn/attach)
5. frida-server 중지
6. 설정 변경

## 면책 조항

이 프로젝트는 교육 및 연구 목적으로만 사용해야 합니다. KakaoTalk 서비스 약관을 위반하는 용도로 사용하지 마세요.
