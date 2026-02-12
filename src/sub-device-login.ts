/**
 * Sub-Device Login DTO / Mapper / Model
 *
 * 원본 클래스:
 *   - Request:  com.kakao.talk.net.retrofit.service.subdevice.SubDeviceLoginParams
 *   - Response: com.kakao.talk.net.retrofit.service.subdevice.SubDeviceLoginResponse
 *   - Service:  com.kakao.talk.net.retrofit.service.SubDeviceLoginService
 *   - Mapper:   SubDeviceLoginResponse.f(SubDeviceLoginParams) → SignUpData
 *   - Model:    com.kakao.talk.net.retrofit.service.account.SignUpData
 *              + SignUpData.OAuth2Token
 *              + PassCodeViewData.PhoneNumber
 *
 * 서비스 정보:
 *   - POST /android/account/login.json
 *   - @HO.h(resHandlerFactory = KO.j, useAHeader = true, useAuthorizationHeader = false)
 *   - Body: form-urlencoded (SubDeviceLoginParams.D() → HashMap<String, Object>)
 *   - XVC Header: LO.h(accountKey=email) → SHA512("BARD|{UA}|DANTE|{email}|SIAN")[0:16]
 *   - password: AES-256-CBC 암호화 (C9859a("jEibeliJAhlEeyoOnjuNg").a(password))
 */

/**
 * Java Long (64-bit signed integer)
 *
 * JSON.parse는 큰 정수를 number로 파싱하면 precision loss 발생 가능.
 * 안전하게 처리하려면 JSON.parse의 reviver나 json-bigint 등으로 bigint 변환 필요.
 * 여기서는 타입만 bigint로 선언하고, 실제 파싱은 호출부에서 책임.
 */
export type Long = bigint;

// ============================================================
// Request DTO
// SubDeviceLoginParams (SubDeviceLoginParams.kt)
//
// 필드 전체 (constructor 순서 그대로):
//   email:                           String   (required, default "")
//   password:                        String   (required, default "")
//   device_uuid:                     String   (required, default V.f379518a.u())
//   device_name:                     String   (required, default V.f379518a.n() ?? model)
//   auto_login:                      Boolean? (optional, default null)
//   autowithlock:                    Boolean? (optional, default null)
//   forced:                          boolean  (default false)
//   permanent:                       boolean  (default true)
//   passcode:                        String?  (optional, default null)
//   model_name:                      String?  (optional, default null)
//   another_email_verification_uri:  String?  (optional, default null)
//
// D() 메서드 (form body 빌드):
//   B(map, key, value) → value가 null이면 put 안 함
//   password는 new C9859a("jEibeliJAhlEeyoOnjuNg").a(this.password) 로 AES 암호화
// ============================================================

export interface SubDeviceLoginRequest {
    email: string;
    password: string; // 원본 평문 — buildFormBody()에서 AES 암호화 처리
    device_uuid: string;
    device_name: string;
    auto_login?: boolean;
    autowithlock?: boolean;
    forced: boolean;
    permanent: boolean;
    passcode?: string;
    model_name?: string;
    another_email_verification_uri?: string;
}

/**
 * SubDeviceLoginParams.D() 를 재현
 *
 * null인 필드는 B() helper에 의해 map에 추가되지 않음 (서버 측에서 optional 처리)
 * password만 AES 암호화 후 삽입
 */
export function buildFormBody(
    req: SubDeviceLoginRequest,
    encryptPassword: (pw: string) => string,
): URLSearchParams {
    const params = new URLSearchParams();

    // B(map, key, value) — null이 아닌 것만 put
    const put = (key: string, value: unknown) => {
        if (value != null) {
            params.set(key, String(value));
        }
    };

    put('email', req.email);
    put('password', encryptPassword(req.password)); // AES-256-CBC
    put('device_uuid', req.device_uuid);
    put('device_name', req.device_name);
    put('auto_login', req.auto_login);
    put('autowithlock', req.autowithlock);
    put('forced', req.forced);
    put('permanent', req.permanent);
    put('passcode', req.passcode);
    put('model_name', req.model_name);
    put('another_email_verification_uri', req.another_email_verification_uri);

    return params;
}

// ============================================================
// Response DTO — 성공 시 바디
// SubDeviceLoginResponse (SubDeviceLoginResponse.kt)
//
// kotlinx.serialization 기준 19개 필드 모두 optional(default=null)
// 하지만 로그인 성공 시(access_token 존재) 서버가 실제로 내려주는 필드의
// 필수/선택 구분은 아래와 같음:
//
// 판별 근거:
//   1) SubDeviceLoginResponse.f(params) 매퍼가 null fallback을 쓰는 필드
//      → 서버가 안 줄 수도 있다는 방어 코딩 (선택)
//   2) 매퍼가 fallback 없이 직접 쓰는 필드 → 서버가 반드시 줌 (필수)
//   3) 성공 판별: access_token 존재 여부 (auth.ts에서 !res.access_token 체크)
//
// ── 성공 시 필수 (always present when access_token exists) ──
//   access_token    : string   — OAuth access token
//   refresh_token   : string   — OAuth refresh token
//   token_type      : string   — 토큰 타입 (보통 "bearer")
//   userId          : number   — 카카오 유저 ID (Long)
//   accountId       : number   — 카카오 계정 ID (Long)
//
// ── 성공 시 선택 (may or may not be present) ──
//   server_time     : number   — 서버 시간 (timestamp)
//   profileId       : string   — 프로필 ID
//   countryIso      : string   — 국가 코드 (매퍼가 fallback "" 사용)
//   sessionKey      : string   — 세션 키
//   autoLoginAccountId  : string
//   displayAccountId    : string
//   mainDeviceAgentName : string — 메인 기기 에이전트명
//   mainDeviceAppVersion: string — 메인 기기 앱 버전
//
// ── 실패 전용 (성공 시에는 없음) ──
//   loginFailedAccountToken   : string
//   title / description / button / uri : string — 에러 UI
//   anotherEmailVerificationUri : string
// ============================================================

