import { describe, it, expect } from "vitest";

import {
  CAMPOS_ESPERADOS,
  INTERRUPTORES,
  TONS,
  corpoDaConfig,
  descreverNumero,
  descreverSegredo,
  descreverStatus,
  descreverTemplate,
  fraseDeErro,
  oQueFalta,
  precisaDeAtencao,
  rotuloDeEnvio,
} from "./whatsappContrato";

/**
 * A tela do WhatsApp é JSX e não tem teste de render (o painel legado inteiro
 * morre na F6, e esta casa não tem `@testing-library`). O que se testa aqui é
 * o miolo que decide o que o gestor LÊ — e cujas falhas são todas silenciosas
 * na tela e caras fora dela:
 *
 *   - reclassificação escondida .... a Meta muda o template de utilidade para
 *                                    marketing sozinha, o preço por conversa
 *                                    sobe cerca de nove vezes, e ninguém vê
 *                                    até a fatura;
 *   - rejeição sem motivo .......... "REJECTED" sem `rejected_reason` não diz
 *                                    ao gestor o que corrigir, e o aviso do
 *                                    cliente fica sem sair para sempre;
 *   - máscara virando valor ........ o formulário reenvia "••••4821" como
 *                                    token e a integração morre com um clique
 *                                    em "Salvar" — e a tela diz "salvo";
 *   - branco apagando segredo ...... o oposto: o campo vazio (que é o estado
 *                                    NORMAL desta tela, porque o GET nunca
 *                                    devolve o valor) chega como "apague".
 *
 * Nenhuma das quatro aparece em `next build`.
 */

/** O que `GET /whatsapp/config` devolve numa loja que ainda não configurou
 * nada — o estado REAL de hoje: o número de WhatsApp ainda não existe. */
const CONFIG_VAZIA = {
  ativo: false,
  phone_number_id: null,
  waba_id: null,
  numero_suporte: null,
  atualizado_em: null,
  aviso_pendente: true,
  aviso_aprovado: true,
  aviso_enviado: true,
  aviso_entregue: true,
  aviso_cancelado: true,
  aviso_reembolsado: true,
  access_token_mascara: null,
  app_secret_mascara: null,
  verify_token_mascara: null,
};

/** A mesma coisa com tudo preenchido. Repare que os segredos aparecem SÓ como
 * máscara: é a única evidência que a tela tem de que eles existem. */
const CONFIG_COMPLETA = {
  ...CONFIG_VAZIA,
  ativo: true,
  phone_number_id: "123456789012345",
  waba_id: "987654321098765",
  numero_suporte: "5531999990000",
  atualizado_em: "2026-08-22T12:00:00.000Z",
  access_token_mascara: "••••4821",
  app_secret_mascara: "••••9f0a",
  verify_token_mascara: "••••cafe",
};

/** O formulário da tela: segredos SEMPRE em branco ao abrir, porque o GET não
 * os devolve. */
const FORM_LIMPO = {
  ativo: true,
  aviso_pendente: true,
  aviso_aprovado: true,
  aviso_enviado: true,
  aviso_entregue: true,
  aviso_cancelado: true,
  aviso_reembolsado: true,
  access_token: "",
  app_secret: "",
  verify_token: "",
  phone_number_id: "123456789012345",
  waba_id: "987654321098765",
  numero_suporte: "5531999990000",
};

