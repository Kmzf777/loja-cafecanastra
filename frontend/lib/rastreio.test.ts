import { describe, expect, it } from "vitest";
import {
  LIMITE_DO_CODIGO,
  RASTREAMENTO_OFICIAL,
  ehCodigoDosCorreios,
  linkDeRastreamento,
  normalizarCodigo,
} from "./rastreio";

describe("normalizarCodigo", () => {
  it("aceita o código como o painel o digita", () => {
    expect(normalizarCodigo("AA123456789BR")).toBe("AA123456789BR");
  });

  it("tolera minúscula e espaço de quem colou do WhatsApp", () => {
    expect(normalizarCodigo(" aa123456789br ")).toBe("AA123456789BR");
    expect(normalizarCodigo("AA 1234 56789 BR")).toBe("AA123456789BR");
  });

  it("preserva o hífen das transportadoras que o usam", () => {
    // A Melhor Envio despacha por Jadlog e Loggi também, e o painel aceita
    // qualquer texto em `codigo_rastreio` (não há validação de formato no
    // backend). Comer o hífen entregaria ao cliente um código que a
    // transportadora não reconhece — pior que não mostrar nada.
    expect(normalizarCodigo("10-12345678")).toBe("10-12345678");
  });

  it("sem código na URL, devolve null em vez de string vazia", () => {
    // A pessoa que abre /rastreio solta (ou o botão que perdeu o parâmetro)
    // precisa cair num estado nomeado, não numa página que parece quebrada.
    expect(normalizarCodigo(undefined)).toBeNull();
    expect(normalizarCodigo(null)).toBeNull();
    expect(normalizarCodigo("")).toBeNull();
    expect(normalizarCodigo("   ")).toBeNull();
  });

  it("de um parâmetro repetido, fica com o primeiro", () => {
    // `?codigo=a&codigo=b` não sai do botão da Meta — sai de quem monta a URL
    // à mão. O Next entrega `string[]`; escolher determinístico evita
    // renderizar "a,b" como se fosse um código.
    expect(normalizarCodigo(["AA123456789BR", "ZZ999999999BR"])).toBe(
      "AA123456789BR",
    );
    expect(normalizarCodigo([])).toBeNull();
  });

  it("descarta o que não é código — a URL é entrada de terceiro", () => {
    // A defesa REAL é o JSX escapar o texto e o `encodeURIComponent` do href;
    // esta lista branca é a camada que não depende de ninguém lembrar disso.
    // O que sobra de uma injeção é texto inerte, nunca marcação nem esquema.
    expect(normalizarCodigo("<script>alert(1)</script>")).toBe(
      "SCRIPTALERT1SCRIPT",
    );
    expect(normalizarCodigo("javascript:alert(1)")).toBe("JAVASCRIPTALERT1");
    expect(normalizarCodigo("<>\"'&")).toBeNull();
  });

  it("corta o código comprido em vez de ecoar a URL inteira", () => {
    // Sem teto, `?codigo=` com 50 kB de lixo vira 50 kB de HTML servido a
    // quem abrir o link — e um <h1> que empurra a página inteira para fora.
    const gigante = "A".repeat(500);
    expect(normalizarCodigo(gigante)).toHaveLength(LIMITE_DO_CODIGO);
  });
});

describe("ehCodigoDosCorreios", () => {
  it("reconhece o formato AA123456789BR", () => {
    expect(ehCodigoDosCorreios("AA123456789BR")).toBe(true);
    expect(ehCodigoDosCorreios("QB102030405BR")).toBe(true);
  });

  it("recusa o que não é dos Correios", () => {
    // Mandar um código da Jadlog para o rastreamento dos Correios devolve
    // "objeto não encontrado" — a página prefere dizer a verdade a produzir
    // um link que o cliente vai achar que está errado.
    expect(ehCodigoDosCorreios("10-12345678")).toBe(false);
    expect(ehCodigoDosCorreios("AA12345678BR")).toBe(false); // 8 dígitos
    expect(ehCodigoDosCorreios("AA1234567890BR")).toBe(false); // 10 dígitos
    expect(ehCodigoDosCorreios("A1123456789BR")).toBe(false);
    expect(ehCodigoDosCorreios("")).toBe(false);
  });
});

describe("linkDeRastreamento", () => {
  it("leva o código no `id`, percent-encoded", () => {
    expect(linkDeRastreamento("AA123456789BR")).toBe(
      "https://www.linkcorreios.com.br/?id=AA123456789BR",
    );
  });

  it("nenhum caractere do código escapa do valor do parâmetro", () => {
    // `normalizarCodigo` já cortaria isto antes, mas a função não confia no
    // chamador: um `&` cru aqui viraria um SEGUNDO parâmetro na URL.
    expect(linkDeRastreamento("A&b=1")).toBe(
      "https://www.linkcorreios.com.br/?id=A%26b%3D1",
    );
  });

  it("o oficial dos Correios é HTTPS e do domínio dos Correios", () => {
    // A FRONTEIRA DE RÓTULO IMPORTA, e um `[a-z.]*correios` não a respeita:
    // `www.linkcorreios.com.br` passaria por ele, e é justamente o site de
    // TERCEIRO que esta asserção existe para distinguir do oficial.
    expect(RASTREAMENTO_OFICIAL).toMatch(
      /^https:\/\/([a-z0-9-]+\.)*correios\.com\.br\//,
    );
  });
});
