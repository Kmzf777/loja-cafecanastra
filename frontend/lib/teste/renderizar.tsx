import type { ReactElement } from "react";
import { afterEach, vi } from "vitest";
import { cleanup, configure, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * O RELÓGIO FOLGA AQUI, E NÃO EM CADA ARQUIVO — e não é o produto que está lento.
 *
 * Quase todo teste de tela do painel é clique → `useTransition` → asserção, e o
 * `findBy*` do testing-library desiste em 1 s por padrão. Isolados, esses
 * arquivos terminam em milissegundos; dentro da suíte inteira, com os projetos
 * `vitrine` e `painel-dom` disputando a máquina, os mesmos casos estouram o
 * segundo — sempre nas asserções que vêm DEPOIS de uma transição, nunca nas
 * síncronas. Foi medido numa frente da Onda 5: verde sozinho, vermelho junto.
 *
 * Um teste que depende da carga da máquina não prova nada — só ensina a ignorar
 * vermelho. E a espera maior não esconde defeito: se a transição não terminar,
 * o caso continua falhando, só que mais tarde.
 *
 * Mora no helper porque a alternativa já aconteceu: quatro arquivos de uma
 * mesma frente repetiram estas duas linhas à mão, e a quinta tela nasceria sem
 * elas — descobrindo o mesmo do jeito difícil, num vermelho que parece bug de
 * produto. Quem importa `renderizar` herda; quem não renderiza não paga nada.
 */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 8_000 });

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