describe("oQueFalta", () => {
  it("lista os cinco campos em português, na ordem em que a tela os mostra", () => {
    // A ordem é a de `CAMPOS_ESPERADOS` no WhatsappController: é a mesma em
    // que o gestor preenche o formulário, de cima para baixo. Uma lista fora
    // de ordem manda ele procurar no lugar errado do painel da Meta.
    expect(oQueFalta(CONFIG_VAZIA)).toEqual([
      "Token de acesso permanente",
      "Chave secreta do app (App Secret)",
      "Token de verificação do webhook",
      "ID do número de telefone (Phone number ID)",
      "ID da conta do WhatsApp Business (WABA ID)",
    ]);
  });

  it("configuração completa não tem o que faltar", () => {
    expect(oQueFalta(CONFIG_COMPLETA)).toEqual([]);
  });

  it("é a MÁSCARA que prova que o segredo existe — o valor nunca volta", () => {
    // `null` na máscara é "não configurado"; qualquer máscara é "configurado e
    // escondido". Procurar `config.access_token` (que o GET jamais devolve)
    // faria a tela pedir para sempre um token que já está lá.
    const soOToken = { ...CONFIG_VAZIA, access_token_mascara: "••••4821" };
    expect(oQueFalta(soOToken)).not.toContain("Token de acesso permanente");
    expect(oQueFalta(soOToken)).toHaveLength(4);
  });

  it("sem configuração carregada, tudo falta — e nada quebra", () => {
    expect(oQueFalta(null)).toHaveLength(5);
    expect(oQueFalta(undefined)).toHaveLength(5);
  });

  it("`numero_suporte` NÃO é obrigatório — o bot funciona sem ele", () => {
    const semSuporte = { ...CONFIG_COMPLETA, numero_suporte: null };
    expect(oQueFalta(semSuporte)).toEqual([]);
  });
});

describe("descreverStatus", () => {
  it("faltando campo é PENDÊNCIA, não erro — e a frase nomeia o que falta", () => {
    const d = descreverStatus({
      ligado: false,
      ativo: false,
      faltando: ["access_token", "phone_number_id"],
      numero: null,
      erro: null,
      codigo: null,
    });
    expect(d.tom).toBe("pendente");
    expect(d.tom).not.toBe("erro");
    expect(d.frase).toContain("Token de acesso permanente");
    expect(d.frase).toContain("ID do número de telefone (Phone number ID)");
  });

  it("desligado com tudo preenchido é ESTADO CONHECIDO, não erro", () => {
    // `ligado` do backend é `configurado()`, que já inclui `ativo`: com a lista
    // `faltando` vazia, o único motivo de `ligado:false` é o interruptor geral.
    const d = descreverStatus({
      ligado: false,
      ativo: false,
      faltando: [],
      numero: null,
      erro: null,
      codigo: null,
    });
    expect(d.tom).toBe("desligado");
    expect(d.tom).not.toBe("erro");
    expect(d.frase).toContain("desligada");
  });

  it("a frase de erro é a DO SERVIDOR, com o código da Meta junto", () => {
    const daMeta =
      "A Meta recusou a consulta: o token de acesso expirou (190).";
    const d = descreverStatus({
      ligado: true,
      ativo: true,
      faltando: [],
      numero: null,
      erro: daMeta,
      codigo: 190,
    });
    expect(d.tom).toBe("erro");
    expect(d.frase).toContain(daMeta);
    expect(d.frase).toContain("190");
  });

  it("manda mas não recebe: `app_secret` em falta é o sintoma que não aponta para lugar nenhum", () => {
    // `ligado` só exige access_token + phone_number_id. Sem `app_secret` o
    // aviso SAI e a resposta do cliente é descartada na porta — "o cliente
    // respondeu e nada aconteceu", sem uma linha de log que explique.
    const d = descreverStatus({
      ligado: true,
      ativo: true,
      faltando: ["app_secret"],
      numero: null,
      erro: null,
      codigo: null,
    });
    expect(d.tom).toBe("atencao");
    expect(d.frase).toContain("Chave secreta do app (App Secret)");
  });

  it("tudo pronto é o único caso 'ok'", () => {
    const d = descreverStatus({
      ligado: true,
      ativo: true,
      faltando: [],
      numero: { display_phone_number: "+55 31 99999-0000" },
      erro: null,
      codigo: null,
    });
    expect(d.tom).toBe("ok");
  });

  it("sem sonda ainda, a tarja não inventa diagnóstico", () => {
    expect(descreverStatus(null).tom).toBe("neutro");
  });
});

