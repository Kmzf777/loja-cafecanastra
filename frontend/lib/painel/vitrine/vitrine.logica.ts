/**
 * A DECISÃO da tela de vitrine — sem React, sem fetch, sem DOM.
 *
 * Spec §2.8: "toda tela do painel se divide em um módulo puro e uma casca JSX.
 * O módulo puro contém validação, derivação de estado, montagem de payload e
 * decisão de o que exibir. Ele é testado exaustivamente. A casca JSX só desenha
 * o que o módulo puro devolveu."
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO É LIDO PELOS DOIS LADOS DA LOJA, e isso é deliberado.
 *
 * `lib/vitrine/heroi.ts` — a home, a metade pública — importa daqui
 * `comFallback` e `imagemPermitida`. A direção parece invertida (a loja
 * dependendo do painel), e ela é a única que funciona: a PRÉVIA AO VIVO da tela
 * de vitrine só é uma prévia se resolver o valor exibido EXATAMENTE como a home
 * resolve. Duas cópias da regra "null, undefined e '' são ausência" é o mesmo
 * que uma prévia que mente — e mentira de prévia é pior que prévia nenhuma,
 * porque o gestor publica confiando nela.
 *
 * (É a lição que o repositório já pagou com o helper `html` copiado à mão em
 * vinte arquivos de teste: o custo nunca é o tamanho da cópia, é não haver um
 * nome que ligue as cópias no dia da mudança.)
 */

/** O vocabulário fechado por CHECK na migração 0030 e repetido no
 *  `backend/src/repositories/vitrineRepository.js`. Aqui ele existe para a
 *  tela não conseguir montar um corpo que o `PUT /vitrine` recusaria com 400. */
export const CHAVES_DE_TEXTO = ["heroi", "barra_aviso"] as const;
export type ChaveDeTexto = (typeof CHAVES_DE_TEXTO)[number];

/** Os mesmos três de `app/[locale]`. Lista fechada porque um 'pt-BR' gravado
 *  por engano nunca seria lido pela vitrine, que procura por 'pt'. */
export const IDIOMAS = ["pt", "en", "es"] as const;
export type IdiomaDaVitrine = (typeof IDIOMAS)[number];

export const CAMPOS_DE_HEROI = ["imagem_desktop", "imagem_mobile"] as const;
export type CampoDeHeroi = (typeof CAMPOS_DE_HEROI)[number];

export const CAMPOS_DE_TEXTO = [
  "kicker",
  "titulo",
  "texto",
  "rotulo_botao",
  "destino",
  "imagem_alt",
] as const;
export type CampoDeTexto = (typeof CAMPOS_DE_TEXTO)[number];

/** O que o `GET /vitrine` devolve: as duas chaves e os três idiomas sempre
 *  presentes, `null` onde não há linha (contrato do repositório do backend). */
export type LinhaDeTexto = Record<CampoDeTexto, string | null>;
export type RespostaDaVitrine = {
  heroi: Record<CampoDeHeroi, string | null>;
  textos: Record<ChaveDeTexto, Record<IdiomaDaVitrine, LinhaDeTexto | null>>;
};

/** O estado do formulário. Tudo `string` — nunca `null` — porque um
 *  `<input value={null}>` vira campo não-controlado e o React passa a perder o
 *  que a pessoa digita, reclamando disso só no console. */
export type FormularioDaVitrine = {
  heroi: Record<CampoDeHeroi, string>;
  textos: Record<ChaveDeTexto, Record<IdiomaDaVitrine, Record<CampoDeTexto, string>>>;
};

/** O corpo do `PUT /vitrine`: só o que mudou, em qualquer profundidade. */
export type PayloadDaVitrine = {
  heroi?: Partial<Record<CampoDeHeroi, string>>;
  textos?: Partial<
    Record<ChaveDeTexto, Partial<Record<IdiomaDaVitrine, Partial<Record<CampoDeTexto, string>>>>>
  >;
};

/** Erros indexados pelo CAMINHO do campo — ver `caminhoDoTexto`. */
export type ErrosDaVitrine = Record<string, string>;

