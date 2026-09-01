import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { html } from "@/lib/teste/html";
import { renderizar } from "@/lib/teste/renderizar";
import { Campo } from "./Campo";

afterEach(cleanup);

const exigeArroba = (valor: string) => (valor.includes("@") ? null : "E-mail inválido.");

describe("Campo", () => {
  it("o rótulo aponta para o campo — clicar no rótulo foca o campo", () => {
    const { getByLabelText } = renderizar(<Campo rotulo="E-mail" />);
    expect(getByLabelText("E-mail").tagName).toBe("INPUT");
  });

  /* `getElementById` e nao `querySelector("#" + id)`: o `useId()` do React 18
     gera ids com dois-pontos (`:r2:`), que sao validos como ID e como alvo de
     aria-describedby, mas ilegais num seletor CSS sem escape. */
  it("a ajuda é ligada por aria-describedby, não solta ao lado", () => {
    const { getByLabelText } = renderizar(<Campo rotulo="SKU" ajuda="Código interno, sem espaços." />);
    const descrito = getByLabelText("SKU").getAttribute("aria-describedby");
    expect(descrito).toBeTruthy();
    expect(document.getElementById(descrito!)?.textContent).toBe("Código interno, sem espaços.");
  });

  it("sem erro não há aria-invalid — invalidez é estado, não decoração", () => {
    expect(html(<Campo rotulo="Nome" />)).not.toContain("aria-invalid");
  });

  it("com erro marca aria-invalid e liga a mensagem por aria-describedby", () => {
    const { getByLabelText } = renderizar(<Campo rotulo="CEP" erro="CEP não encontrado." />);
    const campo = getByLabelText("CEP");
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    const ids = (campo.getAttribute("aria-describedby") ?? "").split(" ");
    const textos = ids.map((id) => document.getElementById(id)?.textContent);
    expect(textos).toContain("CEP não encontrado.");
  });

  it("a mensagem fica AO LADO do campo, não numa lista no topo do formulário", () => {
    const saida = html(<Campo rotulo="CEP" erro="CEP não encontrado." />);
    expect(saida.indexOf("CEP não encontrado.")).toBeGreaterThan(saida.indexOf("<input"));
  });

  /**
   * A mensagem de campo NÃO é role="alert", e isso é deliberado: quem valida no
   * blur normalmente saiu do campo com Tab, e um alert dispararia por cima do
   * anúncio do rótulo do campo SEGUINTE — o leitor de tela perderia justamente
   * a informação de onde a pessoa está agora. Ligada por aria-describedby, a
   * mensagem é anunciada quando se volta ao campo. Erro que precisa interromper
   * é o de submissão, e esse é uma <Tarja tom="erro">.
   */
  it("a mensagem de campo não interrompe: nada de role=alert aqui", () => {
    expect(html(<Campo rotulo="CEP" erro="x" />)).not.toContain('role="alert"');
  });

  it("NÃO valida a cada tecla — 'e-mail inválido' na terceira letra é hostil", async () => {
    const { getByLabelText, queryByText, usuario } = renderizar(
      <Campo rotulo="E-mail" validar={exigeArroba} />,
    );
    await usuario.type(getByLabelText("E-mail"), "mar");
    expect(queryByText("E-mail inválido.")).toBeNull();
  });

  it("valida no blur, quando a pessoa terminou de escrever", async () => {
    const { getByLabelText, findByText, usuario } = renderizar(
      <Campo rotulo="E-mail" validar={exigeArroba} />,
    );
    await usuario.type(getByLabelText("E-mail"), "mar");
    await usuario.tab();
    expect(await findByText("E-mail inválido.")).toBeTruthy();
  });

  it("blur com valor válido não acusa nada", async () => {
    const { getByLabelText, queryByText, usuario } = renderizar(
      <Campo rotulo="E-mail" validar={exigeArroba} />,
    );
    await usuario.type(getByLabelText("E-mail"), "maria@canastra.com");
    await usuario.tab();
    expect(queryByText("E-mail inválido.")).toBeNull();
  });

  /**
   * Depois de acusado, o erro some ENQUANTO se digita a correção — sem esperar
   * um segundo blur. Cobrar no blur e só perdoar no blur seguinte deixa a
   * mensagem vermelha na tela durante toda a correção, e é o que faz a pessoa
   * achar que continua errado.
   */
  it("depois de acusado, o erro some ao corrigir, sem esperar novo blur", async () => {
    const { getByLabelText, findByText, queryByText, usuario } = renderizar(
      <Campo rotulo="E-mail" validar={exigeArroba} />,
    );
    const campo = getByLabelText("E-mail");
    await usuario.type(campo, "mar");
    await usuario.tab();
    expect(await findByText("E-mail inválido.")).toBeTruthy();
    await usuario.type(campo, "@canastra.com");
    expect(queryByText("E-mail inválido.")).toBeNull();
  });

  it("o erro de fora (servidor) vence o da validação local", async () => {
    const { queryByText, findByText } = renderizar(
      <Campo rotulo="E-mail" erro="Já existe uma conta com este e-mail." validar={exigeArroba} />,
    );
    expect(await findByText("Já existe uma conta com este e-mail.")).toBeTruthy();
    expect(queryByText("E-mail inválido.")).toBeNull();
  });

  it("obrigatório é marcado no HTML e sinalizado ao olho", () => {
    const saida = html(<Campo rotulo="Nome" required />);
    expect(saida).toContain("required");
    expect(saida).toContain("*");
  });

  it("o onChange e o onBlur de quem usa continuam sendo chamados", async () => {
    let mudou = 0;
    let saiu = 0;
    const { getByLabelText, usuario } = renderizar(
      <Campo
        rotulo="Nome"
        validar={exigeArroba}
        onChange={() => (mudou += 1)}
        onBlur={() => (saiu += 1)}
      />,
    );
    await usuario.type(getByLabelText("Nome"), "ab");
    await usuario.tab();
    expect(mudou).toBe(2);
    expect(saiu).toBe(1);
  });

  it("dois campos na mesma tela não compartilham id", () => {
    const { getByLabelText } = renderizar(
      <>
        <Campo rotulo="Nome" />
        <Campo rotulo="Sobrenome" />
      </>,
    );
    expect(getByLabelText("Nome").id).not.toBe(getByLabelText("Sobrenome").id);
  });
});
