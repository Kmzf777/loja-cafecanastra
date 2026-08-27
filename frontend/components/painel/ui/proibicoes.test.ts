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

/**
 * A VARREDURA OLHA `ui/` E `casca/` — as duas pastas de `components/painel/`.
 *
 * `casca/` entrou quando ela nasceu (MenuLateral, Cabecalho, o botão de sair).
 * Deixá-la de fora seria guardar a porta da frente e abrir a dos fundos: a
 * casca é JSX do painel exatamente como os primitivos são, e é justamente nela
 * que se cola trecho de layout de admin achado por aí — que é como `rounded-lg`
 * e `shadow-sm` entram num projeto, nunca por decisão.
 *
 * O NOME VEM COM A PASTA (`ui/Botao.tsx`) porque duas pastas podem ter arquivos
 * de mesmo nome, e uma mensagem de falha dizendo só "Botao.tsx" mandaria quem
 * for consertar procurar em dois lugares.
 */
const PASTAS = ["ui", "casca"] as const;
const RAIZ_DO_PAINEL = join(__dirname, "..");

/**
 * AS TELAS TAMBÉM SÃO VARRIDAS — e sem isto a guarda cobriria a caixa de
 * ferramentas e deixaria de fora o que é construído com ela.
 *
 * Os primitivos são doze arquivos escritos uma vez; as telas são uma pasta nova
 * por onda, escritas depressa, quase sempre a partir de um trecho achado por
 * aí. É exatamente ali que `rounded-lg` e `shadow-sm` entram num projeto —
 * nunca por decisão, sempre por cópia. Um `<Ficha>` impecável não salva uma
 * tela que desenhou o próprio cartão ao lado dele.
 *
 * `(publico)/entrar` FICA DE FORA, e a exceção é nomeada de propósito. A spec
 * §2.5 diz que "a mão aparece exatamente três vezes no painel inteiro: no
 * login, na marca do menu lateral e no estado vazio" — a tela de entrada é a
 * superfície de MARCA do painel, e nela o vermelho é o acento da Canastra, como
 * na loja. Dentro de `(protegido)` reina a etiqueta, e é ali que a regra vale.
 */
const RAIZ_DO_FRONTEND = join(__dirname, "..", "..", "..");
const TELAS_DO_PAINEL = join(RAIZ_DO_FRONTEND, "app", "dashboard", "(protegido)");

/**
 * OS MÓDULOS PUROS TAMBÉM SÃO VARRIDOS — `lib/painel/`, acrescentado na Onda 5.
 *
 * Parece desnecessário: um `*.logica.ts` não tem JSX, então não teria classe do
 * Tailwind para violar. Só que ele TEM strings, e a tentação de guardar ali o
 * "mapa de cor por status" ou o "className da coluna" é exatamente o atalho que
 * as próximas ondas vão querer tomar — e ele passa por fora da guarda desenhada
 * para o JSX, que é o pior lugar por onde uma proibição pode escapar: o teste
 * continua verde e a proibição já não vale.
 *
 * A varredura desta pasta começou vazia de violações (medido nesta onda: zero
 * ocorrências em todos os seis padrões), então ela não custa nada hoje. É agora
 * que se fecha a porta, não depois de alguém passar por ela.
 */
const MODULOS_DO_PAINEL = join(RAIZ_DO_FRONTEND, "lib", "painel");

function varrer(dir: string, prefixo: string): { nome: string; fonte: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return varrer(caminho, `${prefixo}${entrada.name}/`);
    }
    if (!/\.tsx?$/.test(entrada.name) || entrada.name.includes(".test.")) return [];
    return [
      {
        nome: `${prefixo}${entrada.name}`,
        fonte: semComentarios(readFileSync(caminho, "utf8")),
      },
    ];
  });
}

function arquivosDeProducao(): { nome: string; fonte: string }[] {
  const primitivos = PASTAS.flatMap((pasta) =>
    varrer(join(RAIZ_DO_PAINEL, pasta), `${pasta}/`),
  );

  return [
    ...primitivos,
    ...varrer(TELAS_DO_PAINEL, "tela/"),
    ...varrer(MODULOS_DO_PAINEL, "logica/"),
  ];
}