/**
 * `""`, `"   "`, `null` e `undefined` são a MESMA COISA neste módulo: ausência.
 *
 * Ter duas representações de vazio é como todo consumidor acaba tendo de checar
 * as duas para sempre — o `vitrineRepository.js` toma a mesma decisão do lado
 * do banco, normalizando `""` para NULL na gravação. Aqui a normalização é a
 * ponta de cima da mesma regra.
 */
export function textoUtil(valor: string | null | undefined): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** O caminho de um campo do herói, que vira chave no mapa de erros. */
export function caminhoDoHeroi(campo: CampoDeHeroi): string {
  return `heroi.${campo}`;
}

/**
 * O caminho de um campo de texto.
 *
 * O mapa de erros é indexado por caminho, e não por objeto aninhado, por uma
 * razão de tela: a aba de idioma precisa saber se ALGUM campo dela falhou sem
 * percorrer estrutura — `Object.keys(erros).some(c => c.startsWith(prefixo))`.
 * Um erro escondido numa aba fechada é o jeito mais rápido de fazer o gestor
 * clicar em Salvar três vezes sem entender por que não salva.
 */
export function caminhoDoTexto(
  chave: ChaveDeTexto,
  idioma: IdiomaDaVitrine,
  campo: CampoDeTexto,
): string {
  return `textos.${chave}.${idioma}.${campo}`;
}

/** O esqueleto completo — as duas chaves, os três idiomas, todos os campos. */
export function formularioVazio(): FormularioDaVitrine {
  const heroi = {} as Record<CampoDeHeroi, string>;
  for (const campo of CAMPOS_DE_HEROI) heroi[campo] = "";

  const textos = {} as FormularioDaVitrine["textos"];
  for (const chave of CHAVES_DE_TEXTO) {
    textos[chave] = {} as Record<IdiomaDaVitrine, Record<CampoDeTexto, string>>;
    for (const idioma of IDIOMAS) {
      const linha = {} as Record<CampoDeTexto, string>;
      for (const campo of CAMPOS_DE_TEXTO) linha[campo] = "";
      textos[chave][idioma] = linha;
    }
  }

  return { heroi, textos };
}

/**
 * A resposta da API virando estado de formulário.
 *
 * PARTE DO ESQUELETO VAZIO E SÓ DEPOIS PREENCHE, em vez de copiar o que veio.
 * É o que garante que um campo desconhecido — API de outra versão, proxy que
 * injetou algo — não entre no formulário: ele voltaria no payload e o
 * `PUT /vitrine` responderia 400 ("campo desconhecido é recusa, e não algo a
 * ignorar"), derrubando um salvamento inteiro por causa de um campo que o
 * gestor nem viu.
 */
export function formularioDaResposta(
  resposta: RespostaDaVitrine | null | undefined,
): FormularioDaVitrine {
  const forma = formularioVazio();
  if (!resposta || typeof resposta !== "object") return forma;

  const heroi = resposta.heroi;
  if (heroi && typeof heroi === "object") {
    for (const campo of CAMPOS_DE_HEROI) forma.heroi[campo] = textoUtil(heroi[campo]);
  }

  const textos = resposta.textos;
  if (textos && typeof textos === "object") {
    for (const chave of CHAVES_DE_TEXTO) {
      const porIdioma = textos[chave];
      if (!porIdioma || typeof porIdioma !== "object") continue;
      for (const idioma of IDIOMAS) {
        const linha = porIdioma[idioma];
        if (!linha || typeof linha !== "object") continue;
        for (const campo of CAMPOS_DE_TEXTO) {
          forma.textos[chave][idioma][campo] = textoUtil(linha[campo]);
        }
      }
    }
  }

  return forma;
}

/**
 * O corpo do PUT — SÓ O QUE MUDOU.
 *
 * A ARMADILHA QUE ESTA FUNÇÃO EXISTE PARA DERROTAR, do lado do cliente.
 * `PUT /config` mostrou como se apaga configuração de produção sem querer: o
 * corpo chega por multipart, campo enviado vazio SOBRESCREVE, e `Number('')` é
 * `0` — que no mínimo de frete grátis desliga o frete grátis da loja inteira.
 * O gestor salva a barra de aviso e derruba a margem de todo pedido.
 *
 * O backend já se defende (campo ausente = não mexer). Esta é a segunda trava,
 * e ela não é redundante: sem ela o formulário mandaria os 38 campos a cada
 * salvamento, e um salvamento partido no meio — rede caindo, 500 do Express —
 * teria escrito muito mais do que o gestor pediu. Mandando um campo, o pior
 * caso é um campo.
 *
 * O VALOR VAI APARADO. Espaço no fim é resíduo de colar texto, não edição: se
 * contasse como mudança, a barra de salvar apareceria sozinha e o gestor
 * gravaria um título com espaço pendurado que ninguém pediu. E um campo que
 * ficou só com espaços É um campo apagado — vai como `""`, que o repositório
 * normaliza para NULL e o fallback cobre.
 */
