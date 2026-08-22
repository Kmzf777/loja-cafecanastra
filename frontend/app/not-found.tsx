import { listarLotes } from "@/lib/catalogo/repositorio";
import type { Lote } from "@/lib/catalogo/tipos";
import { PaginaNaoEncontrada } from "@/components/catalogo/PaginaNaoEncontrada";
import { LOCALE_PADRAO } from "@/lib/i18n/tipos";
import { MolduraDaLoja } from "./moldura-da-loja";

/**
 * A REDE DE BAIXO: o 404 de um endereço que não casou com rota NENHUMA.
 *
 * ESTE ARQUIVO NÃO PODE TOCAR API DINÂMICA, E O PREÇO DISSO FOI MEDIDO.
 *
 * Um `not-found.tsx` de raiz é renderizado dentro do layout raiz, e o Next
 * precisa prerenderizá-lo para montar a casca estática de qualquer página. Se
 * ele chama `headers()`, `cookies()` ou `connection()`, o bail-out sobe pela
 * árvore e o site INTEIRO deixa de ser gerado no build. Medido nesta árvore,
 * com o mesmo commit, trocando só a existência deste arquivo:
 *
 *     com `connection()` aqui ....  4 rotas estáticas,  0 HTML em disco
 *     sem este arquivo ..........  51 rotas estáticas, 47 HTML em disco
 *
 * Levava junto `/checkout`, `/sacola` e as páginas de conta, que eram
 * estáticas, e as 51 da vitrine nos três idiomas. Build verde, 807 testes
 * verdes, `tsc` limpo — e o site inteiro renderizando sob demanda. É a mesma
 * classe de defeito que `[locale]/(vitrine)/paginas-estaticas.test.ts` já
 * existe para impedir, e por isso ele ganhou um caso para este arquivo.
 *
 * QUE CASOS SOBRAM PARA CÁ, depois que a PDP voltou a `dynamicParams = true`:
 * só endereço que não casa com rota nenhuma — `/pagina-que-nao-existe`,
 * `/en/qualquer-coisa`. O 404 de café inválido, que é o linkável e o que se
 * digita errado, é atendido por `[locale]/(vitrine)/cafes/[slug]/not-found.tsx`,
 * DENTRO do layout do `[locale]` e portanto com a moldura no idioma certo.
 *
 * A MOLDURA AQUI SAI EM `pt`, E ISSO É O QUE SOBRA DE HONESTO.
 * `<MolduraDaLoja>` é Server Component e precisa do idioma para montar
 * cabeçalho e rodapé; este arquivo vive FORA do segmento `[locale]` e não
 * recebe `params`. O middleware chegou a carregar o caminho num cabeçalho de
 * requisição para resolver isso — funcionava, e foi essa leitura que derrubou
 * a estática. Entre "menu em português numa página de erro" e "site inteiro
 * sem geração estática", a escolha não é difícil. O CORPO da tela continua
 * acertando o idioma: `<PaginaNaoEncontrada>` lê a URL no cliente, e os links
 * que ela emite (`/cafes`, `/clube`) são os canônicos, que o middleware serve
 * para visitante de qualquer idioma. Nenhum link morre.
 */
export default async function NaoEncontrado() {
  /**
   * As sugestões são o convite do §11 — "tela vazia é convite" — e vêm do
   * catálogo com estoque, resolvidas no BUILD. Antes eram lidas por
   * requisição; agora que a página é estática, elas são as do build, o que
   * está certo para uma tela de erro: nenhum 404 precisa de estoque ao vivo, e
   * a alternativa custava a estática do site inteiro.
   *
   * O `try` NÃO É CERIMÔNIA: esta é a tela que responde quando tudo o mais
   * falhou, e `listarLotes` fala com a API. Se ela cair durante o build, um
   * throw aqui derrubaria a compilação inteira por causa da página de erro.
   * Sem lotes a tela perde a grade e mantém as três saídas, que é a parte que
   * importa.
   */
  let sugestoes: Lote[];
  try {
    sugestoes = (await listarLotes({ soDisponiveis: true }, "relevancia")).slice(
      0,
      4,
    );
  } catch (erro) {
    console.error("[404] não foi possível listar sugestões:", erro);
    sugestoes = [];
  }

  return (
    <MolduraDaLoja locale={LOCALE_PADRAO}>
      <PaginaNaoEncontrada sugestoes={sugestoes} />
    </MolduraDaLoja>
  );
}
