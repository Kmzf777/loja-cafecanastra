import type { ProdutoDoPainel } from "./produtos.logica";

/**
 * A DECISÃO da FICHA de produto — validação, montagem de payload e derivação de
 * estado, sem React e sem fetch (spec §2.8).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA MAIS IMPORTANTE DESTE ARQUIVO, e ela é contraintuitiva:
 * **`PUT /dashboard/:id` NÃO É PARCIAL.**
 *
 * O `UPDATE` do `dashboardRepository` escreve DOZE colunas com o que veio no
 * corpo, sempre. Para a maior parte delas, campo ausente NÃO é "preserva" — é
 * apagar:
 *
 *   `description` ... ausente vira `""` (o repositório faz
 *                     `corpo.description ? String(...) : ""`)
 *   `size` .......... ausente vira NULL
 *   `category` ...... ausente vira NULL
 *
 * Só três se defendem sozinhas: as quatro medidas (que caem no valor ATUAL do
 * banco, correção da Onda 4), a imagem (que cai em `atual.imagem` quando não
 * sobe arquivo) e o SKU (que só é tocado se a chave existir no corpo).
 *
 * A CONSEQUÊNCIA DE DESENHO é o oposto do instinto de "mandar só o que mudou":
 * este formulário carrega o produto INTEIRO e reenvia o produto INTEIRO. Um
 * payload parcial esperto apagaria a descrição de todo café a cada correção de
 * preço, e apagaria calado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A EXCEÇÃO É O SKU, E ELA É NO OUTRO SENTIDO: campo VAZIO não é enviado.
 *
 * SKU vazio no corpo vira NULL na coluna, e SKU nulo tira o produto da loja —
 * `lib/catalogo/repositorio.ts` casa banco e catálogo editorial por SKU e
 * DESCARTA quem não tem (`linhas.filter((p) => p.sku)`). Ou seja: apagar sem
 * querer o conteúdo desse campo e salvar tiraria o café da vitrine, e a única
 * coisa que apareceria na tela seria "Produto editado com sucesso!".
 *
 * Então o campo em branco é OMITIDO e o valor de hoje permanece. A ajuda do
 * campo diz isso; ela existe porque a omissão é invisível.
 */

/**
 * O formulário — TUDO STRING, porque é o que um `<input>` guarda.
 *
 * Converter para número na hora de digitar é o que produz o campo que não
 * aceita apagar o último dígito ("" vira 0, 0 vira "0", e o cursor briga com a
 * pessoa). A conversão acontece uma vez, na validação e na montagem do payload.
 */
export type FormularioDoProduto = {
  nome: string;
  sku: string;
  /** A EMBALAGEM. Vai no corpo como `size` — ver `produtos.logica.ts`. */
  embalagem: string;
  categoria: string;
  /** Reais, como se digita: "59,90" ou "59.90". */
  preco: string;
  estoque: string;
  descricao: string;
  /** Quilogramas. */
  peso: string;
  /** Centímetros. */
  largura: string;
  altura: string;
  comprimento: string;
};

export const FORMULARIO_VAZIO: FormularioDoProduto = {
  nome: "",
  sku: "",
  embalagem: "",
  categoria: "",
  preco: "",
  estoque: "0",
  descricao: "",
  /* O CADASTRO NOVO NASCE COM OS PADRÕES DA CAIXA VISÍVEIS, e não em branco.
     São os mesmos números que o backend aplicaria (`MEDIDAS_PADRAO`), com uma
     diferença que é o ponto inteiro desta tela: aqui eles estão NA TELA, onde
     dá para conferir e corrigir antes de salvar, em vez de serem aplicados em
     silêncio depois. */
  peso: "0,3",
  largura: "20",
  altura: "5",
  comprimento: "20",
};

/** `numeric` volta do `pg` como STRING ("59.90", "0.300"). */
function texto(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  return String(valor);
}

/**
 * O que a API devolveu, virado formulário.
 *
 * O PONTO VIRA VÍRGULA nos campos de número decimal, e isso não é enfeite: o
 * gestor lê "59.90" como cinquenta e nove e noventa **centésimos** só depois de
 * pensar, e a mesma tela que mostra R$ 59,90 na lista mostraria 59.90 no campo.
 * Duas grafias para o mesmo número na mesma tela é como se digita a errada. A
 * volta (`paraNumero`) aceita as duas.
 */
