import crypto from 'crypto';
import type {
    SubDeviceLoginRequest,
    SubDeviceLoginResponse,
    SubDeviceLoginSuccessResponse,
    SignUpData,
    SubDeviceLoginError,
} from './sub-device-login';
import { buildFormBody, mapToSignUpData, mapToError } from './sub-device-login';
import type {
    PrimaryLoginRequest,
    PrimaryLoginResponse,
    PrimaryLoginError,
} from './primary-login';
import {
    mapToSignUpData as mapPrimaryToSignUpData,
    mapToError as mapPrimaryToError,
} from './primary-login';

// ============================================================
// Constants
// ============================================================

const SALT = 'dkljleskljfeisflssljeif';
const PASSWORD_KEY = 'jEibeliJAhlEeyoOnjuNg';

/** 서브 디바이스 로그인: /android/account/ */
const SUB_DEVICE_BASE_URL = 'https://katalk.kakao.com/android/account';
/** 메인 디바이스(첫 등록) 로그인: /android/account2/ */
const PRIMARY_BASE_URL = 'https://katalk.kakao.com/android/account2';
/** 패스코드 기기등록: /android/account/passcodeLogin/ (ke.C33295c PassCodeNetwork.kt 참조) */
const PASSCODE_BASE_URL = 'https://katalk.kakao.com/android/account/passcodeLogin';

const APP_VERSION = '26.1.3';
const OS_VERSION = '14';
const LANGUAGE = 'ko';

// ============================================================
// Crypto / Device ID
// ============================================================

function createDeviceUUID(): string {
    const raw = `${crypto.randomUUID()}-${Date.now()}`;
    return crypto.createHash('sha256').update(`${SALT} ${raw}`).digest('hex');
}

function hashAndroidId(androidId: string): string {
    return crypto.createHash('sha1').update(`${SALT} ${androidId}`).digest('hex');
}

function encryptPassword(password: string): string {
    const keyBytes = Buffer.alloc(32);
    const raw = Buffer.from(PASSWORD_KEY, 'utf8');
    raw.copy(keyBytes, 0, 0, Math.min(raw.length, 32));
    const iv = Buffer.from(PASSWORD_KEY.substring(0, 16), 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBytes, iv);
    return Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]).toString('base64');
}

function buildUserAgent(): string {
    return `KT/${APP_VERSION} An/${OS_VERSION} ${LANGUAGE}`;
}

function generateXVCKey(key: string): string {
    const ua = buildUserAgent();
    return crypto.createHash('sha512').update(`BARD|${ua}|DANTE|${key}|SIAN`).digest('hex').substring(0, 16);
}

function buildDeviceInfoHeader(duuid: string, ssaid: string, model: string): string {
    return `android/${OS_VERSION}; uuid=${duuid}; ssaid=${ssaid}; model=${model}; screen_resolution=1080x2340; sim=/0/0; e=; uvc3=`;
}

function createDeviceConfig(androidId?: string) {
    const duuid = createDeviceUUID();
    const adid = crypto.randomUUID();
    const ssaid = hashAndroidId(androidId ?? crypto.randomBytes(8).toString('hex'));
    const model = 'Pixel 7';
    return { duuid, adid, ssaid, model, userAgent: buildUserAgent() };
}

// ============================================================
// HTTP
// ============================================================