export function montarPayload(
  inicial: FormularioDaVitrine,
  atual: FormularioDaVitrine,
): PayloadDaVitrine {
  const corpo: PayloadDaVitrine = {};

  const heroi: Partial<Record<CampoDeHeroi, string>> = {};
  for (const campo of CAMPOS_DE_HEROI) {
    const antes = textoUtil(inicial.heroi[campo]);
    const agora = textoUtil(atual.heroi[campo]);
    if (antes !== agora) heroi[campo] = agora;
  }
  if (Object.keys(heroi).length) corpo.heroi = heroi;

  const textos: NonNullable<PayloadDaVitrine["textos"]> = {};
  for (const chave of CHAVES_DE_TEXTO) {
    const porIdioma: Partial<
      Record<IdiomaDaVitrine, Partial<Record<CampoDeTexto, string>>>
    > = {};
    for (const idioma of IDIOMAS) {
      const mudados: Partial<Record<CampoDeTexto, string>> = {};
      for (const campo of CAMPOS_DE_TEXTO) {
        const antes = textoUtil(inicial.textos[chave][idioma][campo]);
        const agora = textoUtil(atual.textos[chave][idioma][campo]);
        if (antes !== agora) mudados[campo] = agora;
      }
      // Nada de `{ pt: {} }` no corpo: objeto vazio é ruído que o repositório
      // teria de aprender a ignorar, e ruído que ninguém ignora vira INSERT.
      if (Object.keys(mudados).length) porIdioma[idioma] = mudados;
    }
    if (Object.keys(porIdioma).length) textos[chave] = porIdioma;
  }
  if (Object.keys(textos).length) corpo.textos = textos;

  return corpo;
}

/**
 * Há algo para salvar? É o que faz a barra de salvar aparecer (R5).
 *
 * É `montarPayload` POR DENTRO, de propósito. Uma comparação escrita à parte
 * poderia discordar do corpo: a barra apareceria, o gestor clicaria em Salvar,
 * nada seria enviado — e ele passaria a não confiar no botão. As duas respostas
 * vêm da mesma conta ou não são a mesma pergunta.
 */
export function estaSujo(
  inicial: FormularioDaVitrine,
  atual: FormularioDaVitrine,
): boolean {
  return Object.keys(montarPayload(inicial, atual)).length > 0;
}

/**
 * O valor a exibir, campo a campo: o banco quando ele tem alguma coisa, o
 * código chumbado quando não tem.
 *
 * A REGRA DE SEGURANÇA DO §3.6 DA SPEC, ESCRITA COMO FUNÇÃO: "linha ausente,
 * coluna nula ou string vazia ⇒ a home aparece exatamente como aparece hoje".
 * Um gestor que salva o formulário pela metade não pode apagar o topo da loja.
 *
 * CAMPO A CAMPO, E NÃO BLOCO A BLOCO. Um `doBanco ?? doCodigo` no objeto
 * inteiro faria um título gravado apagar o texto que ninguém tocou — que é
 * exatamente a metade de formulário que a regra existe para cobrir.
 *
 * QUEM DEFINE A FORMA É O PISO. Um campo que o banco tem e o código não conhece
 * não pode aparecer na tela: o código é quem sabe onde cada campo é desenhado.
 */
export function comFallback<T extends Record<string, string>>(
  doBanco: Partial<Record<keyof T, string | null | undefined>> | null | undefined,
  doCodigo: T,
): T {
  const resolvido = {} as T;
  for (const chave of Object.keys(doCodigo) as (keyof T)[]) {
    const doBancoLimpo = textoUtil(doBanco ? doBanco[chave] : undefined);
    resolvido[chave] = (doBancoLimpo || doCodigo[chave]) as T[keyof T];
  }
  return resolvido;
}

