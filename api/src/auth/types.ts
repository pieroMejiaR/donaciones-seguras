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
  "cognito:groups"?: string[];
  username?: string;
  "cognito:username"?: string;
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
  /** Claims completos deserializados para auditoria */
  rawClaims: CognitoJwtPayload;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  requestId: string;
}
