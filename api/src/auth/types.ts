/**
 * Tipos de datos para el modulo de Identidad y Seguridad Zero Trust.
 * Responsable: Paolo Ramirez (Identidad y Seguridad Zero Trust)
 */

export type UserRole = "DONANTE" | "GESTOR" | "AUDITOR";

export type AppScope =
  | "api/projects.write"
  | "api/donations.*"
  | "api/donations.create"
  | "api/donations.read"
  | "api/audit.read";

export interface CognitoJwtPayload {
  sub: string;
  iss?: string;
  client_id?: string;
  token_use?: "access" | "id" | string;
  scope?: string;
  "cognito:groups"?: string[] | string;
  username?: string;
  "cognito:username"?: string;
  amr?: string[] | string;
  auth_time?: number;
  mfa_verified?: boolean | string;
  exp?: number;
  iat?: number;
  email?: string;
  [key: string]: unknown;
}

export interface AuthContext {
  /** Identificador unico inmutable del usuario en Cognito (UUID) */
  sub: string;
  /** Nombre de usuario o identificador preferido */
  username: string;
  /** Grupos de Cognito mapeados a roles del sistema */
  roles: UserRole[];
  /** Scopes concedidos en el Access Token */
  scopes: string[];
  /** Tipo de token recibido ("access" | "id") */
  tokenUse: string;
  /** Metodos de autenticacion reportados por Cognito (ej. ["pwd", "sw_token"]) */
  amr: string[];
  /** Indica si la sesion incluyo verificacion multifactor TOTP */
  mfaVerified: boolean;
  /** Emisor (iss) y client_id cuando estan presentes en el token */
  iss?: string;
  clientId?: string;
  /** Timestamps de emision y expiracion (epoch en segundos) */
  iat?: number;
  exp?: number;
  /** Claims completos deserializados para auditoria */
  rawClaims: CognitoJwtPayload;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  requestId: string;
}
