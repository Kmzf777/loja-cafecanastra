import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CAMPOS_DE_HEROI,
  CAMPOS_DE_TEXTO,
  CHAVES_DE_TEXTO,
  HOSTS_DE_IMAGEM,
  IDIOMAS,
  caminhoDoHeroi,
  caminhoDoTexto,
  comFallback,
  ehDestinoValido,
  estaSujo,
  formularioDaResposta,
  formularioVazio,
  idiomasComErro,
  idiomasComMudanca,
  imagemPermitida,
  montarPayload,
  textoUtil,
  validar,
  type FormularioDaVitrine,
} from "./vitrine.logica";

/**
 * O MÓDULO PURO DA TELA DE VITRINE — spec §2.8: "a DECISÃO vive num módulo puro
 * e é testada como função; a casca JSX só desenha".
 *
 * Quatro coisas se decidem aqui, e cada uma tem um jeito próprio de falhar em
 * silêncio:
 *
 *   montarPayload ... manda campo que ninguém tocou e APAGA o que estava lá.
 *                     É o defeito de `PUT /config` (multipart, campo vazio
 *                     sobrescreve, `Number('')` é 0) chegando pelo cliente.
 *   comFallback ..... deixa o topo da loja em branco porque uma coluna é NULL.
 *   validar ......... deixa passar foto sem ALT e destino que não existe.
 *   estaSujo ........ some com a barra de salvar, ou a mantém para sempre.
 */

/** Um formulário completo com valor previsível em cada campo. */
function preenchido(marca: string): FormularioDaVitrine {
  const forma = formularioVazio();
  for (const campo of CAMPOS_DE_HEROI) forma.heroi[campo] = `/${marca}-${campo}.jpg`;
  for (const chave of CHAVES_DE_TEXTO) {
    for (const idioma of IDIOMAS) {
      for (const campo of CAMPOS_DE_TEXTO) {
        forma.textos[chave][idioma][campo] =
          campo === "destino" ? `/${marca}` : `${marca}-${chave}-${idioma}-${campo}`;
      }
    }
  }
  return forma;
}

describe("formularioVazio / formularioDaResposta", () => {
  it("nasce com as duas chaves, os três idiomas e todos os campos", () => {
    const forma = formularioVazio();
    expect(Object.keys(forma.textos).sort()).toEqual([...CHAVES_DE_TEXTO].sort());
    for (const chave of CHAVES_DE_TEXTO) {
      expect(Object.keys(forma.textos[chave]).sort()).toEqual([...IDIOMAS].sort());
      for (const idioma of IDIOMAS) {
        expect(Object.keys(forma.textos[chave][idioma]).sort()).toEqual(
          [...CAMPOS_DE_TEXTO].sort(),
        );
      }
    }
  });

  /**
   * O contrato do `GET /vitrine` promete as duas chaves e os três idiomas, com
   * `null` onde não há linha. O formulário troca todo `null` por `""` porque um
   * `<input value={null}>` é um campo não-controlado, e o React reclama disso no
   * console e passa a perder o que a pessoa digita.
   */
  it("troca null por string vazia, campo a campo", () => {
    const forma = formularioDaResposta({
      heroi: { imagem_desktop: "/a.jpg", imagem_mobile: null },
      textos: {
        heroi: {
          pt: {
            kicker: null,
            titulo: "Café que vem de cima.",
            texto: null,
            rotulo_botao: null,
            destino: null,
            imagem_alt: null,
          },
          en: null,
          es: null,
        },
        barra_aviso: { pt: null, en: null, es: null },
      },
    });

    expect(forma.heroi).toEqual({ imagem_desktop: "/a.jpg", imagem_mobile: "" });
    expect(forma.textos.heroi.pt.titulo).toBe("Café que vem de cima.");
    expect(forma.textos.heroi.pt.kicker).toBe("");
    expect(forma.textos.heroi.en.titulo).toBe("");
    expect(forma.textos.barra_aviso.es.texto).toBe("");
  });

  /** A tela precisa desenhar mesmo com a API fora — o formulário é o esqueleto. */
  it("aceita resposta ausente sem estourar", () => {
    expect(formularioDaResposta(null)).toEqual(formularioVazio());
    expect(formularioDaResposta(undefined)).toEqual(formularioVazio());
  });

  /**
   * CAMPO DESCONHECIDO NÃO ENTRA. `PUT /vitrine` responde 400 a campo que não
   * conhece (é a decisão do `vitrineRepository.js`), então uma resposta com
   * lixo — API de outra versão, proxy que injetou algo — não pode virar campo
   * do formulário e voltar no payload derrubando o salvamento inteiro.
   */
  it("ignora campo que o contrato não tem", () => {
    const forma = formularioDaResposta({
      heroi: { imagem_desktop: null, imagem_mobile: null, banner: "x" },
      textos: {
        heroi: { pt: { title: "errado", titulo: "certo" }, en: null, es: null },
        barra_aviso: { pt: null, en: null, es: null },
      },
    } as never);
    expect(forma.textos.heroi.pt.titulo).toBe("certo");
    expect(forma.textos.heroi.pt).not.toHaveProperty("title");
    expect(forma.heroi).not.toHaveProperty("banner");
  });
});