describe("as proibições do painel", () => {
  it("a varredura acha os arquivos — um teste que não lê nada passa por engano", () => {
    const arquivos = arquivosDeProducao();
    expect(arquivos.map((a) => a.nome).sort()).toEqual([
      "casca/BotaoDeSair.tsx",
      "casca/Cabecalho.tsx",
      "casca/MenuLateral.tsx",
      "casca/menu.logica.ts",
      // Os módulos puros de `lib/painel/` — ver o comentário de
      // MODULOS_DO_PAINEL para o porquê de eles entrarem na varredura.
      "logica/api-servidor.ts",
      "logica/assinaturas/assinaturas.logica.ts",
      "logica/bling/contrato.ts",
      "logica/clientes/clientes.logica.ts",
      "logica/data.ts",
      "logica/dinheiro.ts",
      "logica/filtros.ts",
      "logica/home/home.logica.ts",
      "logica/paginacao.ts",
      "logica/resposta.ts",
      "logica/status.ts",
      "logica/transporte.ts",
      "logica/vitrine/vitrine.logica.ts",
      // As telas. A lista é escrita à mão de propósito: uma pasta nova em
      // `(protegido)` fica vermelha aqui, e quem a acrescentar tem de olhar
      // para esta lista uma vez. É o mesmo mecanismo do teste de estrutura em
      // `lib/conta/painel-servidor.test.ts` — a onda seguinte não nasce fora da
      // varredura por distração.
      "tela/GraficoDeReceita.tsx",
      "tela/assinaturas/page.tsx",
      "tela/clientes/page.tsx",
      "tela/layout.tsx",
      "tela/legado/[[...rota]]/PainelLegado.tsx",
      "tela/legado/[[...rota]]/page.tsx",
      "tela/page.tsx",
      "tela/vitrine/FormularioDaVitrine.tsx",
      "tela/vitrine/Previa.tsx",
      "tela/vitrine/acoes.ts",
      "tela/vitrine/page.tsx",
      "ui/Botao.tsx",
      "ui/BuscaDaLista.tsx",
      "ui/Campo.tsx",
      "ui/ChipsDeFiltro.tsx",
      "ui/EstadoDaTela.tsx",
      "ui/Ficha.tsx",
      "ui/Paginacao.tsx",
      "ui/Selo.tsx",
      "ui/Tabela.tsx",
      "ui/Tarja.tsx",
      "ui/estilos.ts",
    ]);
  });

  it("e some com os comentários — senão a explicação da regra viola a regra", () => {
    const tabela = arquivosDeProducao().find((a) => a.nome === "ui/Tabela.tsx")!;
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
    expect(comVermelho).toEqual([
      /**
       * A ÚNICA EXCEÇÃO, e ela é auditável por estar escrita aqui.
       *
       * `Previa.tsx` desenha uma MINIATURA DA LOJA dentro do painel, e na loja
       * `--color-vermelho` é o acento de marca: o botão primário do herói é
       * vermelho sólido (`components/ui/Botao.tsx`, variante `primario`). R21
       * governa o cromo do painel — pintar o botão de preto ali para obedecer a
       * uma regra que não é dele faria a prévia mentir sobre a única coisa que
       * ela existe para mostrar.
       *
       * Uma SEGUNDA tela que apareça nesta lista é outra conversa: ou ela
       * também desenha a loja, ou o vermelho virou destaque e ninguém mais vai
       * acreditar nos erros de verdade.
       */
      "tela/vitrine/Previa.tsx",
      "ui/Botao.tsx",
      "ui/Campo.tsx",
      "ui/Selo.tsx",
      "ui/Tarja.tsx",
    ]);
  });
});

/**
 * O contraste dos tokens, medido do próprio `globals.css`.
 *
 * ISTO EXISTE PORQUE A CORREÇÃO SE DESFAZ SOZINHA. `--color-alerta` (#B87514,
 * o ocre da marca) dá 3,60:1 sobre cal-puro: passa na WCAG 1.4.11 (3:1, filete
 * e outros elementos não-textuais) e REPROVA na 1.4.3 (4,5:1, texto pequeno).
 * A saída foi o par `--color-alerta-esc`, igual ao que `--color-vermelho` já
 * tinha — filete no tom da marca, texto no tom escuro.
 *
 * Sem este teste, alguém "simplifica" `text-alerta-esc` de volta para
 * `text-alerta` num arquivo qualquer, a tela continua bonita, e o selo de
 * "pendente" em 11px vira ilegível para quem enxerga pouco. Contraste é
 * exatamente o tipo de defeito que ninguém vê olhando — por isso quem olha é o
 * teste.
 *
 * A leitura é do CSS, e não de uma cópia dos valores aqui: um token trocado no
 * `globals.css` fica vermelho aqui na hora.
 */
describe("contraste dos tokens semânticos", () => {
  const CSS = readFileSync(
    join(__dirname, "..", "..", "..", "app", "globals.css"),
    "utf8",
  );

  function token(nome: string): string {
    const achado = CSS.match(new RegExp(`--color-${nome}:\\s*(#[0-9A-Fa-f]{6})`));
    if (!achado) throw new Error(`token --color-${nome} não encontrado`);
    return achado[1];
  }

  /** Luminância relativa da WCAG 2.x (sRGB → linear, pesos 0.2126/0.7152/0.0722). */
  function luminancia(hex: string): number {
    const canais = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
  }

  function razao(a: string, b: string): number {
    const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
    return (claro + 0.05) / (escuro + 0.05);
  }

  const FUNDO = () => token("cal-puro");

  it.each([
    ["fuligem"],
    ["fuligem-55"],
    ["vermelho"],
    ["sucesso"],
    ["alerta-esc"],
    ["barro"],
  ])("--color-%s serve de TEXTO sobre cal-puro (≥ 4,5:1)", (nome) => {
    expect(razao(token(nome), FUNDO())).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * O ocre claro fica, e o teste registra POR QUE ele fica: como filete, 3:1
   * basta, e ele passa. Apagá-lo do sistema por causa do texto seria jogar fora
   * uma cor de marca por um uso que ela nunca teve.
   */
  it("--color-alerta serve de FILETE (≥ 3:1) e não de texto (< 4,5:1)", () => {
    const r = razao(token("alerta"), FUNDO());
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThan(4.5);
  });

  it("a tarja de alerta escreve com o tom escuro, não com o da marca", () => {
    const tarja = readFileSync(join(__dirname, "Tarja.tsx"), "utf8");
    expect(tarja).toMatch(/texto:\s*"text-alerta-esc"/);
  });
});
