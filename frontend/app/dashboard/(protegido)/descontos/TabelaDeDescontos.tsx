"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { Tarja } from "@/components/painel/ui/Tarja";
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

import { alternarDesconto } from "./acoes";

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
 *
 * E AGORA HÁ UM SEGUNDO MOTIVO PARA A ILHA: o interruptor de ligar/desligar, que
 * é a única escrita da lista. Ela carrega dois pedaços de estado que só existem
 * no navegador — qual linha está esperando o servidor, e a frase de erro que
 * voltou. Nenhum dos dois é filtro, então nenhum dos dois vai para a URL (R2).
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
function colunas(
  agoraEmMs: number,
  interruptor: (linha: RegraDaLista) => ReactNode,
): Coluna<RegraDaLista>[] {
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
    {
      chave: "interruptor",
      rotulo: "Ligar/desligar",
      celula: interruptor,
    },
  ];
}

/**
 * O INTERRUPTOR DE UMA LINHA — e por que ele é um `<button>` e não uma caixa
 * de marcar.
 *
 * Uma caixa de marcar promete um estado que se muda de graça e se salva depois;
 * este gesto grava NA HORA e muda o que a loja cobra do próximo cliente. O
 * rótulo diz o que o clique FAZ ("Desligar"), e a coluna Situação, três células
 * à esquerda, diz o que a regra É ("Vigente") — nomear o estado no botão E na
 * coluna seria a segunda cópia que um dia discorda da primeira.
 *
 * NÃO PEDE CONFIRMAÇÃO, e a ausência é medida contra o R11/R12: aqueles pedem
 * peso para o irreversível. Desligar é reversível no mesmo clique, e um diálogo
 * por linha treinaria a clicar em OK — que é como se perde a confirmação que
 * importa, a de arquivar.
 *
 * NADA DE OTIMISMO (R14): enquanto o servidor não responde, o rótulo é
 * "Desligando…" e o botão fica travado. A linha só muda quando os dados novos
 * chegam do servidor — `alternarDesconto` revalida a rota, e é o Server
 * Component que reescreve a Situação. Pintar a mudança antes da resposta faria a
 * tela afirmar um desconto ligado que o backend recusou com 404, que é
 * exatamente o estado destas rotas hoje.
 *
 * ARQUIVADA É O ÚNICO CASO TRAVADO. `situacaoDaRegra` dá a arquivar precedência
 * sobre tudo: ligar uma regra arquivada não a colocaria no ar, e o botão
 * prometeria um efeito que não acontece. Expirada NÃO trava — o comentário de
 * `alternarDesconto` é explícito ("corrigir a data de uma regra expirada é
 * justamente o que o gestor precisa fazer, e foi travar esse botão que tornou a
 * promoção legada inalcançável").
 */
function Interruptor({
  linha,
  ocupada,
  aoAlternar,
}: {
  linha: RegraDaLista;
  ocupada: boolean;
  aoAlternar: (linha: RegraDaLista) => void;
}) {
  const arquivada = Boolean(linha.arquivada_em);
  const desligar = linha.habilitada;

  const rotulo = ocupada
    ? desligar
      ? "Desligando…"
      : "Ligando…"
    : desligar
      ? "Desligar"
      : "Ligar";

  return (
    <Botao
      variante="secundaria"
      disabled={ocupada || arquivada}
      onClick={() => aoAlternar(linha)}
      /* O nome NOMEIA O OBJETO: "Desligar" sozinho obriga quem não vê a tela a
         adivinhar qual das vinte regras está sob o cursor. */
      aria-label={`${desligar ? "Desligar" : "Ligar"} a regra ${linha.nome}`}
      title={
        arquivada
          ? "Regra arquivada. Desarquive na ficha dela para poder ligá-la."
          : undefined
      }
      className="px-3"
    >
      {rotulo}
    </Botao>
  );
}

export function TabelaDeDescontos({
  linhas,
  agoraEmMs,
}: {
  linhas: RegraDaLista[];
  agoraEmMs: number;
}) {
  /** Qual linha está esperando o servidor. Um id, e não um booleano: com um
   *  booleano as vinte linhas ficariam "Desligando…" ao mesmo tempo. */
  const [emVoo, setEmVoo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  function alternar(linha: RegraDaLista) {
    setErro(null);
    setEmVoo(linha.id);
    iniciar(async () => {
      const r = await alternarDesconto(linha.id, !linha.habilitada);
      setEmVoo(null);
      /* A FRASE DO SERVIDOR SOBE INTEIRA. Enquanto as rotas do motor não
         existirem no Express, o que chega aqui é o 404 com a frase — e mostrá-la
         é o comportamento correto: "não foi possível" esconderia que o problema
         é a rota, e não a regra. */
      if (!r.ok) setErro(r.erro);
    });
  }

  return (
    <>
      {erro && (
        /* A tarja fica ACIMA da tabela, e não dentro da célula: um erro dentro
           de uma linha de 24px é lido como se pertencesse àquele campo, e este
           pertence ao gesto.

           O filete de baixo é o do §4.4 — este componente é montado DENTRO de
           uma <Ficha semPreenchimento>, e sem ele a tarja encostaria no
           cabeçalho da tabela sem nada dizendo onde uma acaba e a outra começa. */
        <div className="border-b border-fuligem-20">
          <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>
        </div>
      )}
      <Tabela
        legenda="Regras de desconto da loja"
        colunas={colunas(agoraEmMs, (linha) => (
          <Interruptor
            linha={linha}
            ocupada={emVoo === linha.id}
            aoAlternar={alternar}
          />
        ))}
        linhas={linhas}
        chaveDaLinha={(linha) => linha.id}
      />
    </>
  );
}