function comoDecimalBr(valor: string | number | null | undefined): string {
  const bruto = texto(valor).trim();
  if (bruto === "") return "";
  return bruto.replace(".", ",");
}

export function formularioDoProduto(produto: ProdutoDoPainel): FormularioDoProduto {
  return {
    nome: texto(produto.name),
    sku: texto(produto.sku),
    embalagem: texto(produto.size),
    categoria: texto(produto.category),
    preco: comoDecimalBr(produto.price),
    estoque: texto(produto.quantity),
    descricao: texto(produto.description),
    peso: comoDecimalBr(produto.weight),
    largura: comoDecimalBr(produto.width),
    altura: comoDecimalBr(produto.height),
    comprimento: comoDecimalBr(produto.length),
  };
}

/**
 * Texto de campo numérico → número, aceitando vírgula.
 *
 * `NaN` para o que não é número, e NUNCA `0`: `Number("")` é `0`, e um zero
 * silencioso num campo de preço publica um café de graça. É a mesma regra que
 * `reaisParaCentavos` já carrega em `lib/painel/dinheiro.ts` e que o
 * `numeroPositivo` do backend teve de aprender depois de gravar caixas de peso
 * zero.
 */
export function paraNumero(bruto: string): number {
  const t = String(bruto ?? "").trim().replace(",", ".");
  if (t === "") return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Está sujo? É o que faz a barra de salvar do R5 aparecer e sumir. */
export function estaSujo(
  base: FormularioDoProduto,
  forma: FormularioDoProduto,
): boolean {
  return (Object.keys(base) as (keyof FormularioDoProduto)[]).some(
    (campo) => base[campo] !== forma[campo],
  );
}

/** Quais campos mudaram — para a barra de salvar dizer o QUE está pendente em
 *  vez de só dizer que há algo pendente. */
export function camposMudados(
  base: FormularioDoProduto,
  forma: FormularioDoProduto,
): (keyof FormularioDoProduto)[] {
  return (Object.keys(base) as (keyof FormularioDoProduto)[]).filter(
    (campo) => base[campo] !== forma[campo],
  );
}

/**
 * As regras, ESPELHANDO AS DO SERVIDOR — `validarProduto` no
 * `dashboardRepository`.
 *
 * POR QUE ESPELHAR EM VEZ DE DEIXAR O SERVIDOR RECUSAR. Porque o servidor junta
 * todos os erros numa frase só (`erros.join(" ")`) e a devolve como uma tarja
 * no topo: "O nome do produto é obrigatório. Preço inválido." não diz QUAL
 * campo marcar, e num formulário de onze campos em quatro abas isso obriga a
 * caçar. Validado aqui, o erro nasce ao lado do campo, na aba certa.
 *
 * E O SERVIDOR CONTINUA SENDO A AUTORIDADE: a frase dele vence sempre quando
 * chega (é o que `fraseDeErro` faz). Isto é conveniência, não substituição — e
 * é por isso que os números são os mesmos, escritos por extenso no comentário
 * de cada um, para divergirem em voz alta se um dia mudarem lá.
 *
 * AS QUATRO MEDIDAS SÃO OBRIGATÓRIAS E TÊM DE SER MAIORES QUE ZERO — e aqui
 * este módulo é MAIS severo que o backend de propósito. Lá, campo em branco cai
 * no valor atual do banco (a correção da Onda 4, que é a rede de segurança para
 * clientes antigos). Aqui, campo em branco é um formulário incompleto: a tela
 * NOVA existe justamente porque a antiga mandava os quatro sem ter input para
 * nenhum. Uma caixa de 0 cm de altura também é aceita pelo backend
 * (`numeroPositivo` recusa negativo, não zero) e cotaria frete de um pacote sem
 * volume.
 */
export function validar(
  forma: FormularioDoProduto,
): Partial<Record<keyof FormularioDoProduto, string>> {
  const erros: Partial<Record<keyof FormularioDoProduto, string>> = {};

  const nome = forma.nome.trim();
  // Backend: `nome.length < 2` e `nome.length > 200`.
  if (nome.length < 2) erros.nome = "O nome precisa ter pelo menos 2 caracteres.";
  else if (nome.length > 200) erros.nome = "O nome passa de 200 caracteres.";

  const preco = paraNumero(forma.preco);
  // Backend: finito, não negativo, no máximo 1.000.000.
  if (Number.isNaN(preco)) erros.preco = "Informe o preço em reais.";
  else if (preco < 0) erros.preco = "O preço não pode ser negativo.";
  else if (preco > 1_000_000) erros.preco = "O preço passa do teto de R$ 1.000.000.";

  const estoque = paraNumero(forma.estoque);
  // Backend: inteiro, maior ou igual a zero.
  if (Number.isNaN(estoque)) erros.estoque = "Informe o estoque em unidades.";
  else if (!Number.isInteger(estoque)) erros.estoque = "O estoque é contado em unidades inteiras.";
  else if (estoque < 0) erros.estoque = "O estoque não pode ser negativo.";

  const medidas: {
    campo: keyof FormularioDoProduto;
    nome: string;
    unidade: string;
  }[] = [
    { campo: "peso", nome: "peso", unidade: "kg" },
    { campo: "largura", nome: "largura", unidade: "cm" },
    { campo: "altura", nome: "altura", unidade: "cm" },
    { campo: "comprimento", nome: "comprimento", unidade: "cm" },
  ];

  for (const medida of medidas) {
    const n = paraNumero(forma[medida.campo]);
    if (Number.isNaN(n)) {
      erros[medida.campo] = `Informe o ${medida.nome} em ${medida.unidade} — é ele que cota o frete.`;
    } else if (n <= 0) {
      erros[medida.campo] = `O ${medida.nome} precisa ser maior que zero.`;
    }
  }

  return erros;
}

/**
 * O corpo do `POST`/`PUT`, já resolvido — pares de texto que a casca joga num
 * `FormData`.
 *
 * TUDO VAI, MENOS O SKU VAZIO. O porquê das duas metades está no cabeçalho
 * deste arquivo: o `UPDATE` escreve doze colunas sempre (omitir apaga descrição,
 * embalagem e categoria), e o SKU é a única coluna cuja ausência preserva — e a
 * única cujo apagamento acidental tira o café da loja.
 *
 * OS NÚMEROS SAEM COM PONTO, não com a vírgula que se digita: do outro lado é
 * `Number("59,90")`, que é NaN, e NaN cai no padrão sem reclamar. A tela mostra
 * vírgula porque é assim que se lê dinheiro em português; o fio fala a língua do
 * `Number`.
 */
export function corpoDoProduto(
  forma: FormularioDoProduto,
): Record<string, string> {
  const corpo: Record<string, string> = {
    name: forma.nome.trim(),
    price: String(paraNumero(forma.preco)),
    quantity: String(paraNumero(forma.estoque)),
    // `size` e `category` vão SEMPRE, inclusive vazios: vazio aqui é a intenção
    // de limpar, e omitir teria o mesmo efeito no banco (NULL) com a diferença
    // de ser acidental em vez de escolhido.
    size: forma.embalagem.trim(),
    category: forma.categoria.trim(),
    description: forma.descricao,
    // AS QUATRO MEDIDAS, SEMPRE, COM OS VALORES REAIS. É a linha que fecha o
    // defeito medido — ver o cabeçalho de `produtos.logica.ts`.
    weight: String(paraNumero(forma.peso)),
    width: String(paraNumero(forma.largura)),
    height: String(paraNumero(forma.altura)),
    length: String(paraNumero(forma.comprimento)),
  };

  const sku = forma.sku.trim();
  if (sku) corpo.sku = sku;

  return corpo;
}

/**
 * As quatro medidas do formulário, na forma que `medidaEhOPadrao` compara.
 *
 * ELA EXISTE PARA O AVISO SER DO QUE ESTÁ NA TELA, e não do que está no banco.
 * A versão anterior comparava o produto que o servidor mandou: quem corrigisse
 * o peso continuaria lendo "as quatro medidas estão nos valores padrão" com o
 * campo já corrigido à frente, até salvar e recarregar. Um aviso que não
 * acompanha a correção ensina a ignorar o aviso.
 */
export function medidasDaForma(forma: FormularioDoProduto): {
  weight: number;
  width: number;
  height: number;
  length: number;
} {
  return {
    weight: paraNumero(forma.peso),
    width: paraNumero(forma.largura),
    height: paraNumero(forma.altura),
    length: paraNumero(forma.comprimento),
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * A IMAGEM — validada AQUI, antes de subir
 * ────────────────────────────────────────────────────────────────────────── */

/** 5 MB por arquivo — o mesmo `LIMITE_DE_TAMANHO_BYTES` de
 *  `backend/src/middleware/erroDeUpload.js`. */
export const LIMITE_DE_IMAGEM_BYTES = 5 * 1024 * 1024;

/** Os quatro formatos do `fileFilter` do multer e do `allowed_formats` da
 *  Cloudinary — as duas cercas já divergiram uma vez (AVIF passava no filtro e
 *  morria na Cloudinary), e esta é a terceira cópia. */
export const TIPOS_DE_IMAGEM = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

/**
 * A recusa da imagem, ANTES de ela subir — e o backend continua recusando.
 *
 * O BACKEND JÁ SABE FALAR (a Onda 4 traduziu o `MulterError` para 400 com
 * frase: "Imagem grande demais. O limite é 5 MB por arquivo."). Mesmo assim a
 * conferência acontece aqui, e a razão é o TEMPO: mandar 40 MB por uma conexão
 * de escritório para receber a recusa dois minutos depois é a pior forma de
 * descobrir um limite. A mensagem imediata vale mais que a do servidor, e o
 * arquivo nem sai da máquina.
 *
 * O MIMETYPE É DECLARADO PELO CLIENTE, e este módulo sabe disso: um `.exe`
 * renomeado para `.png` passa daqui. A garantia real é a Cloudinary, que recusa
 * o que não souber decodificar — como o próprio `multer.js` do backend escreve.
 * Isto é ergonomia, não segurança, e o comentário existe para ninguém confundir
 * as duas.
 */
export function recusaDaImagem(arquivo: { size: number; type: string }): string | null {
  if (!(TIPOS_DE_IMAGEM as readonly string[]).includes(arquivo.type)) {
    // A MESMA FRASE DO SERVIDOR, palavra por palavra. Duas redações para a
    // mesma recusa fazem o gestor achar que são dois problemas.
    return "Formato não aceito. Envie JPG, PNG, WebP ou AVIF.";
  }
  if (arquivo.size > LIMITE_DE_IMAGEM_BYTES) {
    return `Imagem grande demais. O limite é ${LIMITE_DE_IMAGEM_BYTES / (1024 * 1024)} MB por arquivo.`;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * O CUSTO — rota própria, e por quê
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * O que `GET /admin/produtos/:id/custo` devolve.
 *
 * ELE NÃO VEM PELO CAMINHO NORMAL, e a razão é de privilégio, não de arrumação.
 * `canastra.produtos` é a única relação do schema com `GRANT SELECT` por
 * COLUNA (0006): `custo` ficou de fora da lista porque a instância Supabase é
 * COMPARTILHADA, e dar a coluna a `authenticated` entregaria a margem da loja a
 * qualquer token da VPS — inclusive de outro projeto. O efeito colateral é que
 * `RETURNING *` responde **42501 até para a admin** nesta tabela, porque
 * privilégio de coluna é por PAPEL e a admin autentica como `authenticated`
 * igual a todo mundo.
 *
 * Por isso a rota admin no Express, que conecta como DONO do banco, com
 * `isAuthenticated + isAdmin` fazendo o porteiro. Não se tenta ler `custo` pelo
 * `GET /dashboard/:id`: lá ele nem está na projeção.
 *
 * `custo` VEM COMO STRING DE REAIS, como `price` — `numeric(10,2)` pelo driver
 * do `pg`.
 */
export type CustoDoProduto = {
  product_id: string;
  sku: string | null;
  name: string;
  price: string | number;
  custo: string | number;
};

/** O teto do backend em `atualizarCusto`: reais, não negativo, até 1.000.000. */
export function recusaDoCusto(bruto: string): string | null {
  const n = paraNumero(bruto);
  if (Number.isNaN(n)) return "Informe o custo em reais.";
  if (n < 0) return "O custo não pode ser negativo.";
  if (n > 1_000_000) return "O custo passa do teto de R$ 1.000.000.";
  return null;
}

/**
 * A margem, em reais e em pontos percentuais — a pergunta que se faz olhando
 * para o custo.
 *
 * `null` QUANDO NÃO DÁ PARA RESPONDER, e há dois casos diferentes que caem no
 * mesmo `null` de propósito: custo zero (o padrão da coluna, ou seja "nunca foi
 * informado") e preço zero. Nos dois, um "100% de margem" seria uma afirmação
 * inventada a partir da ausência de dado — e margem é número de decisão.
 */
export function margem(
  precoReais: string | number,
  custoReais: string | number,
): { reais: number; percentual: number } | null {
  const preco = Number(precoReais);
  const custo = Number(custoReais);
  if (!Number.isFinite(preco) || !Number.isFinite(custo)) return null;
  if (preco <= 0 || custo <= 0) return null;
  return {
    reais: preco - custo,
    percentual: ((preco - custo) / preco) * 100,
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * AS QUATRO ABAS
 * ────────────────────────────────────────────────────────────────────────── */

export type AbaDaFicha = "venda" | "conteudo" | "fiscal" | "seo";

/**
 * As abas, na ordem em que se trabalha: primeiro o que decide a venda, depois o
 * que a descreve, depois o que a nota exige, por último o que o buscador lê.
 *
 * A ABA VIVE NA URL (`?aba=`) e não em `useState`, pela mesma razão de todo o
 * resto do painel: mandar a alguém o link da aba fiscal de um café é como se
 * pede ajuda, e o F5 no meio de um cadastro não pode devolver a pessoa à
 * primeira aba. É R2 aplicado dentro de uma ficha.
 */
export const ABAS: { chave: AbaDaFicha; rotulo: string }[] = [
  { chave: "venda", rotulo: "Venda" },
  { chave: "conteudo", rotulo: "Conteúdo" },
  { chave: "fiscal", rotulo: "Fiscal" },
  { chave: "seo", rotulo: "SEO" },
];

export function lerAba(bruto: string | string[] | undefined): AbaDaFicha {
  const texto = typeof bruto === "string" ? bruto : "";
  const achada = ABAS.find((a) => a.chave === texto);
  return achada ? achada.chave : "venda";
}

/**
 * Em qual aba mora cada campo.
 *
 * A TABELA EXISTE PARA A ABA PODER AVISAR. Um formulário de onze campos em
 * quatro abas tem um modo de falha próprio e cruel: o gestor clica em Salvar, a
 * tarja diz "confira os campos marcados", e o campo marcado está numa aba
 * FECHADA — nada na tela muda, e ele clica de novo até desistir. Com este mapa,
 * a aba errada ganha um marcador e o salvamento pula para ela.
 *
 * AS QUATRO MEDIDAS ESTÃO EM "FISCAL" e não em "Venda", e a escolha é do
 * trabalho, não da taxonomia: é na aba fiscal que se procura peso, porque é
 * dela que saem a nota e a etiqueta dos Correios. Na aba de venda elas
 * roubariam a atenção de preço e estoque, que é o que se abre a ficha para
 * mexer.
 */
export const ABA_DO_CAMPO: Record<keyof FormularioDoProduto, AbaDaFicha> = {
  nome: "venda",
  sku: "venda",
  embalagem: "venda",
  categoria: "venda",
  preco: "venda",
  estoque: "venda",
  descricao: "conteudo",
  peso: "fiscal",
  largura: "fiscal",
  altura: "fiscal",
  comprimento: "fiscal",
};

/** As abas que têm campo com erro — para o marcador e para o salto do submit. */
export function abasComErro(
  erros: Partial<Record<keyof FormularioDoProduto, string>>,
): AbaDaFicha[] {
  const abas = new Set<AbaDaFicha>();
  for (const campo of Object.keys(erros) as (keyof FormularioDoProduto)[]) {
    if (erros[campo]) abas.add(ABA_DO_CAMPO[campo]);
  }
  // A ORDEM É A DAS ABAS, não a de inserção: o salto do submit usa o primeiro
  // desta lista, e "o primeiro" tem de ser o mais à esquerda na tela — senão a
  // pessoa é levada para a terceira aba tendo um erro na primeira.
  return ABAS.map((a) => a.chave).filter((chave) => abas.has(chave));
}

/** As abas com alteração pendente — o `•` que diz onde está o trabalho. */
export function abasComMudanca(
  base: FormularioDoProduto,
  forma: FormularioDoProduto,
): AbaDaFicha[] {
  const abas = new Set(camposMudados(base, forma).map((campo) => ABA_DO_CAMPO[campo]));
  return ABAS.map((a) => a.chave).filter((chave) => abas.has(chave));
}
