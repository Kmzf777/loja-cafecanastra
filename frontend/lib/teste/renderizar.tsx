import type { ReactElement } from "react";
import { afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Render COM DOM, só para o painel.
 *
 * Devolve o resultado do testing-library junto de um `usuario` já configurado,
 * porque `userEvent.setup()` esquecido é a causa número um de teste que
 * "não clica" sem dizer por quê.
 *
 * Só funciona em arquivo coberto pelo projeto `painel-dom` do
 * `vitest.config.ts` (`app/dashboard/**` e `components/painel/**`). Fora dali o
 * ambiente é `node` e `document` não existe.
 *
 * A LIMPEZA ENTRE TESTES MORA AQUI, e não em cada arquivo, porque ela é
 * invisível quando falta. O auto-cleanup do testing-library só se registra
 * sozinho quando `globals: true` está ligado, e este projeto o mantém
 * desligado de propósito (todo arquivo importa `describe`/`it`/`expect`
 * explicitamente). Sem o `cleanup`, cada render deixa a árvore anterior
 * pendurada no `document`, e o SEGUNDO `getByRole` do arquivo estoura com
 * "found multiple elements" — um erro que aponta para o teste novo e cuja
 * causa está no teste anterior. Pior: um `getByText` frouxo pode achar o
 * elemento ERRADO e o teste passa, provando o que não devia.
 *
 * `afterEach` no escopo do módulo é registrado uma vez por arquivo que importa
 * este helper, que é exatamente o que se quer: quem não renderiza com DOM não
 * paga nada.
 */
afterEach(() => {
  cleanup();
});

export function renderizar(no: ReactElement) {
  const usuario = userEvent.setup();
  return { ...render(no), usuario };
}
