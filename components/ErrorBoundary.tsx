"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Barrera de errores.
 *
 * Sin esto, cualquier excepción durante el render (una partitura rara que OSMD
 * no diga digerir, un documento antiguo con un campo que falta) deja la página
 * en blanco y **sin forma de volver**: la biblioteca y las partituras siguen en
 * IndexedDB, pero el usuario no ve nada y no puede llegar a ellas.
 *
 * Lo que hace aquí es dar una salida: explicar que el trabajo está guardado,
 * ofrecer recargar y —lo importante— dejar volver a la biblioteca descartando
 * sólo lo que se estaba mostrando.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A la consola, con el componente que falló: es lo único que queda cuando
    // el usuario no puede describir qué ha pasado.
    console.error("[Partitura Studio] Error de render:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
        <div
          className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-sm"
          role="alert"
        >
          <h1 className="text-base font-semibold">Algo se ha roto al dibujar</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            <b>Tus partituras y anotaciones están guardadas</b>: el fallo es de
            la pantalla, no de los datos. La copia de Drive, si la tienes
            configurada, tampoco se ha tocado.
          </p>
          <pre className="thin-scroll mt-3 max-h-32 overflow-auto rounded-lg bg-surface p-2 text-[11px] leading-relaxed text-muted">
            {error.message || String(error)}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white"
            >
              Recargar la aplicación
            </button>
            <button
              onClick={() => {
                // Volver a la biblioteca sin recargar: si el fallo estaba en
                // una partitura concreta, así se puede seguir trabajando en las
                // demás sin perder lo que haya en memoria.
                this.setState({ error: null });
                window.location.hash = "";
                window.dispatchEvent(new Event("ps:reset-view"));
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface"
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
