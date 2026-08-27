"use client";

import Link from "next/link";

import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { FOCO } from "@/components/painel/ui/estilos";
import {
  ROTA_DE_DESCONTOS,
  type RegraDaLista,
} from "@/lib/painel/descontos/contrato";
import {
  NOME_DA_CLASSE,
  NOME_DA_SITUACAO,
  NOME_DO_METODO,
  TOM_DA_SITUACAO,
  codigosEmTexto,
  descontadoEmTexto,
  janelaEmTexto,
  situacaoDaRegra,
  usosEmTexto,
  valorEmTexto,
} from "@/lib/painel/descontos/lista.logica";

/**
 * A tabela de regras — e por que ela é um arquivo `"use client"` separado.
 *
 * `<Tabela>` é um primitivo de cliente e `Coluna.celula` é uma FUNÇÃO. Props de
 * Server Component para Client Component atravessam SERIALIZADAS, e função não
 * serializa: com as colunas declaradas na `page.tsx`, o React lança
 *
 *     Functions cannot be passed directly to Client Components unless you
 *     explicitly expose it by marking it with "use server".
 *
 * ISSO NÃO APARECE NO `next build` — toda rota sob `/dashboard` é dinâmica, e
 * nenhuma delas é prerenderizada na compilação. O erro só existiria em tempo de
 * execução, com a tela em branco na frente do gestor. Aconteceu nesta reescrita
 * com as telas de Clientes e Assinaturas, e `proibicoes.test.ts` ganhou um
 * `describe("a fronteira Server->Client")` por causa disso.
 *
 * `agoraEmMs` ATRAVESSA COMO NÚMERO, E NÃO COMO `Date`.
 *
 * O instante é medido UMA VEZ no servidor e desce como primitivo. Duas razões:
 * a derivação de vigência é do módulo puro e precisa do relógio pela porta, e
 * um `new Date()` dentro do render do cliente daria um instante diferente do
 * que o servidor usou — a linha renderizaria "vigente" no HTML e "expirada" na
 * hidratação, para uma regra que acabou de vencer. Um número não tem esse
 * problema e não depende do fuso da máquina de quem abriu a tela.
 */

/**
 * As colunas, e a primeira delas é o R23.
 *
 * "primeira coluna é identificador humano, nunca UUID" — aqui é o NOME da
 * regra, que é como o gestor a chama, com os códigos logo abaixo em corpo
 * menor. A `<Tabela>` transforma a primeira coluna em `<th scope="row">`, o que
 * faz o leitor de tela anunciar "Black Friday, Usos, 12/100" ao andar pela
 * linha, em vez de "12/100" solto.
 *
 * `dado: true` em USOS e DESCONTADO: os dois são número, e a monoespaçada com
 * numeral tabular é o que faz comparar valores numa coluna ser comparar
 * POSIÇÃO em vez de comprimento de string. Janela NÃO é `dado` apesar de ter
 * dígitos — ela é uma frase ("Sem prazo — vale sempre"), e alinhada à direita
 * ficaria ilegível ao lado das outras.
 *
 * NENHUMA COLUNA É ORDENÁVEL, e isso é honestidade: `GET /admin/descontos`
 * ordena por `criada_em DESC` e não aceita parâmetro de ordenação (ver o
 * contrato). Um cabeçalho clicável que não ordena é pior que um cabeçalho
 * quieto — a `<Tabela>` desta casa só desenha a seta quando recebe `aoOrdenar`.
 */
function colunas(agoraEmMs: number): Coluna<RegraDaLista>[] {
  const agora = new Date(agoraEmMs);

  return [
    {
      chave: "regra",
      rotulo: "Regra",
      celula: (linha) => (
        <span className="flex flex-col gap-0.5">
          {/* O nome é LINK: a linha inteira clicável seria mais cômoda e
              roubaria o gesto de selecionar texto — e um <tr> com onClick não
              chega pelo teclado sem `tabIndex` e `onKeyDown` escritos à mão. */}
          <Link href={`${ROTA_DE_DESCONTOS}/${linha.id}`} className={`underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}>
            {linha.nome}
          </Link>
          {linha.metodo === "codigo" && (
            <span data-dado className="text-[11px] text-fuligem-55">
              {codigosEmTexto(linha.codigos)}
            </span>
          )}
        </span>
      ),
    },
    {
      chave: "situacao",
      rotulo: "Situação",
      celula: (linha) => {
        const situacao = situacaoDaRegra(linha, agora);
        return <Selo tom={TOM_DA_SITUACAO[situacao]}>{NOME_DA_SITUACAO[situacao]}</Selo>;
      },
    },
    {
      chave: "metodo",
      rotulo: "Método",
      celula: (linha) => NOME_DO_METODO[linha.metodo],
    },
    {
      chave: "classe",
      rotulo: "Onde incide",
      celula: (linha) => NOME_DA_CLASSE[linha.classe],
    },
    {
      chave: "valor",
      rotulo: "Desconto",
      dado: true,
      celula: (linha) => valorEmTexto(linha.mecanica, linha.valor),
    },
    {
      chave: "janela",
      rotulo: "Janela",
      celula: (linha) => (
        <span data-dado className="text-[13px]">
          {janelaEmTexto(linha)}
        </span>
      ),
    },
    {
      chave: "usos",
      rotulo: "Usos",
      dado: true,
      celula: (linha) => usosEmTexto(linha.usos, linha.limite_usos),
    },
    {
      chave: "descontado",
      rotulo: "Já descontou",
      dado: true,
      // Zero é ZERO de verdade — regra criada e nunca usada. Trocar um zero
      // medido por um travessão apagaria a informação mais útil desta coluna,
      // que é qual campanha foi cadastrada e nunca pegou.
      celula: (linha) => descontadoEmTexto(linha.descontado_centavos),
    },
  ];
}

export function TabelaDeDescontos({
  linhas,
  agoraEmMs,
}: {
  linhas: RegraDaLista[];
  agoraEmMs: number;
}) {
  return (
    <Tabela
      legenda="Regras de desconto da loja"
      colunas={colunas(agoraEmMs)}
      linhas={linhas}
      chaveDaLinha={(linha) => linha.id}
    />
  );
}
