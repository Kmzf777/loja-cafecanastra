import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * As seis proibições do painel, viradas em teste.
 *
 * O estetica.md §4.1 pede exatamente isto — "codificar essas proibições como
 * lint/teste, porque são erros que acontecem sozinhos" — e aqui elas acontecem
 * sozinhas de um jeito específico: ninguém escreve `rounded-lg` de propósito,
 * escreve-se copiando um trecho de shadcn, de um exemplo de Tailwind ou de
 * outro projeto. Revisão humana pega a primeira vez e não pega a décima.
 *
 * A lista vem da spec §2.7 e do plano da Task 11. Cada uma tem um motivo:
 *
 *  1. RAIO fora de `cx`/`bt` — o sistema é de canto reto porque o selo da
 *     embalagem é um retângulo reto (§4.3). `rounded-lg` é a assinatura visual
 *     de outro sistema.
 *  2. SOMBRA — a separação do painel é o filete de 1px. "Profundidade se faz
 *     por papel e filete" (§4.4); sombra difusa é vocabulário de material
 *     design.
 *  3. PALETA CINZA NEUTRA — `gray/slate/zinc` não são cores da casa. A casa tem
 *     cal e fuligem, que são cinzas QUENTES; misturar as duas famílias faz a
 *     tela parecer mal calibrada sem que se saiba dizer por quê.
 *  4. `oklch` — é a notação do tema padrão do shadcn, e um valor em oklch é um
 *     valor que não veio de nenhum token do §4.1.
 *  5. `role="grid"` — R24: obrigaria a escrever navegação 2D por setas, roving
 *     tabindex e virtualização acessível à mão.
 *  6. Os componentes `Card`/`Button`/`Input`/`Table` do shadcn — o §2 do
 *     estetica.md rejeita nominalmente o visual genérico de IA, e entregar
 *     shadcn cru é fazer o que o documento de marca proíbe.
 *
 * A VARREDURA OLHA SÓ O CÓDIGO QUE VAI PARA O NAVEGADOR, e com os comentários
 * removidos. As duas exclusões foram descobertas por este teste falhando: os
 * arquivos de teste CITAM os padrões proibidos de propósito (`Tabela.test.tsx`
 * afirma que a saída não contém `role="grid"`), e o comentário do `Tabela.tsx`
 * explica por que o grid não foi usado — nomeando-o. Um guarda que confunde
 * "usa" com "fala sobre" ensina a apagar a explicação para calar o teste, que é
 * o oposto do que este repositório quer.
 */

const PROIBIDO: { nome: string; padrao: RegExp; porque: string }[] = [
  {
    nome: "raio fora de rounded-cx / rounded-bt",
    padrao: /\brounded\b(?!-(?:cx|bt)\b)/g,
    porque: "o sistema é de canto reto — estetica.md §4.3",
  },
  {
    nome: "sombra",
    padrao: /\bshadow-[a-z0-9[]|box-shadow/g,
    porque: "a separação é o filete de 1px — estetica.md §4.4",
  },
  {
    nome: "paleta cinza neutra",
    padrao: /\b(?:gray|grey|slate|zinc|neutral|stone)-\d{2,3}\b/g,
    porque: "só os tokens da casa — estetica.md §4.1",
  },
  {
    nome: "cor em oklch",
    padrao: /oklch\s*\(/gi,
    porque: "é a notação do tema padrão do shadcn, fora dos tokens — spec §2.7",
  },
  {
    nome: 'role="grid"',
    padrao: /\brole\s*=\s*["']grid(?:cell)?["']/g,
    porque: "R24 — tabela nativa dá teclado de graça; grid obriga a escrevê-lo à mão",
  },
  {
    nome: "componente Card/Button/Input/Table do shadcn",
    padrao: /["']@?[\w./-]*\/components\/ui\/(?:card|button|input|table)["']/gi,
    porque: "spec §2.7 — o shadcn entra como referência, nunca como dependência",
  },
];

/** Tira comentários de bloco e de linha. O `(?<!:)` poupa o `//` de uma URL. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
}

function arquivosDeProducao(): { nome: string; fonte: string }[] {
  return readdirSync(__dirname)
    .filter((nome) => /\.tsx?$/.test(nome) && !nome.includes(".test."))
    .map((nome) => ({
      nome,
      fonte: semComentarios(readFileSync(join(__dirname, nome), "utf8")),
    }));
}

describe("as proibições do painel", () => {
  it("a varredura acha os arquivos — um teste que não lê nada passa por engano", () => {
    const arquivos = arquivosDeProducao();
    expect(arquivos.map((a) => a.nome).sort()).toEqual([
      "Botao.tsx",
      "Campo.tsx",
      "EstadoDaTela.tsx",
      "Ficha.tsx",
      "Selo.tsx",
      "Tabela.tsx",
      "Tarja.tsx",
      "estilos.ts",
    ]);
  });

  it("e some com os comentários — senão a explicação da regra viola a regra", () => {
    const tabela = arquivosDeProducao().find((a) => a.nome === "Tabela.tsx")!;
    expect(tabela.fonte).toContain("<table");
    expect(tabela.fonte).not.toContain("R24");
  });

  for (const { nome, padrao, porque } of PROIBIDO) {
    it(`nenhum arquivo usa ${nome} — ${porque}`, () => {
      const achados = arquivosDeProducao().flatMap(({ nome: arquivo, fonte }) =>
        [...fonte.matchAll(padrao)].map((m) => `${arquivo}: ${m[0]}`),
      );
      expect(achados).toEqual([]);
    });
  }

  /**
   * A regra irmã do R21, e a que mais se perde: vermelho pode aparecer, mas só
   * nas duas palavras que o autorizam. Se um dia `vermelho` surgir num arquivo
   * que não seja o da tarja, o do botão destrutivo ou o do campo com erro, é
   * porque virou cor de destaque — e aí ninguém acredita mais nos erros.
   */
  it("vermelho só vive onde erro e destruição vivem — R21", () => {
    const comVermelho = arquivosDeProducao()
      .filter(({ fonte }) => /vermelho/.test(fonte))
      .map(({ nome }) => nome)
      .sort();
    expect(comVermelho).toEqual(["Botao.tsx", "Campo.tsx", "Selo.tsx", "Tarja.tsx"]);
  });
});
