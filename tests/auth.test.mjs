import assert from "node:assert/strict";
import test from "node:test";

import {
  canEnterOffline,
  hasValidSession,
  loginRequired,
  revalidateSession,
  signIn,
  signOut,
} from "../lib/auth.ts";
import { DriveError, listRemote, login, whoami } from "../lib/drive.ts";
import { createMockDrive, DEFAULT_SERVICE_KEY, DEFAULT_USERS } from "../tools/mock-apps-script.mjs";

const ANA = DEFAULT_USERS[0];
const BLOQUEADO = DEFAULT_USERS[1];

/** Un servidor por prueba, para que no compartan estado. */
async function withDrive(run, options = {}) {
  const drive = await createMockDrive(options);
  try {
    await run(drive);
  } finally {
    await drive.close();
  }
}

const configWith = (drive, session) => ({ endpoint: drive.url, session });

/* ------------------------------------------------------------------ */
/* Entrar                                                              */
/* ------------------------------------------------------------------ */

test("con el correo y la contraseña correctos se obtiene una sesión", async () => {
  await withDrive(async (drive) => {
    const result = await login(drive.url, ANA.email, ANA.password);

    assert.equal(result.email, ANA.email);
    assert.ok(result.session.startsWith(`${ANA.email}|`));
    assert.ok(result.expiresAt > Date.now());
    // Y esa sesión sirve para pedir datos.
    const scores = await listRemote(configWith(drive, result.session));
    assert.deepEqual(scores, []);
  });
});

test("el correo se normaliza: mayúsculas y espacios no impiden entrar", async () => {
  await withDrive(async (drive) => {
    const result = await login(drive.url, `  ${ANA.email.toUpperCase()}  `, ANA.password);
    assert.equal(result.email, ANA.email);
  });
});

test("contraseña incorrecta, correo desconocido y usuario desactivado dicen lo mismo", async () => {
  await withDrive(async (drive) => {
    const attempts = [
      [ANA.email, "no-es-la-contraseña"],
      ["nadie@ejemplo.com", "lo-que-sea"],
      [BLOQUEADO.email, BLOQUEADO.password],
    ];

    const messages = [];
    for (const [email, password] of attempts) {
      await assert.rejects(
        () => login(drive.url, email, password),
        (error) => {
          assert.ok(error instanceof DriveError);
          assert.equal(error.code, "unauthenticated");
          messages.push(error.message);
          return true;
        },
      );
    }

    // El mismo mensaje para los tres: probando correos no se puede averiguar
    // quién tiene cuenta ni quién sigue activo.
    assert.equal(new Set(messages).size, 1);
    assert.match(messages[0], /Correo o contraseña incorrectos/);
  });
});

test("un correo con formato inválido se rechaza sin llamar al servidor", async () => {
  await withDrive(async (drive) => {
    let calls = 0;
    const counting = async (url, init) => {
      calls += 1;
      return fetch(url, init);
    };
    await assert.rejects(
      () => login(drive.url, "no-es-un-correo", "contraseña", { fetchImpl: counting }),
      (error) => {
        assert.equal(error.code, "bad_request");
        return true;
      },
    );
    assert.equal(calls, 1, "se pregunta una vez y el servidor contesta que no");
  });
});

test("demasiados intentos fallidos bloquean temporalmente ese correo", async () => {
  await withDrive(async (drive) => {
    for (let i = 0; i < 9; i++) {
      await assert.rejects(() => login(drive.url, ANA.email, `mal-${i}`));
    }

    await assert.rejects(
      () => login(drive.url, ANA.email, ANA.password),
      (error) => {
        assert.equal(error.code, "too_many_attempts");
        assert.match(error.message, /Demasiados intentos/);
        return true;
      },
    );

    // El bloqueo es por correo: otra persona puede seguir entrando.
    const otra = await login(drive.url, BLOQUEADO.email, BLOQUEADO.password).catch(() => null);
    assert.equal(otra, null, "la cuenta desactivada sigue sin poder entrar");
  });
});

