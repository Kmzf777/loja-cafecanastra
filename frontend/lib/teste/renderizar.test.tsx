import { describe, it, expect } from "vitest";
import { useState } from "react";
import { renderizar } from "./renderizar";

function Contador() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>cliques: {n}</button>;
}

describe("renderizar", () => {
  it("monta num DOM de verdade e o clique roda o efeito", async () => {
    const { getByRole, usuario } = renderizar(<Contador />);
    const botao = getByRole("button");
    expect(botao.textContent).toBe("cliques: 0");
    await usuario.click(botao);
    expect(botao.textContent).toBe("cliques: 1");
  });
});