describe("descreverTemplate", () => {
  it("rejeitado DIZ O MOTIVO — sem ele o gestor não tem o que corrigir", () => {
    const d = descreverTemplate({
      nome: "pedido_recebido",
      status: "REJECTED",
      category: "UTILITY",
      correct_category: null,
      rejected_reason: "INVALID_FORMAT",
    });
    expect(d.tom).toBe("erro");
    expect(d.rotulo).toContain("Rejeitado");
    // O motivo traduzido...
    expect(d.detalhe.toLowerCase()).toContain("formato");
    // ...e o código cru, que é o que se procura na documentação da Meta.
    expect(d.detalhe).toContain("INVALID_FORMAT");
  });

  it("motivo que não conhecemos aparece assim mesmo — nada é engolido", () => {
    const d = descreverTemplate({
      nome: "pedido_recebido",
      status: "REJECTED",
      category: "UTILITY",
      correct_category: null,
      rejected_reason: "MOTIVO_QUE_A_META_INVENTOU_ONTEM",
    });
    expect(d.detalhe).toContain("MOTIVO_QUE_A_META_INVENTOU_ONTEM");
  });

  it("rejeitado SEM motivo ainda diz o que fazer", () => {
    const d = descreverTemplate({
      nome: "pedido_recebido",
      status: "REJECTED",
      category: null,
      correct_category: null,
      rejected_reason: null,
    });
    expect(d.tom).toBe("erro");
    expect(d.detalhe.length).toBeGreaterThan(20);
  });

  it("`status: null` é 'ainda não criado' na Meta — e o aviso não sai", () => {
    const d = descreverTemplate({
      nome: "pedido_enviado_sem_rastreio",
      status: null,
      category: null,
      correct_category: null,
      rejected_reason: null,
    });
    expect(d.tom).toBe("pendente");
    expect(d.rotulo).toContain("ainda não criado");
    // 132001 é o erro que a Meta devolve quando a loja dispara um template que
    // não existe lá — é o que o gestor vai ver no histórico se não criar.
    expect(d.detalhe).toContain("132001");
  });

  it("aprovado é o estado bom, e não inventa alarme", () => {
    const d = descreverTemplate({
      nome: "pedido_recebido",
      status: "APPROVED",
      category: "UTILITY",
      correct_category: "UTILITY",
      rejected_reason: null,
    });
    expect(d.tom).toBe("ok");
    expect(d.categoria).toBeNull();
  });

  it("a reclassificação da Meta vira frase, com as duas categorias", () => {
    const d = descreverTemplate({
      nome: "pedido_recebido",
      status: "APPROVED",
      category: "UTILITY",
      correct_category: "MARKETING",
      rejected_reason: null,
    });
    expect(d.categoria).toContain("UTILITY");
    expect(d.categoria).toContain("MARKETING");
  });

  it("status que não conhecemos aparece cru em vez de virar 'desconhecido'", () => {
    const d = descreverTemplate({
      nome: "pedido_recebido",
      status: "PENDING_DELETION",
      category: null,
      correct_category: null,
      rejected_reason: null,
    });
    // No RÓTULO, que é o que se lê na lista — não escondido no detalhe.
    expect(d.rotulo).toContain("PENDING_DELETION");
  });
});

describe("precisaDeAtencao", () => {
  it("categoria diferente da correta é reclassificação pendente da Meta", () => {
    // O sinal que multiplica a fatura por ~9 e pode virar bloqueio de envio.
    expect(
      precisaDeAtencao({
        status: "APPROVED",
        category: "UTILITY",
        correct_category: "MARKETING",
      }),
    ).toBe(true);
  });

  it("categorias iguais, ou `correct_category` ausente, não são alarme", () => {
    expect(
      precisaDeAtencao({
        status: "APPROVED",
        category: "UTILITY",
        correct_category: "UTILITY",
      }),
    ).toBe(false);
    // A Meta só preenche `correct_category` quando TEM o que reclassificar.
    expect(
      precisaDeAtencao({
        status: "APPROVED",
        category: "UTILITY",
        correct_category: null,
      }),
    ).toBe(false);
    expect(
      precisaDeAtencao({
        status: null,
        category: null,
        correct_category: null,
      }),
    ).toBe(false);
    expect(precisaDeAtencao(null)).toBe(false);
  });

  it("rejeitado, pausado e desativado também pedem a mão do gestor", () => {
    for (const status of ["REJECTED", "PAUSED", "DISABLED"]) {
      expect(
        precisaDeAtencao({ status, category: "UTILITY", correct_category: "UTILITY" }),
      ).toBe(true);
    }
    expect(
      precisaDeAtencao({
        status: "PENDING",
        category: "UTILITY",
        correct_category: "UTILITY",
      }),
    ).toBe(false);
  });
});