/* ------------------------------------------------------------------ */
/* Sesiones                                                            */
/* ------------------------------------------------------------------ */

test("sin sesión no se lee ni se escribe nada", async () => {
  await withDrive(async (drive) => {
    for (const session of ["", "basura", "ana@ejemplo.com|9999999999999", null]) {
      await assert.rejects(
        () => listRemote(configWith(drive, session)),
        (error) => {
          assert.equal(error.code, "unauthenticated");
          return true;
        },
      );
    }
  });
});

test("una sesión manipulada se rechaza: la firma no cuadra", async () => {
  await withDrive(async (drive) => {
    const { session, expiresAt } = await login(drive.url, ANA.email, ANA.password);
    const [email, , signature] = session.split("|");

    // Cambiar la caducidad sin poder firmar: el intento clásico de alargarse.
    const forged = `${email}|${expiresAt + 10 * 365 * 24 * 60 * 60 * 1000}|${signature}`;
    await assert.rejects(() => listRemote(configWith(drive, forged)), /sesión ha caducado/i);

    // Y una firma inventada del mismo tamaño tampoco.
    const fake = `${email}|${expiresAt}|${"0".repeat(signature.length)}`;
    await assert.rejects(() => listRemote(configWith(drive, fake)), /sesión ha caducado/i);
  });
});

test("una sesión caducada deja de valer sin tocar nada más", async () => {
  // El doble emite sesiones que nacen ya caducadas, para no esperar 30 días.
  await withDrive(
    async (drive) => {
      const { session } = await login(drive.url, ANA.email, ANA.password);
      assert.equal(hasValidSession({ token: session, expiresAt: Date.now() - 1 }), false);
      await assert.rejects(() => listRemote(configWith(drive, session)), /sesión ha caducado/i);
    },
    { expiredAfterMs: -1000 },
  );
});

test("desactivar a alguien mata su sesión en la petición siguiente", async () => {
  await withDrive(async (drive) => {
    const { session } = await login(drive.url, ANA.email, ANA.password);
    assert.deepEqual(await listRemote(configWith(drive, session)), []);

    // Quien administra la retira de la lista…
    drive.accounts[0].active = false;

    // …y la sesión ya emitida, que sigue firmada y sin caducar, deja de servir.
    await assert.rejects(() => listRemote(configWith(drive, session)), /sesión ha caducado/i);
  });
});

test("revocar todas las sesiones expulsa a todo el mundo y se puede volver a entrar", async () => {
  await withDrive(async (drive) => {
    const first = await login(drive.url, ANA.email, ANA.password);
    drive.revokeAll();
    await assert.rejects(() => listRemote(configWith(drive, first.session)), /sesión ha caducado/i);

    // Con la contraseña correcta se pide otra y se sigue trabajando.
    const second = await login(drive.url, ANA.email, ANA.password);
    assert.deepEqual(await listRemote(configWith(drive, second.session)), []);
  });
});

test("whoami confirma la sesión y dice a quién pertenece", async () => {
  await withDrive(async (drive) => {
    const { session } = await login(drive.url, ANA.email, ANA.password);
    const who = await whoami(configWith(drive, session));
    assert.equal(who.email, ANA.email);
    assert.ok(who.expiresAt > Date.now());
  });
});

test("la clave de servicio sirve para la consola y para curl, no para la web", async () => {
  await withDrive(async (drive) => {
    // Existe y funciona en su propio campo, que es como la mandan la consola y
    // `curl` (`{"action":"list","serviceKey":"…"}`), igual que el script real.
    const response = await fetch(drive.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "list", serviceKey: DEFAULT_SERVICE_KEY }),
    });
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.scores, []);

    // Pero no es una sesión: la aplicación no puede colarla por `session`, y
    // una clave equivocada tampoco vale por ese camino.
    await assert.rejects(() => listRemote(configWith(drive, DEFAULT_SERVICE_KEY)), /sesión ha caducado/i);
    await assert.rejects(() => listRemote(configWith(drive, "otra-clave")), /sesión ha caducado/i);
  });
});

