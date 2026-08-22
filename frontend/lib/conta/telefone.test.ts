import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { formatarTelefone, paraE164, paraWhatsapp } from "./telefone";

/**
 * DUAS CÓPIAS DE `paraE164`, E ESTE ARQUIVO É O CONTRATO ENTRE ELAS.
 *
 * `backend/src/utils/telefone.js` normaliza o telefone que sai para a Cloud API
 * da Meta. `frontend/lib/conta/telefone.ts` normaliza o que a pessoa digita no
 * cadastro. São a MESMA regra, e não podem ser o mesmo arquivo: o bundle do
 * Next não importa de `backend/` (nem deve — aquilo é CommonJS de servidor, com
 * `pg` e `axios` pendurados na árvore de dependências).
 *
 * Então a cópia é declarada, e o teste abaixo é o que a mantém honesta: ele
 * carrega A VERSÃO DO BACKEND DE VERDADE, por `createRequire` (Node puro, sem
 * passar pelo Vite), e compara as duas função a função, entrada a entrada.
 *
 * O MODO DE FALHA QUE ISTO IMPEDE, e ele é silencioso dos dois lados: alguém
 * afrouxa o recorte de um lado só — passa a aceitar 12 dígitos, ou para de
 * aceitar o fixo de 10 — e a loja grava um número que o bot depois recusa a
 * enviar (`enviarWhatsappDeStatus` faz `paraE164(cliente.telefone)` e sai calado
 * quando dá `null`). O cliente teria deixado o número, o carimbo de opt-in
 * estaria gravado, e nenhuma mensagem sairia nunca. Nada disso levanta erro.
 *
 * `createRequire(import.meta.url)` E NÃO `import`: o alvo é CommonJS fora da
 * raiz do Vite. Um `import` relativo para fora de `frontend/` depende do
 * `server.fs.allow` do Vite e do interop de CJS; `createRequire` é o `require`
 * do Node, que resolve por `backend/package.json` ("type": "commonjs") e não
 * tem nenhuma dessas opiniões.
 */
const exigir = createRequire(import.meta.url);
const doBackend = exigir("../../../backend/src/utils/telefone.js") as {
  paraE164: (valor: unknown) => string | null;
};

/**
 * As entradas comparadas. Inclui as sete de `backend/test/telefone.test.js`
 * (para nenhuma das duas suites cobrir um canto que a outra não cobre) e mais
 * as bordas do recorte: 9 dígitos, 12 dígitos, DDD 10 (não existe), DDD 55
 * (existe, e é o que faz o "começa com 55" ser uma heurística e não uma regra).
 */
const ENTRADAS: unknown[] = [
  "(31) 99999-0000",
  "31 99999 0000",
  "31999990000",
  "5531999990000",
  "+55 31 99999-0000",
  "3133330000",
  "  31999990000  ",
  "",
  "   ",
  null,
  undefined,
  "999",
  "31999990000999999",
  "(31) 9999-000A",
  "319999900", // 9 dígitos: curto demais
  "319999900001", // 12 dígitos: longo demais
  "1099999000", // DDD 10 não existe
  "0899999000", // DDD começando com zero
  "55999990000", // DDD 55 (Santa Maria), não é o DDI
  "5555999990000", // DDI 55 + DDD 55
  "553199990000", // sem o nono dígito, como a Cloud API às vezes devolve
];

describe("paraE164 — a cópia concorda com a do backend", () => {
  it.each(ENTRADAS.map((e) => [JSON.stringify(e), e] as const))(
    "%s dá a mesma resposta nas duas versões",
    (_rotulo, entrada) => {
      expect(paraE164(entrada)).toBe(doBackend.paraE164(entrada));
    },
  );

  it("e as duas concordam sobre algo, não sobre null em tudo", () => {
    // Sem esta linha, uma cópia que devolvesse `null` para TUDO passaria no
    // teste acima — as duas concordariam, e nenhuma funcionaria.
    expect(paraE164("(31) 99999-0000")).toBe("5531999990000");
    expect(doBackend.paraE164("(31) 99999-0000")).toBe("5531999990000");
  });
});

describe("paraWhatsapp — mais estrito que paraE164, e de propósito", () => {
  /**
   * O campo do cadastro diz "WhatsApp", e WhatsApp em telefone fixo é conta de
   * empresa com verificação por ligação — não é o que um cliente da loja
   * digita. `paraE164` continua aceitando o fixo porque ELE serve ao envio (o
   * bot manda para o que estiver gravado, inclusive em cadastro antigo); a
   * TELA é que recusa antes de gravar, quando ainda dá para corrigir.
   */
  it("aceita celular com o nono dígito, com ou sem máscara", () => {
    expect(paraWhatsapp("(31) 99999-0000")).toBe("5531999990000");
    expect(paraWhatsapp("31999990000")).toBe("5531999990000");
    expect(paraWhatsapp("+55 (31) 99999-0000")).toBe("5531999990000");
  });

  it("recusa fixo, que paraE164 aceitaria", () => {
    expect(paraE164("3133330000")).toBe("553133330000");
    expect(paraWhatsapp("3133330000")).toBeNull();
  });

  it("recusa celular antigo de oito dígitos", () => {
    // 553199990000 é um número que existiu; hoje o cadastro pede o de nove.
    expect(paraWhatsapp("553199990000")).toBeNull();
  });

  it("recusa o que não é telefone brasileiro", () => {
    expect(paraWhatsapp("")).toBeNull();
    expect(paraWhatsapp("999")).toBeNull();
    expect(paraWhatsapp("1099999000")).toBeNull();
  });
});

describe("formatarTelefone — a máscara do campo", () => {
  it("acompanha a digitação sem exigir o número inteiro", () => {
    expect(formatarTelefone("3")).toBe("3");
    expect(formatarTelefone("31")).toBe("31");
    expect(formatarTelefone("319")).toBe("(31) 9");
    expect(formatarTelefone("3199999")).toBe("(31) 9999-9");
    expect(formatarTelefone("31999990000")).toBe("(31) 99999-0000");
  });

  it("larga o DDI e o que passar de onze dígitos", () => {
    // O cliente que cola "+55 31 99999-0000" do próprio contato não pode ver o
    // campo virar "(55) 31999-99000".
    expect(formatarTelefone("+55 31 99999-0000")).toBe("(31) 99999-0000");
    expect(formatarTelefone("319999900001234")).toBe("(31) 99999-0000");
  });

  it("não confunde o DDI 55 com o DDD 55", () => {
    // Santa Maria (RS) é DDD 55: onze dígitos que COMEÇAM com 55 e não têm DDI.
    expect(formatarTelefone("55999990000")).toBe("(55) 99999-0000");
  });

  it("devolve vazio para vazio, em vez de parênteses sozinhos", () => {
    expect(formatarTelefone("")).toBe("");
    expect(formatarTelefone(null)).toBe("");
  });
});
