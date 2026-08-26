import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Render COM DOM, só para o painel.
 *
 * Devolve o resultado do testing-library junto de um `usuario` já configurado,
 * porque `userEvent.setup()` esquecido é a causa número um de teste que
 * "não clica" sem dizer por quê.
 *
 * Só funciona em arquivo coberto por `environmentMatchGlobs` no
 * vitest.config.ts. Fora dali o ambiente é `node` e `document` não existe.
 */
export function renderizar(no: ReactElement) {
  const usuario = userEvent.setup();
  return { ...render(no), usuario };
}