describe("rotuloDeEnvio", () => {
  it("falhou mostra a FRASE DO SERVIDOR, com o código da Meta", () => {
    const doServidor =
      "A Meta recusou a mensagem: o template pedido_recebido não existe (132001).";
    const d = rotuloDeEnvio({
      status: "falhou",
      erro_codigo: 132001,
      erro_texto: doServidor,
    });
    expect(d.tom).toBe("erro");
    expect(d.detalhe).toContain(doServidor);
    expect(d.detalhe).toContain("132001");
  });

  it("falhou sem texto ainda diz algo útil", () => {
    const d = rotuloDeEnvio({ status: "falhou", erro_codigo: null, erro_texto: null });
    expect(d.tom).toBe("erro");
    expect(d.detalhe.length).toBeGreaterThan(10);
  });

  it("os cinco status do banco têm rótulo em português", () => {
    expect(rotuloDeEnvio({ status: "pendente" }).rotulo).toBe("Na fila");
    expect(rotuloDeEnvio({ status: "enviada" }).rotulo).toBe("Enviada");
    expect(rotuloDeEnvio({ status: "entregue" }).rotulo).toBe("Entregue");
    expect(rotuloDeEnvio({ status: "lida" }).rotulo).toBe("Lida");
    expect(rotuloDeEnvio({ status: "falhou" }).rotulo).toBe("Falhou");
  });

  it("status desconhecido aparece cru, em vez de sumir", () => {
    expect(rotuloDeEnvio({ status: "expirada" }).rotulo).toContain("expirada");
    expect(rotuloDeEnvio(null).rotulo).toBe("—");
  });
});