describe("montarPayload", () => {
  it("não manda nada quando nada mudou", () => {
    const forma = preenchido("a");
    expect(montarPayload(forma, forma)).toEqual({});
  });

  /**
   * O CASO QUE ESTA FUNÇÃO EXISTE PARA IMPEDIR, e o quinto teste do backend
   * escrito do lado do cliente: salvar só o título não pode apagar o texto.
   */
  it("manda SÓ o campo tocado — salvar o título não leva o texto junto", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.heroi.pt.titulo = "Título novo";

    expect(montarPayload(inicial, atual)).toEqual({
      textos: { heroi: { pt: { titulo: "Título novo" } } },
    });
  });

  it("não inventa o container `heroi` quando só o texto mudou", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.barra_aviso.en.texto = "Free shipping this week";
    expect(montarPayload(inicial, atual)).not.toHaveProperty("heroi");
  });

  it("manda a imagem sem arrastar texto nenhum", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.heroi.imagem_desktop = "/nova.jpg";
    expect(montarPayload(inicial, atual)).toEqual({
      heroi: { imagem_desktop: "/nova.jpg" },
    });
  });

  /**
   * O outro lado da mesma moeda: sem `""` significando "apague", o gestor não
   * teria como tirar um kicker que não quer mais. O repositório normaliza `""`
   * para NULL na gravação — o comentário do `vitrineRepository.js` explica.
   */
  it("manda string vazia quando o gestor APAGA um campo que existia", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.heroi.pt.kicker = "";
    expect(montarPayload(inicial, atual)).toEqual({
      textos: { heroi: { pt: { kicker: "" } } },
    });
  });

  /**
   * Espaço em branco no fim é o resíduo de colar texto, e não uma edição. Se
   * ele contasse como mudança, a barra de salvar apareceria sozinha e o gestor
   * gravaria um título com espaço pendurado que ninguém pediu.
   */
  it("apara o espaço das pontas e não confunde isso com edição", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.heroi.pt.titulo = `  ${inicial.textos.heroi.pt.titulo}  `;
    expect(montarPayload(inicial, atual)).toEqual({});

    atual.textos.heroi.pt.titulo = "  Outro  ";
    expect(montarPayload(inicial, atual)).toEqual({
      textos: { heroi: { pt: { titulo: "Outro" } } },
    });
  });

  it("um campo só de espaços é o mesmo que apagar", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.heroi.pt.kicker = "   ";
    expect(montarPayload(inicial, atual)).toEqual({
      textos: { heroi: { pt: { kicker: "" } } },
    });
  });

  it("junta idiomas e chaves diferentes num corpo só", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.heroi.pt.titulo = "T";
    atual.textos.heroi.es.texto = "X";
    atual.textos.barra_aviso.en.texto = "Y";
    atual.heroi.imagem_mobile = "/m.jpg";

    expect(montarPayload(inicial, atual)).toEqual({
      heroi: { imagem_mobile: "/m.jpg" },
      textos: {
        heroi: { pt: { titulo: "T" }, es: { texto: "X" } },
        barra_aviso: { en: { texto: "Y" } },
      },
    });
  });

  /** Nenhuma chave de idioma vazia: `{ pt: {} }` no corpo é ruído que o
   *  repositório teria de aprender a ignorar. */
  it("não deixa objeto vazio no corpo", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.heroi.pt.titulo = "T";
    const corpo = montarPayload(inicial, atual);
    expect(Object.keys(corpo.textos ?? {})).toEqual(["heroi"]);
    expect(Object.keys(corpo.textos?.heroi ?? {})).toEqual(["pt"]);
  });
});