/** A base inventada de `destinoDoPainel` (lib/conta/painel-servidor.ts), pelo
 *  mesmo motivo: um lugar inalcançável de onde resolver caminho relativo, para
 *  que QUALQUER coisa que escape dele mude a origem e seja pega de uma vez. */
const BASE_INTERNA = "http://interno.invalido";

/**
 * O destino de um botão: caminho interno da loja, ou endereço completo.
 *
 * A VALIDAÇÃO É POR `new URL`, E NÃO POR CASAMENTO DE TEXTO — a lição que o
 * `?de=` do painel já ensinou a este repositório: para cada grafia que se
 * proíbe existe outra que significa a mesma coisa. `//evil.com` é caminho para
 * os olhos e OUTRO SITE para o navegador; `/\evil.com` é a mesma coisa escrita
 * de um jeito que alguns navegadores seguem. Quem normaliza aqui é o mesmo
 * parser que o navegador usa.
 *
 * Aqui o estrago seria de outra natureza: o herói é a primeira coisa que a
 * home desenha, e um destino que sai do site leva o visitante para fora com a
 * credibilidade da loja emprestada.
 *
 * Vazio devolve `false` porque a pergunta é "este texto é um destino?". Quem
 * chama decide se ausência é erro — em `validar` não é, porque o piso cobre.
 */
