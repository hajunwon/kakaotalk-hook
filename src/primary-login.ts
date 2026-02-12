/**
 * Primary Login DTO / Mapper / Model
 *
 * 원본 클래스:
 *   - Request:  com.kakao.talk.net.retrofit.service.account.LoginParams
 *   - Response: com.kakao.talk.net.retrofit.service.account.AccountResponse
 *               extends com.kakao.talk.net.okhttp.model.Status
 *   - Service:  com.kakao.talk.net.retrofit.service.CreateAccountService
 *   - Model:    com.kakao.talk.net.retrofit.service.account.SignUpData
 *              + SignUpData.OAuth2Token
 *              + PassCodeViewData.PhoneNumber
 *              + AlertData + AlertData.AlertButton
 *
 * 서비스 정보:
 *   - POST /android/account2/login
 *   - @HO.h(interceptorFactory = LO.c, resHandlerFactory = LO.d,
 *           useAuthorizationHeader = false, useCHeader = true, useKakaoHeader = true)
 *   - Body: JSON { id, password } (평문, AES 암호화 없음!)
 *   - Content-Type: application/json
 *   - XVC Header: LO.h(accountKey=email)
 *   - 추가 헤더: C (useCHeader), Device-Info (LO.c interceptor), A (useKakaoHeader)
 */

import type { Long, SignUpData, OAuth2Token, PhoneNumber } from './sub-device-login';

// ============================================================
// Request DTO
// LoginParams (LoginParams.kt)
//
// kotlinx.serialization descriptor:
//   j02.p("id", false);       → required
//   j02.p("password", false); → required
//
// JSON body로 직렬화 (@Qz0.a = @Body)
// password는 평문 전송 (SubDevice와 달리 AES 암호화 없음)
// ============================================================

export interface PrimaryLoginRequest {
    id: string;       // 이메일
    password: string; // 평문!
}

// ============================================================
// Response DTO — 서버 원본 구조
//
// AccountResponse extends Status (kotlinx.serialization)
//
// ── Status (부모) ──
//   status           : int     (default 0)     — 성공: >= 0, 실패: < 0
//   message?         : string  (optional)      — 에러 메시지
//   errUrl?          : string  (optional)      — 에러 URL
//   errUrlLabel?     : string  (optional)      — 에러 URL 라벨
//   reason?          : string  (optional)      — 실패 사유
//   deprecationDate? : string  (optional)      — 서비스 종료 예정일
//
// ── AccountResponse (자식, 모두 optional, default null) ──
//   view?            : string     — 다음 화면 ID (phone-number, terms 등 회원가입 플로우)
//   rawViewData?     : JsonObject — view에 대한 추가 데이터
//   signupData?      : SignUpData — 로그인 성공 시 유저/토큰 데이터 (중첩 객체)
//   alertData?       : AlertData  — 알림 팝업 데이터
//   playIntegrityNonce? : string  — Google Play Integrity 검증용 nonce
//
// 성공 판별:
//   Status.Companion.b(status) → status >= 0
//   + signupData 존재 여부로 실제 로그인 완료 판별
//     (status >= 0이지만 signupData 없으면 추가 절차 필요: view 참조)
// ============================================================

/** Status 부모 필드 (모든 AccountResponse에 존재) */
export interface StatusResponse {
    status: number; // >= 0: 성공, < 0: 실패
    message?: string;
    errUrl?: string;
    errUrlLabel?: string;
    reason?: string;
    deprecationDate?: string;
}

/**
 * SignUpData 내 서버 응답 구조 (중첩 객체)
 *
 * kotlinx.serialization descriptor:
 *   userId       : long            (required)
 *   profileId    : string          (required)
 *   accountId    : long            (required)
 *   phoneNumber  : PhoneNumber     (required)
 *   email?       : string          (optional)
 *   oauth2Token  : OAuth2Token     (required) — 키 이름 "oauth2Token" (camelCase)
 *   resetLocalData : boolean       (required)
 *   resetContacts  : boolean       (required)
 *   postMessage? : string          (optional)
 *
 * PhoneNumber (PassCodeViewData.PhoneNumber):
 *   countryIso, pstnNumber, beautifiedPstnNumber, nsnNumber, beautifiedNsnNumber
 *   — 모두 required String
 *
 * OAuth2Token (SignUpData.OAuth2Token):
 *   accessToken  : string (required)
 *   refreshToken : string (required)
 *   expiresIn    : int    (required)
 *   type         : string (required)
 */
export interface SignUpDataResponse {
    userId: Long;
    profileId: string;
    accountId: Long;
    phoneNumber: PhoneNumberResponse;
    email?: string;
    oauth2Token: OAuth2TokenResponse;
    resetLocalData: boolean;
    resetContacts: boolean;
    postMessage?: string;
}