/** 성공 시 서버 응답 바디 (access_token이 존재할 때) */
export interface SubDeviceLoginSuccessResponse {
    // ── 필수 ──
    access_token: string;
    refresh_token: string;
    token_type: string;
    userId: Long; // Java Long (64-bit)
    accountId: Long; // Java Long (64-bit)

    // ── 선택 ──
    server_time?: Long; // Java Long (64-bit)
    profileId?: string;
    countryIso?: string;
    sessionKey?: string;
    autoLoginAccountId?: string;
    displayAccountId?: string;
    mainDeviceAgentName?: string;
    mainDeviceAppVersion?: string;
}

/** 실패 시 서버 응답 바디 (access_token 없음) */
export interface SubDeviceLoginErrorResponse {
    loginFailedAccountToken?: string;
    title?: string;
    description?: string;
    button?: string;
    uri?: string;
    anotherEmailVerificationUri?: string;
}

/**
 * 서버 응답 원본 (성공/실패 합집합)
 * kotlinx.serialization 기준 19개 필드 모두 nullable
 */
export interface SubDeviceLoginResponse
    extends Partial<SubDeviceLoginSuccessResponse>,
        Partial<SubDeviceLoginErrorResponse> {}

// ============================================================
// Model (Clean Data)
// SubDeviceLoginResponse.f(params) → SignUpData 매퍼 재현
//
// 원본 코드:
//   SignUpData(
//     userId  = this.userId ?: 0L,
//     profileId = this.profileId ?: "",
//     accountId = this.accountId ?: 0L,
//     phoneNumber = PhoneNumber(countryIso ?: "", "", "", "", ""),
//     email   = params?.email,
//     oauth2Token = OAuth2Token(
//       accessToken  = this.access_token ?: "",
//       refreshToken = this.refresh_token ?: "",
//       expiresIn    = 0,
//       type         = this.token_type ?: ""
//     ),
//     resetLocalData  = false,
//     resetContacts   = false,
//     postMessage     = null
//   )
// ============================================================

/** SignUpData.OAuth2Token */
export interface OAuth2Token {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    type: string;
}

/**
 * PassCodeViewData.PhoneNumber
 *
 * 필드 5개 (모두 required String):
 *   countryIso, pstnNumber, beautifiedPstnNumber, nsnNumber, beautifiedNsnNumber
 *
 * 서브디바이스 매퍼에서는 countryIso만 채우고 나머지는 "" 고정
 */
export interface PhoneNumber {
    countryIso: string;
    pstnNumber: string;
    beautifiedPstnNumber: string;
    nsnNumber: string;
    beautifiedNsnNumber: string;
}

/**
 * SignUpData — 로그인 성공 후 모듈 내에서 사용할 clean model
 *
 * Primary(AccountResponse.signupData)와 Sub(SubDeviceLoginResponse.f()) 모두
 * 최종적으로 이 모델로 통일됨
 */
export interface SignUpData {
    userId: Long; // Java Long (64-bit)
    profileId: string;
    accountId: Long; // Java Long (64-bit)
    phoneNumber: PhoneNumber;
    email: string | null;
    oauth2Token: OAuth2Token;
    resetLocalData: boolean;
    resetContacts: boolean;
    postMessage: string | null;
}

/** 로그인 실패 시 에러 정보 (SubDeviceLoginResponse의 UI 필드) */
export interface SubDeviceLoginError {
    title: string | null;
    description: string | null;
    button: string | null;
    uri: string | null;
    anotherEmailVerificationUri: string | null;
    loginFailedAccountToken: string | null;
}

// ============================================================
// Mapper
// SubDeviceLoginResponse.f(SubDeviceLoginParams) → SignUpData
// ============================================================

/**
 * SubDeviceLoginResponse → SignUpData 변환
 *
 * 원본: SubDeviceLoginResponse.f(SubDeviceLoginParams params)
 * - access_token/refresh_token/token_type → OAuth2Token (expiresIn = 0 고정)
 * - countryIso → PhoneNumber.countryIso (나머지 "" 고정)
 * - resetLocalData = false, resetContacts = false, postMessage = null (고정)
 */
export function mapToSignUpData(
    res: SubDeviceLoginSuccessResponse,
    email: string,
): SignUpData {
    return {
        userId: res.userId,
        profileId: res.profileId ?? '',
        accountId: res.accountId,
        phoneNumber: {
            countryIso: res.countryIso ?? '',
            pstnNumber: '',
            beautifiedPstnNumber: '',
            nsnNumber: '',
            beautifiedNsnNumber: '',
        },
        email,
        oauth2Token: {
            accessToken: res.access_token,
            refreshToken: res.refresh_token,
            expiresIn: 0, // 서브디바이스 응답에 expiresIn 없음 — 원본도 0 고정
            type: res.token_type,
        },
        resetLocalData: false,
        resetContacts: false,
        postMessage: null,
    };
}

/** SubDeviceLoginResponse → SubDeviceLoginError 추출 */
export function mapToError(res: SubDeviceLoginResponse): SubDeviceLoginError {
    return {
        title: res.title ?? null,
        description: res.description ?? null,
        button: res.button ?? null,
        uri: res.uri ?? null,
        anotherEmailVerificationUri: res.anotherEmailVerificationUri ?? null,
        loginFailedAccountToken: res.loginFailedAccountToken ?? null,
    };
}