export function ehDestinoValido(destino: string | null | undefined): boolean {
  const valor = textoUtil(destino);
  if (!valor) return false;

  if (valor.startsWith("/")) {
    try {
      return new URL(valor, BASE_INTERNA).origin === BASE_INTERNA;
    } catch {
      return false;
    }
  }

  try {
    const url = new URL(valor);
    // `javascript:` e `data:` são endereços perfeitamente válidos para o
    // parser, e nenhum dos dois é um lugar para onde mandar um cliente.
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * OS HOSTS DE IMAGEM — a terceira cópia da mesma lista, e ela é obrigatória.
 *
 * `next.config.mjs` já avisa (`:98-108`) que host de imagem são DOIS lugares
 * que mudam juntos: `images.remotePatterns` (`:157-166`) e a diretiva `img-src`
 * do CSP (`:109`). Esquecer o segundo dá imagem quebrada sem erro de servidor,
 * sem teste vermelho e sem falha de build.
 *
 * ESTA TERCEIRA CÓPIA EXISTE POR UM MOTIVO PIOR QUE IMAGEM QUEBRADA. Nesta onda
 * a imagem do herói entra por URL digitada, e `next/image` LANÇA em tempo de
 * execução para host fora de `remotePatterns` — não degrada, não avisa: derruba
 * a rota. Um endereço colado de qualquer lugar faria a home responder 500. Com
 * a lista aqui, o painel RECUSA na hora de salvar, com uma frase que diz quais
 * hosts servem, e a home ignora o que não pode desenhar.
 *
 * `vitrine.logica.test.ts` LÊ o `next.config.mjs` e compara: a cópia não
 * envelhece em silêncio.
 */
export const HOSTS_DE_IMAGEM: readonly string[] = Object.freeze([
  "res.cloudinary.com",
]);

/** A imagem é desenhável por esta loja? Arquivo do próprio site, ou host que o
 *  `next.config.mjs` libera. Ver `HOSTS_DE_IMAGEM`. */
export function imagemPermitida(valor: string | null | undefined): boolean {
  const endereco = textoUtil(valor);
  if (!endereco) return false;
  if (endereco.startsWith("/")) return ehDestinoValido(endereco);

  try {
    const url = new URL(endereco);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return HOSTS_DE_IMAGEM.includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * O que o formulário não pode salvar — e cada regra é uma coisa que o gestor
 * não teria como descobrir sozinho depois de publicar.
 *
 * O VAZIO É SEMPRE VÁLIDO, e essa é a regra que rege todas as outras: campo em
 * branco significa "use o texto de hoje", não "apague o topo da loja". Um
 * `required` aqui obrigaria a preencher os seis campos dos três idiomas antes
 * de trocar uma foto.
 *
 * A EXCEÇÃO É O ALT, E ELA SE JUSTIFICA PELO PISO. O ALT chumbado em `page.tsx`
 * descreve a foto que está lá hoje ("Cozinha mineira ao amanhecer: coador de
 * pano, caneca de ágata..."). Trocada a imagem, esse piso deixa de ser um
 * fallback e vira uma legenda ERRADA: quem usa leitor de tela ouve, com toda a
 * confiança, a descrição de uma foto que não está mais na página. Foto sem ALT
 * é a falha de acessibilidade mais comum de qualquer loja; foto com o ALT da
 * foto anterior é pior, porque nenhuma auditoria automática a encontra.
 */
export function validar(formulario: FormularioDaVitrine): ErrosDaVitrine {
  const erros: ErrosDaVitrine = {};

  let temImagem = false;
  for (const campo of CAMPOS_DE_HEROI) {
    const valor = textoUtil(formulario.heroi[campo]);
    if (!valor) continue;
    temImagem = true;
    if (!imagemPermitida(valor)) {
      erros[caminhoDoHeroi(campo)] =
        `Use um arquivo do próprio site (ex.: /imagem-banner.jpg) ou um endereço em ${HOSTS_DE_IMAGEM.join(", ")}. ` +
        "Outros endereços a loja não consegue desenhar.";
    }
  }

  for (const chave of CHAVES_DE_TEXTO) {
    for (const idioma of IDIOMAS) {
      const linha = formulario.textos[chave][idioma];

      const destino = textoUtil(linha.destino);
      if (destino && !ehDestinoValido(destino)) {
        erros[caminhoDoTexto(chave, idioma, "destino")] =
          'Use um caminho da loja começando com "/" (ex.: /cafes) ou um endereço completo com https://.';
      }

      // Rótulo sem destino é um botão que não leva a lugar nenhum — e, no
      // herói, ele SUBSTITUI o "Ver os cafés" que funcionava. O inverso
      // (destino sem rótulo) é legítimo: o rótulo tem piso, o destino também.
      if (textoUtil(linha.rotulo_botao) && !destino) {
        erros[caminhoDoTexto(chave, idioma, "rotulo_botao")] =
          "Um botão precisa de destino. Preencha o destino ou apague o rótulo.";
      }

      // O ALT é do HERÓI: a barra de aviso não tem imagem, e cobrar uma
      // descrição dela seria pedir a legenda de uma foto que não existe.
      if (chave === "heroi" && temImagem && !textoUtil(linha.imagem_alt)) {
        erros[caminhoDoTexto(chave, idioma, "imagem_alt")] =
          "Descreva a imagem nova. Sem descrição, quem usa leitor de tela ouve a legenda da foto anterior.";
      }
    }
  }

  return erros;
}

/**
 * Quais abas de idioma têm erro — e por que isto é decisão, e não desenho.
 *
 * Um erro escondido dentro de uma aba fechada é o jeito mais rápido de fazer o
 * gestor clicar em Salvar três vezes sem entender por que não salva: a tarja do
 * topo diz "corrija os campos marcados" e não há campo marcado nenhum na tela
 * que ele está vendo. A aba precisa se marcar sozinha, e quem sabe fazer essa
 * conta é este módulo — a casca JSX só desenha o marcador.
 */
export function idiomasComErro(erros: ErrosDaVitrine): IdiomaDaVitrine[] {
  return IDIOMAS.filter((idioma) =>
    CHAVES_DE_TEXTO.some((chave) =>
      CAMPOS_DE_TEXTO.some((campo) => erros[caminhoDoTexto(chave, idioma, campo)]),
    ),
  );
}

/** Quais abas de idioma têm alteração pendente. Mesma razão do irmão acima, ao
 *  contrário: o gestor precisa ver o que vai junto quando clicar em Salvar —
 *  salvar é uma operação só, e ela alcança as três abas de uma vez. */
export function idiomasComMudanca(
  inicial: FormularioDaVitrine,
  atual: FormularioDaVitrine,
): IdiomaDaVitrine[] {
  const textos = montarPayload(inicial, atual).textos ?? {};
  return IDIOMAS.filter((idioma) =>
    CHAVES_DE_TEXTO.some((chave) => textos[chave]?.[idioma]),
  );
}
