/**
 * Sesión de la aplicación: quién está dentro y cuándo hay que pedir acceso.
 *
 * Aquí no se decide nada sobre permisos —eso lo hace el backend con la lista de
 * correos autorizados (`apps-script/Code.gs`)—: esto sólo guarda la sesión que
 * devolvió el servidor, decide si sigue siendo utilizable y cuándo la
 * aplicación tiene que enseñar la pantalla de acceso.
 *
 * Esa última decisión vive en `loginRequired()`, y es deliberadamente explícita
 * porque una puerta que se cierra sola cuando no debe deja a alguien fuera de
 * sus propias partituras.
 */

import { BUILD_ENDPOINT, DriveError, login, whoami, type DriveConfig } from "./drive";

export interface AuthState {
  /** URL de la implementación; los ajustes pueden cambiarla. */
  endpoint: string;
  /** Sesión firmada; vacía si no se ha entrado. */
  token: string;
  /** Correo de quien ha entrado. */
  email: string;
  /** Caducidad de la sesión, en milisegundos (0 si no hay sesión). */
  expiresAt: number;
}

export const EMPTY_AUTH: AuthState = {
  endpoint: BUILD_ENDPOINT,
  token: "",
  email: "",
  expiresAt: 0,
};

export const AUTH_STORAGE_KEY = "ps:auth";
/** Clave que usaba la versión sin login: sólo se lee para no perder la URL. */
const LEGACY_KEY = "ps:drive";

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */

export function loadAuth(): AuthState {
  if (typeof window === "undefined") return EMPTY_AUTH;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AuthState>;
      return {
        // La URL fijada al construir manda sobre lo guardado: si se republica
        // el sitio apuntando a otro backend, lo viejo no debe ganar.
        endpoint:
          typeof parsed.endpoint === "string" && parsed.endpoint
            ? parsed.endpoint
            : BUILD_ENDPOINT,
        token: typeof parsed.token === "string" ? parsed.token : "",
        email: typeof parsed.email === "string" ? parsed.email : "",
        expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
      };
    }
    // Sin datos nuevos, se reaprovecha la URL de la versión anterior (que no
    // tenía login). Su clave compartida se descarta a propósito: con login, la
    // aplicación no maneja ninguna llave del servidor.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { endpoint?: string };
      if (parsed.endpoint) return { ...EMPTY_AUTH, endpoint: parsed.endpoint };
    }
  } catch {
    /* almacenamiento inaccesible o datos rotos: se empieza de cero */
  }
  return EMPTY_AUTH;
}

export function saveAuth(auth: AuthState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // Modo privado o almacenamiento lleno: la sesión dura lo que la pestaña.
  }
}

/* ------------------------------------------------------------------ */
/* ¿Sirve la sesión?                                                   */
/* ------------------------------------------------------------------ */

/**
 * ¿Hay una sesión que se pueda usar ahora mismo?
 *
 * Se comprueba la caducidad con el reloj local, que no es de fiar para
 * seguridad pero sí para no enseñar la aplicación cuando ya se sabe que la
 * sesión está muerta. La comprobación de verdad la hace el servidor en la
 * primera petición, y es él quien puede desactivar a alguien de inmediato.
 */
export function hasValidSession(auth: AuthState, now: number = Date.now()): boolean {
  return Boolean(auth.token) && auth.expiresAt > now;
}

/** Config del cliente a partir del estado de sesión. */
export function toDriveConfig(auth: AuthState): DriveConfig {
  return { endpoint: auth.endpoint, session: auth.token };
}

/* ------------------------------------------------------------------ */
/* ¿Hay que pedir acceso?                                              */
/* ------------------------------------------------------------------ */

/**
 * `NEXT_PUBLIC_LOGIN_REQUIRED` fijado al construir:
 *
 *   - `"false"` → nunca se pide acceso. Es el modo de una sola persona, que
 *     usa su propio Drive sin compartir nada con nadie.
 *   - `"true"` → siempre se pide.
 *   - sin definir, en blanco o con un valor que no se reconoce → también se
 *     pide. **La puerta está puesta por defecto**: no depende de que haya
 *     endpoint. Este sitio es público, una instalación a la que se le olvidó
 *     crear la variable no puede salir a la calle sin puerta, y no saber si
 *     hay servidor no es una razón para dejarla abierta. Con el backend aún
 *     sin configurar la pantalla sale igual y pide la dirección del servidor,
 *     que es preferible a publicar abierto por no haber puesto nada.
 */
export function loginRequired(): boolean {
  const flag = (process.env.NEXT_PUBLIC_LOGIN_REQUIRED ?? "").trim().toLowerCase();
  return flag !== "false";
}

/** ¿Se puede entrar sin red? Sólo con una sesión que aún no ha caducado. */
export function canEnterOffline(auth: AuthState, now: number = Date.now()): boolean {
  return hasValidSession(auth, now);
}

/* ------------------------------------------------------------------ */
/* Entrar y comprobar                                                  */
/* ------------------------------------------------------------------ */

/** Errores de acceso ya en castellano, tal cual se enseñan. */
export function describeAuthError(error: unknown): string {
  if (error instanceof DriveError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export interface SignInOptions {
  fetchImpl?: typeof fetch;
}

/** Entra con correo y contraseña y devuelve la sesión lista para guardar. */
export async function signIn(
  auth: AuthState,
  email: string,
  password: string,
  options: SignInOptions = {},
): Promise<AuthState> {
  const result = await login(auth.endpoint, email.trim(), password, options);
  return {
    endpoint: auth.endpoint,
    token: result.session,
    email: result.email,
    expiresAt: result.expiresAt,
  };
}

/**
 * Revalida una sesión guardada contra el servidor.
 *
 * Tres desenlaces, y son distintos a propósito:
 *  - El servidor dice que no vale        → devuelve `null` (hay que volver a entrar).
 *  - No hay red                          → devuelve la sesión tal cual, porque
 *    la aplicación funciona sin conexión y no se puede dejar a nadie fuera de
 *    sus partituras por un corte de wifi.
 *  - El servidor confirma la sesión      → devuelve la caducidad que él manda,
 *    que es la única que cuenta (permite alargar sesiones desde el script).
 */
export async function revalidateSession(
  auth: AuthState,
  options: SignInOptions = {},
): Promise<AuthState | null> {
  if (!hasValidSession(auth)) return null;
  try {
    const confirmed = await whoami(toDriveConfig(auth), options);
    return { ...auth, email: confirmed.email, expiresAt: confirmed.expiresAt };
  } catch (error) {
    if (error instanceof DriveError && error.code === "unauthenticated") return null;
    // Red caída, servidor caído o respuesta ilegible: se conserva la sesión y se
    // sigue funcionando con lo que hay en este equipo.
    return auth;
  }
}

/** Cierra la sesión. No toca las partituras: son del equipo, no de la sesión. */
export function signOut(auth: AuthState): AuthState {
  return { ...auth, token: "", email: "", expiresAt: 0 };
}