async function request(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
): Promise<{ status: number; data: any }> {
    const isJson = typeof body === 'object' && !(body instanceof URLSearchParams);
    const res = await fetch(url, {
        method,
        headers: {
            ...headers,
            ...(isJson ? { 'Content-Type': 'application/json' } : {}),
            ...(body instanceof URLSearchParams ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: body ? (isJson ? JSON.stringify(body) : body.toString()) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

// ============================================================
// 공통 헤더 빌더
// ============================================================

/** A 헤더 (useAHeader) - SubDeviceLoginService에서 사용 */
function buildAHeader(): string {
    return `android/${APP_VERSION}/${LANGUAGE}`;
}

/** 서브 디바이스용 공통 헤더 (A + XVC + UA) */
function buildSubDeviceHeaders(xvcKey: string) {
    return {
        'User-Agent': buildUserAgent(),
        'A': buildAHeader(),
        'X-VC': generateXVCKey(xvcKey),
    };
}

/**
 * 메인 디바이스(primary)용 공통 헤더
 * CreateAccountService: interceptorFactory=LO.c → Device-Info, SS 헤더 추가
 * useCHeader=true, useKakaoHeader=true, useAuthorizationHeader=false
 */
function buildPrimaryHeaders(xvcKey: string, duuid: string, ssaid: string, model: string) {
    return {
        'User-Agent': buildUserAgent(),
        'Content-Type': 'application/json',
        'X-VC': generateXVCKey(xvcKey),
        // C 헤더 (useCHeader) - 클라이언트 정보
        'C': `${APP_VERSION}/${OS_VERSION}/${LANGUAGE}`,
        // Device-Info 헤더 (LO.c interceptor가 추가)
        'Device-Info': buildDeviceInfoHeader(duuid, ssaid, model),
        // KakaoHeader
        'A': buildAHeader(),
    };
}

// ============================================================
// 1. 메인 디바이스(Primary) 로그인
//    POST https://katalk.kakao.com/android/account2/login
//
//    CreateAccountService.a(xvcHeader, LoginParams)
//    - interceptorFactory = LO.c (Device-Info + SS 헤더)
//    - useCHeader = true, useKakaoHeader = true
//    - Body: JSON { id: string, password: string }
//    - password는 평문 (AES 암호화 안함!)
//
//    AccountResponse extends Status:
//      Status: { status, message?, errUrl?, errUrlLabel?, reason?, deprecationDate? }
//      AccountResponse: { view?, rawViewData?, signupData?, alertData?, playIntegrityNonce? }
//      SignUpData: { userId, profileId, accountId, phoneNumber, email?,
//                    oauth2Token: { accessToken, refreshToken, expiresIn, type },
//                    resetLocalData, resetContacts, postMessage? }
// ============================================================

/**
 * 메인 디바이스 로그인 (primary / 첫 기기 등록)
 *
 * - /android/account2/login (POST, JSON)
 * - LoginParams의 password는 서버로 평문 전송 (AES 암호화 안 함)
 *   (CreateAccountService는 LoginParams를 @Body로 직접 직렬화)
 * - Device-Info 헤더 필요 (LO.c interceptor)
 *
 * 성공 시 AccountResponse.signupData에서 SignUpData 추출
 */
async function loginPrimary(
    email: string,
    password: string,
    duuid: string,
    ssaid: string,
    model: string,
): Promise<
    | { success: true; signUpData: SignUpData; raw: PrimaryLoginResponse }
    | { success: false; error: PrimaryLoginError; raw: PrimaryLoginResponse }
> {
    const headers = buildPrimaryHeaders(email, duuid, ssaid, model);

    // --- Request DTO 조립 (LoginParams) ---
    const req: PrimaryLoginRequest = { id: email, password };

    // --- HTTP 요청 ---
    const { data } = await request('POST', `${PRIMARY_BASE_URL}/login`, headers, req);

    const res = (data ?? { status: -1 }) as PrimaryLoginResponse;

    // --- Response 분기 + Mapper ---
    // 실패: status < 0 또는 signupData 없음 (추가 절차 필요)
    if (res.status < 0 || !res.signupData) {
        return { success: false, error: mapPrimaryToError(res), raw: res };
    }

    // signupData 존재 → 성공 응답으로 확정
    return { success: true, signUpData: mapPrimaryToSignUpData(res.signupData), raw: res };
}

// ============================================================
// 2. 서브 디바이스 로그인
//    POST https://katalk.kakao.com/android/account/login.json
//
//    SubDeviceLoginService.a(xvcHeader, params)
//    - useAHeader = true, useAuthorizationHeader = false
//    - Body: form-urlencoded (SubDeviceLoginParams.D()가 HashMap 빌드)
//    - password는 AES-256-CBC 암호화!
//
//    SubDeviceLoginResponse:
//      { server_time, userId, profileId, countryIso, accountId, sessionKey,
//        access_token, refresh_token, token_type,
//        loginFailedAccountToken?, autoLoginAccountId?, displayAccountId?,
//        title?, description?, button?, uri?,
//        anotherEmailVerificationUri?,
//        mainDeviceAgentName?, mainDeviceAppVersion? }
// ============================================================

/**
 * 서브 디바이스 로그인 (보조기기)
 *
 * - POST /android/account/login.json (form-urlencoded)
 * - SubDeviceLoginService.a(xvcHeader, params.D())
 *   @HO.h(resHandlerFactory=KO.j, useAHeader=true, useAuthorizationHeader=false)
 * - password: AES-256-CBC 암호화 (SubDeviceLoginParams.D() 내부에서 처리)
 * - 기기등록(PassCode) 완료 후 호출
 *
 * 성공 시 SubDeviceLoginResponse.f(params) → SignUpData 매핑
 */
async function loginSubDevice(
    email: string,
    password: string,
    duuid: string,
    deviceName: string,
    modelName: string,
    options?: {
        passcode?: string;
        forced?: boolean;
        permanent?: boolean;
        autoLogin?: boolean;
    },
): Promise<
    | { success: true; signUpData: SignUpData; raw: SubDeviceLoginResponse }
    | { success: false; error: SubDeviceLoginError; raw: SubDeviceLoginResponse }
> {
    // --- Request DTO 조립 (SubDeviceLoginParams) ---
    const req: SubDeviceLoginRequest = {
        email,
        password,
        device_uuid: duuid,
        device_name: deviceName,
        forced: options?.forced ?? true,
        permanent: options?.permanent ?? true,
        auto_login: options?.autoLogin,
        autowithlock: true,
        passcode: options?.passcode,
        model_name: modelName,
    };

    // --- SubDeviceLoginParams.D() → form body ---
    const formBody = buildFormBody(req, encryptPassword);

    // --- HTTP 요청 ---
    const headers = buildSubDeviceHeaders(email);
    const { data } = await request(
        'POST',
        `${SUB_DEVICE_BASE_URL}/login.json`,
        headers,
        formBody,
    );

    const res = (data ?? {}) as SubDeviceLoginResponse;

    // --- Response 분기 + Mapper ---
    if (!res.access_token) {
        return { success: false, error: mapToError(res), raw: res };
    }

    // access_token 존재 → 성공 응답으로 확정
    const successRes = res as SubDeviceLoginSuccessResponse;

    // SubDeviceLoginResponse.f(params) → SignUpData
    return { success: true, signUpData: mapToSignUpData(successRes, email), raw: res };
}

// ============================================================
// 3. 통합 login 함수 (primary + sub 분기)
// ============================================================

/**
 * 통합 로그인 함수
 *
 * @param mode
 *   - 'primary': 메인 디바이스 (첫 등록, /android/account2/login)
 *     → JSON body, password 평문, Device-Info 헤더 필요
 *     → AccountResponse.signupData.oauth2Token에서 토큰 추출
 *
 *   - 'sub': 서브 디바이스 (보조기기, /android/account/login.json)
 *     → form-urlencoded body, password AES 암호화
 *     → SubDeviceLoginResponse에서 직접 access_token 추출
 *     → 사전에 PassCode 기기등록 완료 필요
 *
 * 두 경우 모두 최종 accessToken은 LOCO LOGINLIST의 oauthToken으로 사용
 */
async function login(
    mode: 'primary' | 'sub',
    email: string,
    password: string,
    device: { duuid: string; ssaid: string; model: string },
    subOptions?: {
        passcode?: string;
        forced?: boolean;
        permanent?: boolean;
        autoLogin?: boolean;
    },
) {
    if (mode === 'primary') {
        // ── 메인 디바이스 로그인 ──
        // CreateAccountService → POST /android/account2/login
        // LoginParams { id, password } (JSON, 평문)
        const result = await loginPrimary(email, password, device.duuid, device.ssaid, device.model);

        if (!result.success) {
            return {
                success: false as const,
                mode: 'primary' as const,
                error: result.error,
            };
        }

        return {
            success: true as const,
            mode: 'primary' as const,
            // SignUpData (AccountResponse.signupData 매핑 결과)
            signUpData: result.signUpData,
            // LOCO LOGINLIST에 사용할 토큰 (편의 접근)
            accessToken: result.signUpData.oauth2Token.accessToken,
            refreshToken: result.signUpData.oauth2Token.refreshToken,
        };
    }

    // ── 서브 디바이스 로그인 ──
    // SubDeviceLoginService → POST /android/account/login.json
    // SubDeviceLoginParams.D() { email, password(AES), device_uuid, ... } (form-urlencoded)
    const result = await loginSubDevice(
        email,
        password,
        device.duuid,
        device.model,  // device_name
        device.model,  // model_name
        subOptions,
    );

    if (!result.success) {
        return {
            success: false as const,
            mode: 'sub' as const,
            error: result.error,
        };
    }

    return {
        success: true as const,
        mode: 'sub' as const,
        // SignUpData (SubDeviceLoginResponse.f(params) 매핑 결과)
        signUpData: result.signUpData,
        // LOCO LOGINLIST에 사용할 토큰 (편의 접근)
        accessToken: result.signUpData.oauth2Token.accessToken,
        refreshToken: result.signUpData.oauth2Token.refreshToken,
    };
}

// ============================================================
// PassCode 기기등록 (서브 디바이스 전용)
// ============================================================

/**
 * passcodeLogin/generate - 패스코드 생성 요청
 * GeneratePassCodeRequest: { email, password(AES), permanent?, device: { name, uuid, model?, osVersion } }
 * GeneratePassCodeResponse: BasePassCodeResponse + { passcode?, remainingSeconds }
 */
async function generatePassCode(email: string, password: string, duuid: string, model: string) {
    const { status, data } = await request('POST', `${PASSCODE_BASE_URL}/generate`, {
        ...buildSubDeviceHeaders(email),
        'Content-Type': 'application/json',
    }, {
        email,
        password: encryptPassword(password),
        device: { name: model, uuid: duuid, model, osVersion: OS_VERSION },
        permanent: true,
    });

    return {
        status: data?.status as number,
        message: data?.message as string | null,
        passcode: data?.passcode as string | null,
        remainingSeconds: data?.remainingSeconds as number | null,
        httpStatus: status,
    };
}

/**
 * passcodeLogin/registerDevice - 메인 기기 승인 대기 (1회 호출)
 * PassCodeLoginRequest: { email, password(AES), device: { uuid } }
 * RegisterDeviceResponse: BasePassCodeResponse + { nextRequestIntervalInSeconds?, remainingSeconds? }
 */
async function registerDevice(email: string, password: string, duuid: string) {
    const { status, data } = await request('POST', `${PASSCODE_BASE_URL}/registerDevice`, {
        ...buildSubDeviceHeaders(email),
        'Content-Type': 'application/json',
    }, {
        email,
        password: encryptPassword(password),
        device: { uuid: duuid },
    });

    return {
        status: data?.status as number,
        message: data?.message as string | null,
        nextRequestIntervalInSeconds: data?.nextRequestIntervalInSeconds as number | null,
        remainingSeconds: data?.remainingSeconds as number | null,
        httpStatus: status,
    };
}

/**
 * passcodeLogin/authorize - 패스코드 직접 입력 인증
 * AuthorizeRequest: { token?, passcode, forced? }
 * AuthorizeResponse: BasePassCodeResponse + { pcDevice?, deviceInfo? }
 */
async function authorizePassCode(token: string | null, passCode: string, forced?: boolean) {
    const body: Record<string, unknown> = { passcode: passCode };
    if (token) body.token = token;
    if (forced != null) body.forced = forced;

    const { status, data } = await request('POST', `${PASSCODE_BASE_URL}/authorize`, {
        'A': buildAHeader(),
        'X-VC': generateXVCKey(passCode),
        'Content-Type': 'application/json',
    }, body);

    return {
        status: data?.status as number,
        message: data?.message as string | null,
        pcDevice: data?.pcDevice as boolean | null,
        deviceInfo: data?.deviceInfo as { name?: string; uuid?: string; os?: string; model?: string } | null,
        httpStatus: status,
    };
}

/** passcodeLogin/cancel */
async function cancelPassCode(email: string, password: string, duuid: string) {
    const { data } = await request('POST', `${PASSCODE_BASE_URL}/cancel`, {
        ...buildSubDeviceHeaders(email),
        'Content-Type': 'application/json',
    }, {
        email,
        password: encryptPassword(password),
        device: { uuid: duuid },
    });

    return { status: data?.status as number, message: data?.message as string | null };
}

/** passcodeLogin/info (GET) */
async function getPassCodeInfo(token: string) {
    const { data } = await request('GET', `${PASSCODE_BASE_URL}/info?token=${encodeURIComponent(token)}`, {
        'A': buildAHeader(),
        'Authorization': token,
    });

    return { status: data?.status as number, message: data?.message as string | null };
}

/** registerDevice 폴링 래퍼 */
async function pollRegisterDevice(email: string, password: string, duuid: string, timeoutMs = 180_000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const result = await registerDevice(email, password, duuid);
        if (result.status === 0) return { success: true, ...result };
        const waitSec = result.nextRequestIntervalInSeconds ?? 5;
        await new Promise(r => setTimeout(r, waitSec * 1000));
    }
    return { success: false, status: -1, message: 'Polling timed out' };
}

// ============================================================
// 통합 플로우
// ============================================================

/**
 * 전체 서브디바이스 등록 + 로그인 플로우:
 * 1. createDeviceConfig → 디바이스 ID 생성
 * 2. generatePassCode → 메인 기기에 패스코드 요청
 * 3. pollRegisterDevice → 메인 기기 승인 폴링
 * 4. login('sub') → access_token 획득
 */
async function registerAndLoginSubDevice(email: string, password: string, androidId?: string) {
    const device = createDeviceConfig(androidId);
    console.log('[1/4] Device config:', { duuid: device.duuid });

    const gen = await generatePassCode(email, password, device.duuid, device.model);
    if (gen.status !== 0) throw new Error(`PassCode generate failed: ${gen.message} (${gen.status})`);
    console.log(`[2/4] PassCode 생성 완료 (남은시간: ${gen.remainingSeconds}초)`);

    console.log('[3/4] 메인 기기 승인 대기...');
    const reg = await pollRegisterDevice(email, password, device.duuid);
    if (!reg.success) throw new Error(`Registration failed: ${reg.message}`);
    console.log('[3/4] 기기 등록 완료');

    const result = await login('sub', email, password, device, { permanent: true, forced: true });
    if (!result.success) throw new Error(`Login failed: ${JSON.stringify(result)}`);
    console.log('[4/4] 서브 디바이스 로그인 성공');

    return { device, ...result };
}

/**
 * 메인(Primary) 디바이스 로그인 플로우:
 * 1. createDeviceConfig → 디바이스 ID 생성
 * 2. login('primary') → 바로 로그인
 *
 * 주의: 이미 등록된 계정이면 signupData 반환,
 *       신규면 view='phone-number' 등 회원가입 플로우 진입
 */
async function loginPrimaryDevice(email: string, password: string, androidId?: string) {
    const device = createDeviceConfig(androidId);
    console.log('[1/2] Device config:', { duuid: device.duuid });

    const result = await login('primary', email, password, device);
    if (!result.success) {
        console.error('[2/2] 로그인 실패:', result);
        return { device, ...result };
    }
    console.log('[2/2] 메인 디바이스 로그인 성공');

    return { device, ...result };
}

// ============================================================
// Exports
// ============================================================

export {
    // crypto / device
    createDeviceUUID,
    hashAndroidId,
    encryptPassword,
    buildUserAgent,
    generateXVCKey,
    buildDeviceInfoHeader,
    createDeviceConfig,
    // login
    login,
    loginPrimary,
    loginSubDevice,
    // passcode
    generatePassCode,
    registerDevice,
    pollRegisterDevice,
    authorizePassCode,
    cancelPassCode,
    getPassCodeInfo,
    // 통합 플로우
    registerAndLoginSubDevice,
    loginPrimaryDevice,
};

// Sub-device DTO re-exports
export type {
    Long,
    SubDeviceLoginRequest,
    SubDeviceLoginResponse,
    SubDeviceLoginSuccessResponse,
    SubDeviceLoginErrorResponse,
    SubDeviceLoginError,
    SignUpData,
    OAuth2Token,
    PhoneNumber,
} from './sub-device-login';
export { buildFormBody, mapToSignUpData, mapToError } from './sub-device-login';

// Primary DTO re-exports
export type {
    PrimaryLoginRequest,
    PrimaryLoginResponse,
    PrimaryLoginSuccessResponse,
    PrimaryLoginErrorResponse,
    PrimaryLoginError,
    StatusResponse,
    SignUpDataResponse,
    OAuth2TokenResponse,
    PhoneNumberResponse,
    AlertDataResponse,
    AlertButtonResponse,
} from './primary-login';
export {
    mapToSignUpData as mapPrimaryToSignUpData,
    mapToError as mapPrimaryToError,
} from './primary-login';
