import { describe, it, expect, vi, beforeEach } from "vitest";

import { fireEvent } from "@testing-library/react";

import { renderizar } from "@/lib/teste/renderizar";
import { urlDaImagemDoPainel } from "@/lib/painel/transporte";
import type { CustoDoProduto } from "@/lib/painel/produtos/ficha.logica";
import type { ProdutoDoPainel } from "@/lib/painel/produtos/produtos.logica";

/**
 * O QUE SÓ O DOM ALCANÇA na ficha de produto.
 *
 * A decisão está em `ficha.logica.ts` (44 casos, em node): validar, montar o
 * corpo, decidir a aba do erro, recusar a imagem. O que não dá para testar sem
 * navegador é o COMPORTAMENTO — e nesta tela há um comportamento que é a razão
 * de a tela existir:
 *
 *   **OS QUATRO CAMPOS DE MEDIDA TÊM DE ESTAR NA TELA, COM OS VALORES REAIS.**
 *   O formulário legado enviava `weight/width/height/length` SEM TER INPUT PARA
 *   NENHUM DOS QUATRO: `undefined` virava a string "undefined" no FormData, o
 *   backend não parseava e aplicava 0,3 kg / 20×5×20 cm em TODA edição — a loja
 *   cotando frete de uma caixa que não existia, sem nada na tela. O teste que
 *   fecha isso é o de ponta a ponta: digitar só o preço e conferir que as
 *   quatro medidas chegam ao payload com os valores do produto, e não com os
 *   padrões nem com "undefined".
 *
 * E mais três que só existem com eventos: a barra de salvar do R5, a ausência
 * de autosave do R6, e a recusa da imagem antes de o arquivo sair da máquina.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...a: unknown[]) => push(...a), replace: () => {} }),
}));

const salvarProduto = vi.fn(async () => ({ ok: true as const, frase: "Produto editado com sucesso!" }));
const salvarCusto = vi.fn(async () => ({ ok: true as const, frase: "Custo salvo." }));
const ajustarEstoque = vi.fn(async () => ({ ok: true as const, frase: "Estoque ajustado." }));
vi.mock("./acoes", () => ({
  salvarProduto: (...a: unknown[]) =>
    (salvarProduto as unknown as (...x: unknown[]) => unknown)(...a),
  salvarCusto: (...a: unknown[]) =>
    (salvarCusto as unknown as (...x: unknown[]) => unknown)(...a),
  ajustarEstoque: (...a: unknown[]) =>
    (ajustarEstoque as unknown as (...x: unknown[]) => unknown)(...a),
}));

const { FichaDoProduto } = await import("./FichaDoProduto");

const PRODUTO: ProdutoDoPainel = {
  product_id: "44444444-1111-4111-8111-111111111111",
  sku: "classico-graos-250",
  name: "Canastra Clássico em grãos 250 g",
  size: "250 g",
  category: "Especial",
  price: "59.90",
  image: "https://res.cloudinary.com/x/canastra_produtos/a.jpg",
  timestamp: null,
  quantity: 12,
  description: "Doce, com corpo médio.",
  // MEDIDAS PRÓPRIAS, diferentes dos padrões — é sobre elas que o teste central
  // deste arquivo fala.
  weight: "1.200",
  width: "24.00",
  height: "9.00",
  length: "31.00",
};

const CUSTO: CustoDoProduto = {
  product_id: PRODUTO.product_id,
  sku: PRODUTO.sku,
  name: PRODUTO.name,
  price: "59.90",
  custo: "24.00",
};

function montar(
  sobrepor: Partial<React.ComponentProps<typeof FichaDoProduto>> = {},
) {
  return renderizar(
    <FichaDoProduto
      produto={PRODUTO}
      custoInicial={CUSTO}
      erroDoCusto={null}
      abaInicial="venda"
      {...sobrepor}
    />,
  );
}

/** Os pares do `FormData` que a ação recebeu, como objeto. */
function corpoEnviado(): Record<string, unknown> {
  const [, dados] = salvarProduto.mock.calls[0] as unknown as [string | null, FormData];
  return Object.fromEntries(dados.entries());
}