describe("estaSujo", () => {
  it("é falso quando o formulário está como veio", () => {
    const forma = preenchido("a");
    expect(estaSujo(forma, forma)).toBe(false);
  });

  it("é verdadeiro no primeiro campo mudado, em qualquer idioma", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.barra_aviso.es.texto = "novo";
    expect(estaSujo(inicial, atual)).toBe(true);
  });

  /**
   * A barra de salvar e o payload NÃO PODEM DISCORDAR. Se `estaSujo` dissesse
   * "sim" e `montarPayload` devolvesse `{}`, o gestor veria a barra, clicaria
   * em Salvar e nada aconteceria — e ele passaria a não confiar no botão.
   */
  it("concorda com montarPayload em todo caso", () => {
    const inicial = preenchido("a");
    const atual = preenchido("a");
    atual.textos.heroi.en.titulo = "  Coffee  ";
    expect(estaSujo(inicial, atual)).toBe(
      Object.keys(montarPayload(inicial, atual)).length > 0,
    );
    atual.textos.heroi.en.titulo = `  ${inicial.textos.heroi.en.titulo} `;
    expect(estaSujo(inicial, atual)).toBe(false);
  });
});

describe("comFallback", () => {
  const piso = { titulo: "Café que vem de cima.", texto: "Torrado sob demanda." };

  it("usa o banco quando ele tem valor", () => {
    expect(comFallback({ titulo: "Promoção", texto: "Só hoje" }, piso)).toEqual({
      titulo: "Promoção",
      texto: "Só hoje",
    });
  });

  it("cai no piso campo a campo, e não bloco a bloco", () => {
    expect(comFallback({ titulo: "Promoção" }, piso)).toEqual({
      titulo: "Promoção",
      texto: "Torrado sob demanda.",
    });
  });

  it("trata null, undefined e string vazia como ausência", () => {
    expect(comFallback({ titulo: null, texto: undefined }, piso)).toEqual(piso);
    expect(comFallback({ titulo: "", texto: "   " }, piso)).toEqual(piso);
  });

  it("cai no piso inteiro quando não há linha nenhuma", () => {
    expect(comFallback(null, piso)).toEqual(piso);
    expect(comFallback(undefined, piso)).toEqual(piso);
  });

  /** O piso é quem define a FORMA: um campo que o código não conhece não pode
   *  aparecer na tela só porque alguém o gravou no banco. */
  it("ignora campo do banco que o piso não tem", () => {
    const resolvido = comFallback({ titulo: "T", inventado: "x" } as never, piso);
    expect(resolvido).not.toHaveProperty("inventado");
  });

  it("não modifica o piso recebido", () => {
    const copia = { ...piso };
    comFallback({ titulo: "T" }, piso);
    expect(piso).toEqual(copia);
  });
});

describe("ehDestinoValido", () => {
  it("aceita caminho interno", () => {
    expect(ehDestinoValido("/cafes")).toBe(true);
    expect(ehDestinoValido("/cafes?destaque=mais-vendidos")).toBe(true);
    expect(ehDestinoValido("/")).toBe(true);
  });

  it("aceita endereço completo http e https", () => {
    expect(ehDestinoValido("https://cafecanastra.com/clube")).toBe(true);
    expect(ehDestinoValido("http://exemplo.com")).toBe(true);
  });

  /**
   * `//evil.com` é caminho para os olhos e OUTRO SITE para o navegador — o
   * mesmo vetor que `destinoDoPainel` (lib/conta/painel-servidor.ts) recusa no
   * `?de=`. Aqui ele levaria o visitante da home para fora com a credibilidade
   * da loja emprestada.
   */
  it("recusa o que parece caminho e leva para fora", () => {
    expect(ehDestinoValido("//evil.com")).toBe(false);
    expect(ehDestinoValido("/\\evil.com")).toBe(false);
  });

  it("recusa esquema que não é http(s)", () => {
    expect(ehDestinoValido("javascript:alert(1)")).toBe(false);
    expect(ehDestinoValido("data:text/html,<script>")).toBe(false);
  });

  it("recusa texto solto e endereço sem esquema", () => {
    expect(ehDestinoValido("cafes")).toBe(false);
    expect(ehDestinoValido("cafecanastra.com")).toBe(false);
    expect(ehDestinoValido("")).toBe(false);
  });
});