describe("corpoDaConfig", () => {
  it("SEGREDO EM BRANCO NÃO VAI NO CORPO — em branco é 'não mexi'", () => {
    // O caso comum desta tela: abrir, mexer num interruptor, salvar. Os três
    // campos de segredo estão vazios porque o GET nunca os devolve. Mandá-los
    // como "" (ou pior, null) mataria a integração com um clique.
    const corpo: Record<string, unknown> = corpoDaConfig(FORM_LIMPO);
    expect("access_token" in corpo).toBe(false);
    expect("app_secret" in corpo).toBe(false);
    expect("verify_token" in corpo).toBe(false);
  });

  it("A MÁSCARA NUNCA VIRA VALOR", () => {
    // Se algum dia o formulário for preenchido com o que veio do GET, o que
    // chegaria aqui é "••••4821" — e o servidor gravaria isso COMO TOKEN,
    // porque para ele é só uma string não vazia. Fica de pé aqui também.
    const corpo: Record<string, unknown> = corpoDaConfig({
      ...FORM_LIMPO,
      access_token: "••••4821",
      app_secret: "••••9f0a",
    });
    expect("access_token" in corpo).toBe(false);
    expect("app_secret" in corpo).toBe(false);
  });

  it("segredo preenchido de verdade vai, sem espaço em volta", () => {
    const corpo: Record<string, unknown> = corpoDaConfig({
      ...FORM_LIMPO,
      access_token: "  EAAG1234567890abcdef  ",
    });
    expect(corpo.access_token).toBe("EAAG1234567890abcdef");
  });

  it("os interruptores saem como BOOLEANO de verdade — '\"false\"' é 400", () => {
    // O backend recusa a string: `typeof !== "boolean"` → CAMPO_INVALIDO. E se
    // ele NÃO recusasse, "false" é truthy e LIGARIA o aviso que o gestor
    // acabou de desligar, com a tela dizendo "salvo".
    const corpo: Record<string, unknown> = corpoDaConfig({
      ...FORM_LIMPO,
      ativo: "false",
      aviso_pendente: 0,
      aviso_cancelado: undefined,
    });
    expect(typeof corpo.ativo).toBe("boolean");
    expect(corpo.aviso_pendente).toBe(false);
    expect(corpo.aviso_cancelado).toBe(false);
    for (const campo of INTERRUPTORES) {
      expect(typeof corpo[campo.chave]).toBe("boolean");
    }
  });

  it("campo VISÍVEL vazio é 'limpar' — ele volta preenchido no GET", () => {
    const corpo: Record<string, unknown> = corpoDaConfig({
      ...FORM_LIMPO,
      numero_suporte: "",
    });
    expect("numero_suporte" in corpo).toBe(true);
    expect(corpo.numero_suporte).toBe("");

    // E `null` (o que o GET devolve num campo nunca preenchido) vira a mesma
    // coisa, em vez de sumir do corpo como `undefined` — que o JSON descarta,
    // e o servidor leria como "não mexi".
    const comNulo: Record<string, unknown> = corpoDaConfig({
      ...FORM_LIMPO,
      numero_suporte: null,
    });
    expect("numero_suporte" in comNulo).toBe(true);
    expect(comNulo.numero_suporte).toBe("");
  });

  it("nada além das chaves conhecidas atravessa — nem as máscaras", () => {
    const corpo: Record<string, unknown> = corpoDaConfig({
      ...FORM_LIMPO,
      ...CONFIG_COMPLETA,
      inventado: "x",
      __proto__: { ativo: true },
    });
    expect("access_token_mascara" in corpo).toBe(false);
    expect("inventado" in corpo).toBe(false);
    expect("atualizado_em" in corpo).toBe(false);
    expect(Object.keys(corpo).sort()).toEqual(
      [
        "ativo",
        ...INTERRUPTORES.map((i) => i.chave),
        "numero_suporte",
        "phone_number_id",
        "waba_id",
      ].sort(),
    );
  });
});

describe("fraseDeErro", () => {
  it("a mensagem do servidor chega inteira — ela foi escrita para o gestor", () => {
    const daMeta =
      "A Meta recusou a criação: o corpo do template termina em variável.";
    expect(fraseDeErro(502, { error: "META_FALHOU", message: daMeta })).toBe(daMeta);
  });

  it("403, 503 e 500 são três coisas diferentes", () => {
    const f403 = fraseDeErro(403, null);
    const f503 = fraseDeErro(503, null);
    const f500 = fraseDeErro(500, null);
    expect(f403).toContain("administrador");
    expect(f503).toContain("WhatsApp");
    expect(f500).toContain("500");
    expect(new Set([f403, f503, f500]).size).toBe(3);
  });

  it("código cru não é frase: cai no fallback, que explica mais", () => {
    // `{ error: "WHATSAPP_DESLIGADO" }` sem `message` não diz nada a ninguém.
    expect(fraseDeErro(503, { error: "WHATSAPP_DESLIGADO" })).not.toBe(
      "WHATSAPP_DESLIGADO",
    );
    expect(fraseDeErro(401, null)).toContain("sessão");
  });
});

describe("descreverSegredo", () => {
  it("null é 'não configurado'; máscara é 'configurado', e a mostra", () => {
    expect(descreverSegredo(null).configurado).toBe(false);
    expect(descreverSegredo(null).frase).toContain("não");

    const cheio = descreverSegredo("••••4821");
    expect(cheio.configurado).toBe(true);
    expect(cheio.frase).toContain("••••4821");
  });
});