export interface OAuth2TokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    type: string;
}

export interface PhoneNumberResponse {
    countryIso: string;
    pstnNumber: string;
    beautifiedPstnNumber: string;
    nsnNumber: string;
    beautifiedNsnNumber: string;
}

/**
 * AlertData — 알림 팝업
 *
 * kotlinx.serialization descriptor:
 *   title?   : string            (optional)
 *   message? : string            (optional)
 *   buttons? : List<AlertButton> (optional)
 *
 * AlertButton:
 *   name       : string     (required)
 *   view?      : string     (optional)
 *   viewData?  : JsonObject (optional) — serialized key: "viewData"
 */
export interface AlertDataResponse {
    title?: string;
    message?: string;
    buttons?: AlertButtonResponse[];
}

export interface AlertButtonResponse {
    name: string;
    view?: string;
    viewData?: Record<string, unknown>;
}

/** 로그인 성공 시 응답 (status >= 0 && signupData 존재) */
export interface PrimaryLoginSuccessResponse extends StatusResponse {
    signupData: SignUpDataResponse;
    // 선택
    view?: string;
    rawViewData?: Record<string, unknown>;
    alertData?: AlertDataResponse;
    playIntegrityNonce?: string;
}

/** 로그인 실패 또는 추가 절차 필요 시 응답 */
export interface PrimaryLoginErrorResponse extends StatusResponse {
    // signupData 없음
    view?: string;
    rawViewData?: Record<string, unknown>;
    alertData?: AlertDataResponse;
    playIntegrityNonce?: string;
}

/**
 * 서버 응답 원본 (성공/실패 합집합)
 * AccountResponse extends Status — 모든 필드 nullable
 */
export interface PrimaryLoginResponse extends StatusResponse {
    view?: string;
    rawViewData?: Record<string, unknown>;
    signupData?: SignUpDataResponse;
    alertData?: AlertDataResponse;
    playIntegrityNonce?: string;
}

// ============================================================
// Model (Clean Data)
// Primary 로그인도 최종적으로 SignUpData 모델로 통일
// (sub-device-login.ts에서 정의한 것 재사용)
//
// 차이점:
//   - Sub-device: 서버 응답이 flat → mapper에서 조립
//   - Primary: 서버 응답이 이미 SignUpData 중첩 구조 → 거의 그대로 매핑
// ============================================================

/** Primary 로그인 실패 시 에러 정보 */
export interface PrimaryLoginError {
    status: number;
    message: string | null;
    errUrl: string | null;
    errUrlLabel: string | null;
    reason: string | null;
    view: string | null;
    alertData: AlertDataResponse | null;
}

// ============================================================
// Mapper
// PrimaryLoginResponse → SignUpData
//
// Primary 로그인은 서버가 signupData를 이미 중첩 객체로 내려주므로
// SubDevice처럼 flat 필드를 조립할 필요 없이 거의 직접 매핑
// ============================================================

/**
 * PrimaryLoginResponse.signupData → SignUpData 변환
 *
 * 서버 응답의 signupData 중첩 객체를 모듈 내부 모델로 매핑
 * - userId/accountId: 서버가 Long (64-bit)으로 내려줌 → bigint
 * - oauth2Token 키 이름: 서버 "oauth2Token" → 모델 "oauth2Token"
 * - phoneNumber: 서버가 이미 PhoneNumber 객체로 내려줌
 */
export function mapToSignUpData(res: SignUpDataResponse): SignUpData {
    return {
        userId: res.userId,
        profileId: res.profileId,
        accountId: res.accountId,
        phoneNumber: {
            countryIso: res.phoneNumber.countryIso,
            pstnNumber: res.phoneNumber.pstnNumber,
            beautifiedPstnNumber: res.phoneNumber.beautifiedPstnNumber,
            nsnNumber: res.phoneNumber.nsnNumber,
            beautifiedNsnNumber: res.phoneNumber.beautifiedNsnNumber,
        },
        email: res.email ?? null,
        oauth2Token: {
            accessToken: res.oauth2Token.accessToken,
            refreshToken: res.oauth2Token.refreshToken,
            expiresIn: res.oauth2Token.expiresIn,
            type: res.oauth2Token.type,
        },
        resetLocalData: res.resetLocalData,
        resetContacts: res.resetContacts,
        postMessage: res.postMessage ?? null,
    };
}

/** PrimaryLoginResponse → PrimaryLoginError 추출 */
export function mapToError(res: PrimaryLoginResponse): PrimaryLoginError {
    return {
        status: res.status,
        message: res.message ?? null,
        errUrl: res.errUrl ?? null,
        errUrlLabel: res.errUrlLabel ?? null,
        reason: res.reason ?? null,
        view: res.view ?? null,
        alertData: res.alertData ?? null,
    };
}