describe("imagemPermitida", () => {
  it("aceita arquivo do próprio site", () => {
    expect(imagemPermitida("/imagem-banner.jpg")).toBe(true);
  });

  it("aceita host liberado", () => {
    expect(imagemPermitida("https://res.cloudinary.com/x/y.jpg")).toBe(true);
  });

  /**
   * ISTO NÃO É PRECIOSISMO DE SEGURANÇA — é o que impede a home de responder
   * 500. `next/image` LANÇA em tempo de execução para host fora de
   * `images.remotePatterns`, e o herói é a primeira coisa que a home desenha:
   * um endereço colado de qualquer lugar derrubaria a loja inteira.
   */
  it("recusa host que o next.config.mjs não libera", () => {
    expect(imagemPermitida("https://i.imgur.com/x.jpg")).toBe(false);
    expect(imagemPermitida("https://evil.com/x.jpg")).toBe(false);
  });

  it("recusa o que nem endereço é", () => {
    expect(imagemPermitida("banner.jpg")).toBe(false);
    expect(imagemPermitida("//res.cloudinary.com/x.jpg")).toBe(false);
    expect(imagemPermitida("")).toBe(false);
  });

  /**
   * A LISTA É LIDA DO `next.config.mjs`, e não copiada — o próprio arquivo
   * avisa (`:98-108`) que host de imagem são DOIS lugares que mudam juntos
   * (`images.remotePatterns` e o `img-src` do CSP). Esta é a terceira cópia, e
   * a única defesa contra ela envelhecer é o teste ler a fonte.
   */
  it("a lista de hosts é a mesma do next.config.mjs", () => {
    const config = readFileSync(
      join(__dirname, "..", "..", "..", "next.config.mjs"),
      "utf8",
    );
    const remotos = [...config.matchAll(/hostname:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(remotos.length).toBeGreaterThan(0);
    expect([...HOSTS_DE_IMAGEM].sort()).toEqual(remotos.sort());
    for (const host of HOSTS_DE_IMAGEM) {
      expect(config).toContain(`https://${host}`);
    }
  });
});

describe("validar", () => {
  it("aprova o formulário vazio — o piso cuida de tudo", () => {
    expect(validar(formularioVazio())).toEqual({});
  });

  /**
   * A FALHA DE ACESSIBILIDADE MAIS COMUM DE QUALQUER LOJA, e aqui ela é pior do
   * que uma foto sem legenda: o piso chumbado em `page.tsx` descreve a foto
   * ANTIGA ("Cozinha mineira ao amanhecer: coador de pano..."). Trocar a imagem
   * sem trocar o ALT faz quem não enxerga ouvir a descrição de uma foto que não
   * está mais lá — errado com toda a confiança.
   */
  it("exige o ALT nos três idiomas quando há imagem", () => {
    const forma = formularioVazio();
    forma.heroi.imagem_desktop = "/nova.jpg";
    const erros = validar(forma);
    for (const idioma of IDIOMAS) {
      expect(erros[caminhoDoTexto("heroi", idioma, "imagem_alt")]).toBeTruthy();
    }
  });

  it("não exige ALT quando não há imagem — o piso descreve a foto do piso", () => {
    expect(validar(formularioVazio())).toEqual({});
  });

  it("aceita a imagem quando os três ALTs estão preenchidos", () => {
    const forma = formularioVazio();
    forma.heroi.imagem_mobile = "/nova.jpg";
    for (const idioma of IDIOMAS) {
      forma.textos.heroi[idioma].imagem_alt = "Saca de café no terreiro";
    }
    expect(validar(forma)).toEqual({});
  });

  it("a barra de aviso não precisa de ALT — ela não tem imagem", () => {
    const forma = formularioVazio();
    forma.heroi.imagem_desktop = "/nova.jpg";
    for (const idioma of IDIOMAS) {
      forma.textos.heroi[idioma].imagem_alt = "Descrição";
    }
    expect(validar(forma)).toEqual({});
  });

  it("recusa destino que não é caminho interno nem endereço completo", () => {
    const forma = formularioVazio();
    forma.textos.heroi.pt.destino = "cafes";
    expect(validar(forma)[caminhoDoTexto("heroi", "pt", "destino")]).toBeTruthy();
  });

  it("aceita destino vazio — o piso manda o botão para /cafes", () => {
    const forma = formularioVazio();
    forma.textos.heroi.pt.destino = "";
    expect(validar(forma)).toEqual({});
  });

  it("recusa imagem em host não liberado, com o host na frase", () => {
    const forma = formularioVazio();
    forma.heroi.imagem_desktop = "https://i.imgur.com/x.jpg";
    const erro = validar(forma)[caminhoDoHeroi("imagem_desktop")];
    expect(erro).toBeTruthy();
    expect(erro).toContain("res.cloudinary.com");
  });

  /** Um botão com rótulo e sem destino é um botão que não leva a lugar nenhum
   *  — e, no herói, ele SUBSTITUI o "Ver os cafés" que funcionava. */
  it("recusa rótulo de botão sem destino", () => {
    const forma = formularioVazio();
    forma.textos.barra_aviso.pt.rotulo_botao = "Ver os cafés";
    const erro = validar(forma)[caminhoDoTexto("barra_aviso", "pt", "rotulo_botao")];
    expect(erro).toBeTruthy();
  });

  it("aceita destino sem rótulo — o rótulo tem piso, o destino não", () => {
    const forma = formularioVazio();
    forma.textos.heroi.pt.destino = "/clube";
    expect(validar(forma)).toEqual({});
  });

  it("as chaves do erro são o caminho do campo, para a tela saber onde pintar", () => {
    expect(caminhoDoHeroi("imagem_desktop")).toBe("heroi.imagem_desktop");
    expect(caminhoDoTexto("barra_aviso", "es", "texto")).toBe(
      "textos.barra_aviso.es.texto",
    );
  });
});

describe("textoUtil", () => {
  it("é a regra de ausência num lugar só", () => {
    expect(textoUtil("  Café  ")).toBe("Café");
    expect(textoUtil("   ")).toBe("");
    expect(textoUtil("")).toBe("");
    expect(textoUtil(null)).toBe("");
    expect(textoUtil(undefined)).toBe("");
  });
});

describe("idiomasComErro / idiomasComMudanca", () => {
  it("nenhum idioma marcado quando não há erro nem alteração", () => {
    const forma = formularioVazio();
    expect(idiomasComErro(validar(forma))).toEqual([]);
    expect(idiomasComMudanca(forma, forma)).toEqual([]);
  });

  /**
   * O caso que a marcação existe para cobrir: o gestor está na aba `pt`, o erro
   * está em `es`, e sem o marcador ele clica em Salvar até desistir.
   */
  it("marca a aba do idioma que tem erro, e só ela", () => {
    const forma = formularioVazio();
    forma.textos.heroi.es.destino = "cafes";
    expect(idiomasComErro(validar(forma))).toEqual(["es"]);
  });

  it("a imagem sem ALT marca as três abas — o ALT é exigido nos três", () => {
    const forma = formularioVazio();
    forma.heroi.imagem_desktop = "/nova.jpg";
    expect(idiomasComErro(validar(forma)).sort()).toEqual(["en", "es", "pt"]);
  });

  it("marca a aba que tem alteração pendente, em qualquer das duas chaves", () => {
    const inicial = formularioVazio();
    const atual = formularioVazio();
    atual.textos.barra_aviso.en.texto = "Free shipping";
    expect(idiomasComMudanca(inicial, atual)).toEqual(["en"]);

    atual.textos.heroi.pt.titulo = "Novo";
    expect(idiomasComMudanca(inicial, atual).sort()).toEqual(["en", "pt"]);
  });

  /** A imagem é GLOBAL: ela não pertence a idioma nenhum e não pode marcar aba
   *  nenhuma, senão as três acendem por uma edição que não é delas. */
  it("a imagem do herói não marca aba de idioma", () => {
    const inicial = formularioVazio();
    const atual = formularioVazio();
    atual.heroi.imagem_desktop = "/nova.jpg";
    expect(idiomasComMudanca(inicial, atual)).toEqual([]);
  });
});