/* ------------------------------------------------------------------ */
/* Política de la aplicación                                           */
/* ------------------------------------------------------------------ */

test("hasValidSession distingue «no hay sesión» de «ya ha caducado»", () => {
  const now = 1_700_000_000_000;
  assert.equal(hasValidSession({ token: "", expiresAt: 0 }, now), false);
  assert.equal(hasValidSession({ token: "abc", expiresAt: 0 }, now), false);
  assert.equal(hasValidSession({ token: "abc", expiresAt: now - 1 }, now), false);
  assert.equal(hasValidSession({ token: "abc", expiresAt: now + 1 }, now), true);

  // Sin red se puede entrar sólo si la sesión sigue viva.
  assert.equal(canEnterOffline({ token: "abc", expiresAt: now + 1 }, now), true);
  assert.equal(canEnterOffline({ token: "abc", expiresAt: now - 1 }, now), false);
});

test("loginRequired se decide con la instalación, no por suposición", () => {
  const original = process.env.NEXT_PUBLIC_LOGIN_REQUIRED;
  try {
    delete process.env.NEXT_PUBLIC_LOGIN_REQUIRED;
    // Sin backend configurado no hay plataforma que proteger: modo local.
    assert.equal(loginRequired(false), false);
    assert.equal(loginRequired(true), true);

    process.env.NEXT_PUBLIC_LOGIN_REQUIRED = "true";
    assert.equal(loginRequired(false), true, "forzado aunque aún no haya URL");

    process.env.NEXT_PUBLIC_LOGIN_REQUIRED = "false";
    assert.equal(loginRequired(true), false, "una sola persona, sin puerta");
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_LOGIN_REQUIRED;
    else process.env.NEXT_PUBLIC_LOGIN_REQUIRED = original;
  }
});

test("signIn guarda la sesión y signOut la quita sin tocar lo demás", async () => {
  await withDrive(async (drive) => {
    const before = { endpoint: drive.url, token: "", email: "", expiresAt: 0 };
    const auth = await signIn(before, ANA.email, ANA.password);

    assert.equal(auth.endpoint, drive.url);
    assert.equal(auth.email, ANA.email);
    assert.equal(hasValidSession(auth), true);

    const out = signOut(auth);
    assert.equal(out.token, "");
    assert.equal(out.email, "");
    // La dirección de la implementación se conserva: volver a entrar no debe
    // obligar a buscarla otra vez.
    assert.equal(out.endpoint, drive.url);
  });
});

test("revalidateSession no deja a nadie fuera por un corte de red", async () => {
  await withDrive(async (drive) => {
    const auth = await signIn({ endpoint: drive.url, token: "", email: "", expiresAt: 0 }, ANA.email, ANA.password);

    // Red caída: se conserva la sesión (la aplicación funciona sin conexión).
    const offline = async () => {
      const error = new Error("getaddrinfo ENOTFOUND");
      error.name = "TypeError";
      throw error;
    };
    const kept = await revalidateSession(auth, { fetchImpl: offline });
    assert.deepEqual(kept, auth);

    // Servidor que dice que ya no vale: se devuelve null y se pedirá acceso.
    drive.accounts[0].active = false;
    assert.equal(await revalidateSession(auth), null);
  });
});

test("la respuesta de error lleva código, para no confundir red con acceso", async () => {
  await withDrive(async (drive) => {
    await assert.rejects(
      () => login(drive.url, ANA.email, "mal"),
      (error) => {
        assert.equal(error.code, "unauthenticated");
        return true;
      },
    );
    await assert.rejects(
      () => listRemote({ endpoint: "http://127.0.0.1:1/exec", session: "x" }, {}),
      (error) => {
        assert.equal(error.code, "network");
        return true;
      },
    );
  });
});
