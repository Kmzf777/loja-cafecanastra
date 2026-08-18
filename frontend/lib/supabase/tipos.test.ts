import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ItemParaFundir, Tabelas } from "./tipos";

/**
 * Este arquivo é, quase todo, um teste de COMPILAÇÃO.
 *
 * As asserções que importam são os `@ts-expect-error` abaixo: cada um falha o
 * `tsc --noEmit` se o erro que ele espera DEIXAR de acontecer. Ou seja, se
 * alguém afrouxar `tipos.ts` para `Json` ou para `any`, o build fica vermelho
 * aqui — que é o único jeito de um tipo se defender.
 *
 * O corpo nunca roda: `verificacoes()` não é chamada. Não há rede, não há
 * cliente de verdade, e não precisa haver — o que se afirma é o formato.
 */

type Cliente = SupabaseClient<Database, "canastra">;

async function verificacoes(supabase: Cliente) {
  /**
   * O ERRO QUE ESTE ARQUIVO INTEIRO EXISTE PARA PEGAR.
   *
   * `ItemDaSacola` do localStorage está em inglês. Mandado cru para a RPC, o
   * `produto_id` chega nulo em todo item, o filtro de 0007 descarta todos, e a
   * sacola do cliente some no login — sem erro, sem log, sem 400.
   */
  await supabase.rpc("fundir_sacola", {
    // @ts-expect-error chaves em inglês: é o bug que custaria a sacola inteira
    itens: [{ product_id: "abc", quantity: 2, price: 10, name: "Café" }],
  });

  // Faltando `quantidade`, que é um dos dois campos que a RPC filtra.
  // @ts-expect-error
  await supabase.rpc("fundir_sacola", { itens: [{ produto_id: "abc" }] });

  // A forma certa compila.
  await supabase.rpc("fundir_sacola", {
    itens: [{ produto_id: "abc", quantidade: 2, moagem: "média" }],
  });

  // `garantir_cliente`: `nome` é obrigatório, os outros dois têm DEFAULT NULL.
  await supabase.rpc("garantir_cliente", { nome: "Ana" });
  await supabase.rpc("garantir_cliente", { nome: "Ana", telefone: "31999" });
  // @ts-expect-error `nome` não é opcional em 0008
  await supabase.rpc("garantir_cliente", { telefone: "31999" });

  // @ts-expect-error tabela que não existe no schema
  await supabase.from("cafes").select("*");

  /**
   * COLUNA ERRADA NÃO ERRA NA CHAMADA — apurado aqui, contra a expectativa.
   *
   * O postgrest-js não recusa `.select("coluna_que_nao_existe")` no ponto da
   * chamada: ele coloca o erro DENTRO do tipo do resultado, como
   * `SelectQueryError<"column 'x' does not exist on 'y'.">[]`. Só quem USA o
   * `data` sente. Um `@ts-expect-error` sobre a chamada, que era a forma óbvia
   * de escrever isto, falhava com "Unused '@ts-expect-error' directive" e teria
   * dado a impressão contrária à verdade.
   *
   * Consequência prática para as Tarefas 3 e 4: um `.select()` com coluna
   * errada seguido de `if (error) return` passa despercebido. A proteção só
   * aparece ao atribuir o `data` a alguma coisa, que é o que se faz abaixo.
   */
  const itens = await supabase.from("carrinho_itens").select("nome_do_produto");
  // @ts-expect-error o data virou SelectQueryError, não uma linha de verdade
  const primeiro: Tabelas<"carrinho_itens"> | undefined = itens.data?.[0];
  void primeiro;

  /**
   * `custo` está em `produtos` e NÃO em `produtos_publicos` — a view existe
   * exatamente para esconder essa coluna da chave anônima. Se isto parar de
   * falhar, a fronteira de privacidade de 0003 foi afrouxada nos tipos.
   */
  const publicos = await supabase.from("produtos_publicos").select("custo");
  // @ts-expect-error `custo` não é público
  const custo: number | undefined = publicos.data?.[0]?.custo;
  void custo;

  // A view é somente leitura: 0003 revoga a escrita de `authenticated`.
  // @ts-expect-error
  await supabase.from("produtos_publicos").insert({ nome: "Café" });
}

describe("tipos derivados das migrações", () => {
  /**
   * Um `Row` conferido em tempo de execução seria teatro — não há banco aqui.
   * O que dá para afirmar de verdade é a coerência entre o tipo e a coluna: a
   * atribuição abaixo só compila se `carrinho_itens` tiver exatamente estes
   * nomes, e é isso que quebra quando uma migração renomeia algo.
   */
  it("carrinho_itens tem as colunas que 0004 declara", () => {
    const item: Tabelas<"carrinho_itens"> = {
      id: "1",
      carrinho_id: "2",
      produto_id: "3",
      quantidade: 1,
      preco: 0,
      nome: null,
      imagem: null,
      tamanho: null,
      moagem: null,
    };
    expect(Object.keys(item).sort()).toEqual([
      "carrinho_id",
      "id",
      "imagem",
      "moagem",
      "nome",
      "preco",
      "produto_id",
      "quantidade",
      "tamanho",
    ]);
  });

  /**
   * O contrato de `fundir_sacola` é o mesmo conjunto de colunas que a RPC lê do
   * JSON, menos `id` e `carrinho_id`, que o banco decide. Escrito como asserção
   * porque a lista está em DOIS lugares — 0007 e `ItemParaFundir` — e nada além
   * disto liga um ao outro.
   */
  it("ItemParaFundir cobre os campos que 0007 lê do JSON", () => {
    const item: Required<ItemParaFundir> = {
      produto_id: "3",
      quantidade: 1,
      preco: 0,
      nome: null,
      imagem: null,
      tamanho: null,
      moagem: null,
    };
    expect(Object.keys(item).sort()).toEqual([
      "imagem",
      "moagem",
      "nome",
      "preco",
      "produto_id",
      "quantidade",
      "tamanho",
    ]);
  });

  /**
   * O aviso de manutenção não pode sumir numa limpeza de comentários: ele é a
   * única coisa que liga este arquivo às migrações de que ele foi derivado.
   */
  /**
   * `verificacoes()` existe para o compilador, não para o runtime — é onde
   * moram os `@ts-expect-error`. Este caso só a mantém referenciada, para que
   * ela não pareça código morto a ser apagado numa faxina.
   */
  it("as checagens de compilação existem e nunca são executadas", () => {
    expect(typeof verificacoes).toBe("function");
  });

  it("o cabeçalho avisa que o arquivo é derivado das migrações", () => {
    const fonte = readFileSync(new URL("tipos.ts", import.meta.url), "utf8");
    expect(fonte).toContain("backend/db/migrations");
    expect(fonte).toContain("QUANDO UMA MIGRAÇÃO MUDAR");
  });
});