describe("descreverNumero", () => {
  it("sem número conectado, a tela diz o que falta — e não parece quebrada", () => {
    // É o estado REAL de hoje: o número da loja ainda não existe.
    const d = descreverNumero(null);
    expect(d.tom).toBe("pendente");
    expect(d.tom).not.toBe("erro");
    expect(d.frase.length).toBeGreaterThan(20);
  });

  it("qualidade vermelha é alarme; verde não é", () => {
    const ruim = descreverNumero({
      display_phone_number: "+55 31 99999-0000",
      verified_name: "Café Canastra",
      quality_rating: "RED",
      code_verification_status: "VERIFIED",
    });
    expect(ruim.tom).toBe("erro");
    expect(ruim.titulo).toContain("Café Canastra");

    const bom = descreverNumero({
      display_phone_number: "+55 31 99999-0000",
      verified_name: "Café Canastra",
      quality_rating: "GREEN",
      code_verification_status: "VERIFIED",
    });
    expect(bom.tom).toBe("ok");
  });
});

describe("o vocabulário da tela", () => {
  it("os cinco campos esperados são os do backend, na mesma ordem", () => {
    expect(CAMPOS_ESPERADOS.map((c) => c.chave)).toEqual([
      "access_token",
      "app_secret",
      "verify_token",
      "phone_number_id",
      "waba_id",
    ]);
    // Cada um diz ONDE achar o valor no painel da Meta — sem isso a lista de
    // pendências é um enigma.
    for (const campo of CAMPOS_ESPERADOS) {
      expect(campo.ajuda.length).toBeGreaterThan(20);
    }
  });

  it("os seis interruptores são os do banco (0017), com nome e template", () => {
    expect(INTERRUPTORES.map((i) => i.chave)).toEqual([
      "aviso_pendente",
      "aviso_aprovado",
      "aviso_enviado",
      "aviso_entregue",
      "aviso_cancelado",
      "aviso_reembolsado",
    ]);
    for (const i of INTERRUPTORES) {
      expect(i.templates.length).toBeGreaterThan(0);
    }
    // `enviado` tem DOIS templates (com e sem rastreio) e `cancelado` responde
    // por dois status da loja — a tela precisa dizer as duas coisas.
    const enviado = INTERRUPTORES.find((i) => i.chave === "aviso_enviado");
    expect(enviado?.templates).toEqual([
      "pedido_enviado",
      "pedido_enviado_sem_rastreio",
    ]);
    const cancelado = INTERRUPTORES.find((i) => i.chave === "aviso_cancelado");
    expect(cancelado?.rotulo.toLowerCase()).toContain("rejeitado");
  });

  it("todo tom devolvido cabe no conjunto que a tela sabe pintar", () => {
    const tons = [
      descreverStatus(null).tom,
      descreverStatus({ ligado: false, ativo: false, faltando: ["waba_id"] }).tom,
      descreverStatus({ ligado: false, ativo: false, faltando: [] }).tom,
      descreverStatus({ ligado: true, ativo: true, faltando: [], erro: "x" }).tom,
      descreverStatus({ ligado: true, ativo: true, faltando: ["app_secret"] }).tom,
      descreverStatus({ ligado: true, ativo: true, faltando: [] }).tom,
      descreverTemplate({ status: null }).tom,
      descreverTemplate({ status: "APPROVED" }).tom,
      descreverTemplate({ status: "PENDING" }).tom,
      descreverTemplate({ status: "REJECTED" }).tom,
      descreverTemplate({ status: "PAUSED" }).tom,
      descreverTemplate({ status: "COISA_NOVA" }).tom,
      rotuloDeEnvio(null).tom,
      rotuloDeEnvio({ status: "pendente" }).tom,
      rotuloDeEnvio({ status: "entregue" }).tom,
      rotuloDeEnvio({ status: "falhou" }).tom,
      descreverNumero(null).tom,
      descreverNumero({ quality_rating: "YELLOW" }).tom,
    ];
    for (const tom of tons) expect(TONS).toContain(tom);
  });
});