beforeEach(() => {
  salvarProduto.mockClear();
  salvarCusto.mockClear();
  ajustarEstoque.mockClear();
  push.mockClear();
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * O DEFEITO MEDIDO
 * ══════════════════════════════════════════════════════════════════════════ */

describe("os quatro campos de medida", () => {
  it("existem na tela, na aba Fiscal, com os valores reais do produto", async () => {
    const { usuario, getByRole, getByLabelText } = montar();
    await usuario.click(getByRole("tab", { name: /Fiscal/ }));

    expect((getByLabelText(/^Peso \(kg\)/) as HTMLInputElement).value).toBe("1,200");
    expect((getByLabelText(/^Largura \(cm\)/) as HTMLInputElement).value).toBe("24,00");
    expect((getByLabelText(/^Altura \(cm\)/) as HTMLInputElement).value).toBe("9,00");
    expect((getByLabelText(/^Comprimento \(cm\)/) as HTMLInputElement).value).toBe("31,00");
  });

  /**
   * O TESTE DE REGRESSÃO QUE A PESQUISA PEDIU, palavra por palavra: "editar só
   * o preço de um produto com medidas customizadas e conferir que peso e
   * dimensões não mudaram". Aqui ele é feito no PAYLOAD, que é onde o estrago
   * nascia.
   */
  it("editar só o preço manda as quatro medidas com os valores de hoje", async () => {
    const { usuario, getByLabelText, getByRole } = montar();

    const preco = getByLabelText(/^Preço/) as HTMLInputElement;
    await usuario.clear(preco);
    await usuario.type(preco, "64,90");
    await usuario.click(getByRole("button", { name: "Salvar" }));

    const corpo = corpoEnviado();
    expect(corpo.price).toBe("64.9");
    expect(corpo.weight).toBe("1.2");
    expect(corpo.width).toBe("24");
    expect(corpo.height).toBe("9");
    expect(corpo.length).toBe("31");
    // O sintoma exato do defeito antigo: a string "undefined" no FormData.
    expect(Object.values(corpo)).not.toContain("undefined");
  });

  /** Sem os quatro, o frete sai errado — e a validação é mais severa que a do
   *  backend justamente porque a tela nova existe para isso. */
  it("medida apagada barra o salvamento e leva à aba onde ela está", async () => {
    const { usuario, getByRole, getByLabelText, findByRole } = montar();
    await usuario.click(getByRole("tab", { name: /Fiscal/ }));
    await usuario.clear(getByLabelText(/^Peso \(kg\)/));

    // Volta para a primeira aba antes de salvar: é o caso real em que o campo
    // errado fica escondido.
    await usuario.click(getByRole("tab", { name: /^Venda/ }));
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(salvarProduto).not.toHaveBeenCalled();
    expect(await findByRole("alert")).toBeTruthy();
    // O salto para a aba do erro: sem ele, a tarja aponta para uma tela onde
    // não há nada marcado e o gestor clica em Salvar até desistir.
    expect(getByRole("tab", { name: /Fiscal/ }).getAttribute("aria-selected")).toBe("true");
  });

  /** O sinal da caixa padrão também aparece na ficha, e não só na lista. */
  it("avisa quando as quatro estão nos padrões da caixa", async () => {
    const { usuario, getByRole } = montar({
      produto: { ...PRODUTO, weight: "0.300", width: "20.00", height: "5.00", length: "20.00" },
    });
    await usuario.click(getByRole("tab", { name: /Fiscal/ }));
    expect(getByRole("tabpanel").textContent).toContain("rastro do formulário antigo");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * R5 e R6 — A BARRA DE SALVAR E A AUSÊNCIA DE AUTOSAVE
 * ══════════════════════════════════════════════════════════════════════════ */

describe("a barra de salvar — R5", () => {
  it("não existe enquanto nada mudou", () => {
    const { queryByRole } = montar();
    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
  });

  it("nasce com a primeira alteração e diz em qual aba ela está", async () => {
    const { usuario, getByLabelText, getByText, getByRole } = montar();
    await usuario.type(getByLabelText(/^Nome/), "!");
    expect(getByRole("button", { name: "Salvar" })).toBeTruthy();
    expect(getByText(/Alterações não salvas em Venda/)).toBeTruthy();
  });

  /** Descartar apaga trabalho, então pede duas etapas — R11 quer peso e cor
   *  diferentes para o que destrói. */
  it("descartar pede confirmação e devolve os valores de origem", async () => {
    const { usuario, getByLabelText, getByRole, queryByRole } = montar();
    const nome = getByLabelText(/^Nome/) as HTMLInputElement;
    await usuario.type(nome, "!");

    await usuario.click(getByRole("button", { name: "Descartar" }));
    expect(getByRole("button", { name: "Descartar mesmo" })).toBeTruthy();
    await usuario.click(getByRole("button", { name: "Descartar mesmo" }));

    expect(nome.value).toBe(PRODUTO.name);
    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
  });
});

describe("R6 — preço e estoque nunca com autosave", () => {
  it("digitar preço não grava nada", async () => {
    const { usuario, getByLabelText } = montar();
    const preco = getByLabelText(/^Preço/);
    await usuario.clear(preco);
    await usuario.type(preco, "5,90");
    // E sair do campo, que é onde um autosave por `onBlur` dispararia.
    await usuario.tab();

    expect(salvarProduto).not.toHaveBeenCalled();
    expect(ajustarEstoque).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * AS TRÊS ROTAS
 * ══════════════════════════════════════════════════════════════════════════ */

describe("o estoque tem rota própria", () => {
  /**
   * "Não reenvie o formulário inteiro por multipart só para ajustar estoque" —
   * foi por esse caminho que as medidas do pacote eram apagadas. O botão usa o
   * `PATCH`, e nada mais é escrito.
   */
  it("salva sozinho, sem passar pelo PUT do catálogo", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    const estoque = getByLabelText(/^Estoque/);
    await usuario.clear(estoque);
    await usuario.type(estoque, "30");
    await usuario.click(getByRole("button", { name: "Salvar só o estoque" }));

    expect(ajustarEstoque).toHaveBeenCalledWith(PRODUTO.product_id, 30);
    expect(salvarProduto).not.toHaveBeenCalled();
  });

  /** Salvo pela rota própria, o campo deixa de estar pendente — senão a barra
   *  continuaria dizendo que há alteração e o `PUT` reescreveria o mesmo
   *  número. */
  it("depois de salvo, o formulário deixa de estar sujo", async () => {
    const { usuario, getByLabelText, getByRole, queryByRole } = montar();
    const estoque = getByLabelText(/^Estoque/);
    await usuario.clear(estoque);
    await usuario.type(estoque, "30");
    await usuario.click(getByRole("button", { name: "Salvar só o estoque" }));

    expect(queryByRole("button", { name: "Salvar" })).toBeNull();
  });
});

describe("o custo tem rota própria", () => {
  it("chega pela rota admin e calcula a margem sobre o preço do formulário", () => {
    const { getByText } = montar();
    // 59,90 − 24,00 = 35,90, que é 59,9% de 59,90.
    // O ESPAÇO AQUI É COMUM, e não o duro que o `Intl` produz: o normalizador
    // padrão do testing-library colapsa espaço em branco (que em JS inclui o
    // U+00A0) num espaço só antes de comparar. Escrever o duro faria o teste
    // falhar por um caractere que já não está lá na hora da comparação.
    expect(getByText(/R\$ 35,90/)).toBeTruthy();
  });

  it("salva sozinho, sem tocar no catálogo", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    const custo = getByLabelText(/^Custo \(R\$\)/);
    await usuario.clear(custo);
    await usuario.type(custo, "30");
    await usuario.click(getByRole("button", { name: "Salvar custo" }));

    expect(salvarCusto).toHaveBeenCalledWith(PRODUTO.product_id, "30");
    expect(salvarProduto).not.toHaveBeenCalled();
  });

  /**
   * `RETURNING *` responde 42501 nesta tabela até para a admin, e a rota pode
   * falhar por isso. Um "R$ 0,00" no lugar de "não consegui perguntar" viraria
   * uma decisão de margem tomada sobre um número inventado.
   */
  it("falhando, mostra a frase do servidor e não inventa um número", () => {
    const { getByRole, queryByLabelText } = montar({
      custoInicial: null,
      erroDoCusto: "Sua conta não tem permissão para isto.",
    });
    expect(getByRole("alert").textContent).toContain("não tem permissão");
    expect(queryByLabelText(/^Custo \(R\$\)/)).toBeNull();
  });

  /** Custo zero é o DEFAULT da coluna, ou seja "nunca foi informado". Um "100%
   *  de margem" ali seria uma afirmação inventada a partir da ausência. */
  it("custo zero não vira 100% de margem", () => {
    const { getByText } = montar({ custoInicial: { ...CUSTO, custo: "0.00" } });
    expect(getByText(/Informe custo e preço maiores que zero/)).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * O SKU, A IMAGEM E AS ABAS HONESTAS
 * ══════════════════════════════════════════════════════════════════════════ */

describe("o SKU", () => {
  /**
   * SKU vazio no corpo vira NULL na coluna, e SKU nulo tira o café da vitrine —
   * `repositorio.ts` casa por SKU e descarta quem não tem. Apagar o campo sem
   * querer e salvar não pode tirar o produto da loja.
   */
  it("apagado, não é enviado — omitir preserva, mandar vazio apagaria", async () => {
    const { usuario, getByLabelText, getByRole } = montar();
    await usuario.clear(getByLabelText(/^SKU/));
    await usuario.click(getByRole("button", { name: "Salvar" }));

    expect(corpoEnviado()).not.toHaveProperty("sku");
  });

  it("a ajuda do campo diz as duas coisas invisíveis", () => {
    const { getByText } = montar();
    expect(getByText(/não aparece na loja sem SKU/)).toBeTruthy();
    expect(getByText(/mantém o SKU de hoje/)).toBeTruthy();
  });
});

describe("a imagem", () => {
  /**
   * A RECUSA ACONTECE ANTES DE O ARQUIVO SAIR DA MÁQUINA. O backend já sabe
   * falar, mas mandar 40 MB para receber a recusa dois minutos depois é a pior
   * forma de descobrir um limite. A frase é a MESMA do servidor.
   */
  /**
   * `fireEvent` E NÃO `usuario.upload` NESTE CASO, e a diferença é informativa:
   * `userEvent.upload` RESPEITA o atributo `accept` do input e simplesmente não
   * entrega o arquivo recusado — que é o comportamento do diálogo do sistema
   * operacional, e a PRIMEIRA cerca. Esta validação é a SEGUNDA, e ela existe
   * porque `accept` é uma dica: arrastar e soltar, colar, e um navegador que a
   * ignore passam por cima dele. Para exercitar a segunda cerca é preciso
   * entregar o arquivo direto ao evento.
   */
  it("recusa o formato errado na hora, com a frase do servidor", async () => {
    const { getByLabelText, findByText } = montar({ abaInicial: "conteudo" });
    const campo = getByLabelText("Foto") as HTMLInputElement;
    const arquivo = new File(["x"], "foto.heic", { type: "image/heic" });

    fireEvent.change(campo, { target: { files: [arquivo] } });

    expect(
      await findByText("Formato não aceito. Envie JPG, PNG, WebP ou AVIF."),
    ).toBeTruthy();
  });

  /** O tamanho é a outra metade, e ele passa pelo `accept`: um PNG de 40 MB
   *  chega ao campo e só seria recusado dois minutos depois, pelo servidor. */
  it("recusa acima de 5 MB antes de o arquivo sair da máquina", async () => {
    const { usuario, getByLabelText, findByText } = montar({ abaInicial: "conteudo" });
    const grande = new File(["x"], "foto.png", { type: "image/png" });
    Object.defineProperty(grande, "size", { value: 6 * 1024 * 1024 });

    await usuario.upload(getByLabelText("Foto") as HTMLInputElement, grande);

    expect(await findByText(/Imagem grande demais/)).toBeTruthy();
  });

  it("aceita o formato certo e diz o que vai subir", async () => {
    const { usuario, getByLabelText, findByText } = montar({ abaInicial: "conteudo" });
    const arquivo = new File(["x"], "foto.png", { type: "image/png" });
    await usuario.upload(getByLabelText("Foto") as HTMLInputElement, arquivo);

    expect(await findByText(/foto\.png/)).toBeTruthy();
  });

  /**
   * A MINIATURA DO CADASTRO HERDADO — o defeito que ninguém vê num teste de
   * tipo, porque os dois casos são `string`.
   *
   * `image` guarda URL da Cloudinary na maioria dos cafés e caminho relativo em
   * cadastro herdado do painel antigo. Desenhada crua, a segunda é resolvida
   * pelo navegador contra a origem do PAINEL, onde não há nada — retângulo vazio
   * na aba em que se foi justamente conferir a foto.
   */
  it("caminho relativo vira endereço da API; a URL inteira passa intacta", () => {
    const { container } = montar({
      produto: { ...PRODUTO, image: "/uploads/cafe.jpg" },
      abaInicial: "conteudo",
    });
    const foto = container.querySelector(
      'img[alt="Foto gravada hoje para este produto"]',
    ) as HTMLImageElement;
    expect(foto.getAttribute("src")).toBe(
      urlDaImagemDoPainel("/uploads/cafe.jpg"),
    );
    expect(foto.getAttribute("src")).not.toBe("/uploads/cafe.jpg");
  });

  /** O endereço CRU continua escrito ao lado: é o valor que está no banco, e é
   *  ele que se compara com o que o painel antigo mostra. */
  it("o endereço gravado continua à vista, sem prefixo", () => {
    const { getByText } = montar({
      produto: { ...PRODUTO, image: "/uploads/cafe.jpg" },
      abaInicial: "conteudo",
    });
    expect(getByText("/uploads/cafe.jpg")).toBeTruthy();
  });

  /** A ressalva vem PRIMEIRO na aba, porque ela muda o que faz sentido fazer
   *  ali: a loja não lê esta foto. */
  it("a aba de conteúdo diz que a loja não lê nada disto", async () => {
    const { usuario, getByRole } = montar({ abaInicial: "conteudo" });
    expect(getByRole("tabpanel").textContent).toContain("A loja não lê esta foto");
    await usuario.click(getByRole("tab", { name: /^Venda/ }));
  });
});

/**
 * R13 — nada é apagado, arquiva-se. Aqui as DUAS pontas são ausências, e o que
 * se testa é que elas estão explicadas: um botão de excluir que não existe sem
 * uma frase é lido como tela incompleta, e o caminho seguinte é abrir o painel
 * antigo e apagar por lá — que é exatamente o que quebra o pedido histórico.
 */
describe("R13 — arquivar, não apagar", () => {
  it("não oferece excluir, e diz por quê", () => {
    const { queryByRole, getByText } = montar();
    expect(queryByRole("button", { name: /Excluir/i })).toBeNull();
    expect(getByText(/pedidos antigos apontando para um produto/)).toBeTruthy();
  });

  /** A coluna existe desde 0034 e a loja já respeita os três estados (0038),
   *  mas o contrato do painel não projeta nem grava `estado`. */
  it("diz que arquivar ainda não tem caminho, e o que fazer enquanto isso", () => {
    const { getByText } = montar();
    expect(getByText(/não lê nem grava esse campo/)).toBeTruthy();
    expect(getByText(/zere o estoque/)).toBeTruthy();
  });

  /**
   * DIZER O QUE "ARQUIVAR" FAZ VEM ANTES DE DIZER QUE ELE NÃO EXISTE. Quem vem
   * do painel antigo chama o gesto de "excluir"; sem a definição, "arquivar" é
   * lido como um sinônimo educado de apagar — e é justamente a diferença entre
   * os dois que faz um pedido antigo continuar sabendo qual café foi vendido.
   */
  it("explica o que arquivar faz, e que é o oposto de apagar", () => {
    const { getByText } = montar();
    expect(getByText(/Arquivar tira o café da loja e guarda o cadastro/)).toBeTruthy();
    expect(getByText(/nada some do histórico/)).toBeTruthy();
  });
});

describe("as abas que dizem o que não conseguem fazer", () => {
  /** As colunas existem desde 0034, mas nem `GET` nem `PUT` as alcançam — e
   *  desenhar campos que não gravam é construir "botões que mentem". */
  it("a fiscal diz que os campos da NF-e ainda não têm rota", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("tab", { name: /Fiscal/ }));
    const painel = getByRole("tabpanel");
    expect(painel.textContent).toContain("migração 0034");
    expect(painel.textContent).toContain("NCM");
    // E diz o PORQUÊ de isso importar, que é o que faz alguém priorizar.
    expect(painel.textContent).toContain("SEFAZ");
  });

  it("a de SEO aponta para onde o texto realmente mora", async () => {
    const { usuario, getByRole } = montar();
    await usuario.click(getByRole("tab", { name: /SEO/ }));
    expect(getByRole("tabpanel").textContent).toContain("data/catalogo-canastra.json");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * O CADASTRO
 * ══════════════════════════════════════════════════════════════════════════ */

describe("o cadastro", () => {
  function novo() {
    return montar({ produto: null, custoInicial: null });
  }

  it("nasce com o botão de criar e com a caixa padrão à vista", async () => {
    const { usuario, getByRole, getByLabelText } = novo();
    expect(getByRole("button", { name: "Cadastrar produto" })).toBeTruthy();

    await usuario.click(getByRole("tab", { name: /Fiscal/ }));
    expect((getByLabelText(/^Peso \(kg\)/) as HTMLInputElement).value).toBe("0,3");
  });

  /** Custo e "salvar só o estoque" são rotas que precisam de um `:id`, e um
   *  produto que ainda não existe não tem id. */
  it("não oferece custo nem estoque avulso — as duas rotas precisam de id", () => {
    const { queryByRole, queryByLabelText } = novo();
    expect(queryByRole("button", { name: "Salvar só o estoque" })).toBeNull();
    expect(queryByLabelText(/^Custo \(R\$\)/)).toBeNull();
  });

  /** `POST /dashboard` responde 201 com `{message}` e NÃO devolve o
   *  `produto_id`: sem id não há ficha para onde ir, então a volta é a lista. */
  it("criado, volta para a lista", async () => {
    const { usuario, getByLabelText, getByRole } = novo();
    await usuario.type(getByLabelText(/^Nome/), "Micro-lote 250 g");
    await usuario.type(getByLabelText(/^Preço/), "89,90");
    await usuario.click(getByRole("button", { name: "Cadastrar produto" }));

    expect(salvarProduto).toHaveBeenCalled();
    expect((salvarProduto.mock.calls[0] as unknown as [string | null])[0]).toBeNull();
    expect(push).toHaveBeenCalledWith("/dashboard/produtos");
  });
});
