"use client";

import { useState, useTransition } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO_INTERNO } from "@/components/painel/ui/estilos";
import { formatarData } from "@/lib/painel/data";
import {
  STATUS_DE_AVALIACAO,
  corpoDaAvaliacao,
  fraseDeNadaAMudar,
  identificarAutor,
  idsQueMudam,
  notaEmTexto,
  resumoDaSelecao,
  rotuloDaAvaliacao,
  textoOuTraco,
  tomDaAvaliacao,
  type AvaliacaoDaLista,
} from "@/lib/painel/avaliacoes/avaliacoes.logica";

import { moderarAvaliacoes } from "./acoes";

/**
 * A fila de moderação — tabela, seleção em massa e as três ações de status.
 *
 * ESTE ARQUIVO É `"use client"` PORQUE `<Tabela>` RECEBE FUNÇÃO. `Coluna.celula`
 * é uma função, props de Server Component para Client Component atravessam
 * SERIALIZADAS, e função não serializa. Com as colunas declaradas na `page.tsx`
 * o React lança "Functions cannot be passed directly to Client Components…", e
 * isso NÃO aparece no `next build`: toda rota sob `/dashboard` é dinâmica, então
 * nenhuma é prerenderizada na compilação — o erro só existiria em execução, com
 * a tela em branco na frente do gestor. `proibicoes.test.ts` tem uma guarda
 * estrutural para isto.
 *
 * A SELEÇÃO É ESTADO DE CLIENTE, E NÃO DA URL — a única coisa desta tela que
 * não é. R2 quer filtro, ordenação e página na URL porque são o que a pessoa
 * quer de volta ao voltar do detalhe; uma marcação de caixinha é um gesto de
 * meio-caminho, e ressuscitá-la depois de um F5 apontando para ids que a
 * moderação já tirou da página seria pior que perdê-la.
 */

/** A caixa de seleção, com a pele do painel: filete de 1px, 2px de raio e os
 *  44px de alvo do R22 — que a densidade da célula NÃO pode comprimir. */
const CAIXA_DE_MARCA =
  `size-4 shrink-0 cursor-pointer appearance-none rounded-bt border ` +
  `border-fuligem-20 bg-cal-puro checked:border-fuligem checked:bg-fuligem ` +
  `indeterminate:border-fuligem indeterminate:bg-fuligem-55 ${FOCO_INTERNO}`;

/** O alvo de toque em volta da caixa — 44px sem engordar a linha da tabela,
 *  pelo mesmo truque de margem negativa que a <Tarja> usa. */
const ALVO_DA_MARCA =
  "-my-2 flex min-h-11 cursor-pointer items-center justify-center";

/**
 * O VERBO de cada botão, escrito à mão — não derivado do rótulo.
 *
 * A primeira versão fazia `rotulo.slice(0, -1) + "r"` para tirar "Aprovar" de
 * "Aprovada", e o português não colabora: dá "Aprovadr", e "Oculta" não tem
 * verbo nenhum por esse caminho. Um mapa explícito é três linhas e nunca
 * mente; a chave é o VALOR (o que trafega), então um status novo no backend
 * aparece como violação de tipo aqui em vez de virar um botão com nome torto.
 *
 * E é VERBO, não estado: um botão escrito "Pendente" ao lado de uma coluna
 * "Pendente" parece um filtro, não uma ação.
 */
const VERBO: Record<string, string> = {
  aprovada: "Aprovar",
  oculta: "Ocultar",
  pendente: "Voltar a pendente",
};

/**
 * As colunas — e a primeira delas é o R23.
 *
 * "primeira coluna é identificador humano, nunca UUID": `identificarAutor`
 * devolve o nome de exibição, ou "Sem identificação". A `<Tabela>` transforma a
 * primeira coluna em `<th scope="row">` sozinha, e o leitor de tela passa a
 * anunciar "Ana Souza, Nota, 5/5" ao andar pela linha em vez de "5/5" solto.
 *
 * `dado: true` NA NOTA E NAS DUAS DATAS — §2.5 quer monoespaçada em todo
 * número, e é o numeral tabular que faz comparar notas numa coluna ser comparar
 * POSIÇÃO. O SKU também é `dado`: é código, não frase.
 *
 * NENHUMA COLUNA É ORDENÁVEL, e isso é honestidade e não esquecimento:
 * `GET /admin/avaliacoes` ordena por `criado_em DESC` e não aceita parâmetro de
 * ordenação. Um cabeçalho clicável que não ordena é pior que um cabeçalho
 * quieto — e a `<Tabela>` desta casa só desenha a seta quando recebe
 * `aoOrdenar`, justamente para isso não acontecer por distração.
 */
function montarColunas(): Coluna<AvaliacaoDaLista>[] {
  return [
    {
      chave: "autor",
      rotulo: "Quem escreveu",
      celula: (linha) => identificarAutor(linha),
    },
    {
      chave: "nota",
      rotulo: "Nota",
      dado: true,
      celula: (linha) => notaEmTexto(linha.nota),
    },
    {
      chave: "avaliacao",
      rotulo: "Avaliação",
      celula: (linha) => (
        /*
          O TEXTO INTEIRO, com `whitespace-pre-wrap` e SEM reticências —
          "moderar exige ler tudo". Uma avaliação cortada em 80 caracteres
          esconde justamente a parte pela qual se decide: o elogio vem no
          começo, o xingamento vem no fim. `max-w-[62ch]` é a medida de leitura
          do estetica.md §4.2 — não é um corte, é a largura em que uma linha
          longa continua legível.
        */
        <div className="max-w-[62ch] space-y-1">
          {linha.titulo?.trim() && (
            <p className="font-medium">{linha.titulo.trim()}</p>
          )}
          <p className="whitespace-pre-wrap text-fuligem-55">
            {corpoDaAvaliacao(linha)}
          </p>
        </div>
      ),
    },
    {
      chave: "sku",
      rotulo: "SKU",
      dado: true,
      celula: (linha) => textoOuTraco(linha.sku),
    },
    {
      chave: "status",
      rotulo: "Status",
      celula: (linha) => (
        <Selo tom={tomDaAvaliacao(linha.status)}>
          {rotuloDaAvaliacao(linha.status)}
        </Selo>
      ),
    },
    {
      chave: "criado_em",
      rotulo: "Recebida em",
      dado: true,
      // dd/mm/aaaa em America/Sao_Paulo, sempre (R31): uma avaliação carimbada
      // em UTC aparece no dia errado a partir das 21h de Brasília.
      celula: (linha) => formatarData(linha.criado_em),
    },
    {
      chave: "moderado_em",
      rotulo: "Moderada em",
      dado: true,
      /*
        A COLUNA EXISTE PORQUE `moderado_em` É ESCRITO À MÃO pelo backend (não
        há trigger de moddatetime neste schema), e uma data que ninguém olha é
        uma data que ninguém percebe parar de ser escrita. Aqui ela também
        responde "isso já passou por alguém?" — que é a pergunta de quem pega a
        fila no meio.
      */
      celula: (linha) => formatarData(linha.moderado_em),
    },
  ];
}

export function ListaDeAvaliacoes({
  linhas,
  totalDoFiltro,
}: {
  linhas: AvaliacaoDaLista[];
  /** Quantas casam com o filtro INTEIRO, não só nesta página — é a metade da
   *  frase do R25 que a tabela sozinha não conhece. */
  totalDoFiltro: number;
}) {
  const [marcados, setMarcados] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [moderando, iniciar] = useTransition();

  /**
   * A SELEÇÃO SE RENDE AO SERVIDOR — o mesmo padrão sem `useEffect` de
   * `BuscaDaLista` e de `MudarStatus`.
   *
   * Depois de moderar, `revalidatePath` traz outra página (as aprovadas saíram
   * do filtro "Pendentes") e este componente re-renderiza com `linhas` novas.
   * Sem esta reconciliação, as marcas continuariam apontando para ids que já não
   * estão na tabela: a barra diria "20 marcadas" sobre uma página de 3, e o
   * botão de aprovar mandaria ids fantasmas — que o backend contaria como
   * `pedidas` e não como `atualizadas`, produzindo um alarme falso de
   * divergência.
   *
   * A comparação é pela LISTA DE IDS, e não pelo comprimento: moderar 20 de 40
   * traz 20 linhas novas para uma página que já tinha 20.
   */
  const assinatura = linhas.map((l) => l.id).join(",");
  const [assinaturaConhecida, setAssinaturaConhecida] = useState(assinatura);
  if (assinatura !== assinaturaConhecida) {
    setAssinaturaConhecida(assinatura);
    setMarcados([]);
  }

  const idsDaPagina = linhas.map((l) => l.id);
  const todosMarcados = linhas.length > 0 && marcados.length === linhas.length;
  const algunsMarcados = marcados.length > 0 && !todosMarcados;

  function alternar(id: string) {
    setMarcados((atuais) =>
      atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id],
    );
  }

  function alternarPagina() {
    setMarcados(todosMarcados ? [] : idsDaPagina);
  }

  function moderar(destino: string) {
    setErro(null);
    setAviso(null);

    /*
      A CONFERÊNCIA ANTES DO ENVIO, e ela não é otimização.

      Marcar três já aprovadas e clicar em "Aprovar" faria o `UPDATE` casar as
      três linhas e reescrever o mesmo valor: a resposta seria
      `{pedidas: 3, atualizadas: 3}`, com toda a razão, e o gestor leria "3
      avaliações marcadas como aprovada" tendo mudado o estado de nenhuma. Quem
      sabe distinguir é a tela, que tem as linhas em mãos.
    */
    const mudam = idsQueMudam(linhas, marcados, destino);
    if (mudam.length === 0) {
      setAviso(fraseDeNadaAMudar(marcados.length, destino));
      return;
    }

    iniciar(async () => {
      /*
        SÓ AS QUE MUDAM VÃO. Mandar as outras junto inflaria `pedidas` sem
        inflar `atualizadas`, e a frase do placar acusaria uma divergência que
        não existe — treinando o gestor a ignorar justamente o aviso que existe
        para o caso em que a divergência é real.
      */
      const r = await moderarAvaliacoes(mudam, destino);
      if (r.ok) {
        setAviso(r.frase);
        setMarcados([]);
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/*
        R9 — ERRO É BANNER PERSISTENTE, NUNCA TOAST. Um flash pode não ser
        anunciado pelo leitor de tela, some na ampliação e não pode ser relido:
        o gestor que olhou para o outro lado no segundo errado nunca saberá que
        a moderação falhou. Fica até ele fechar.

        AS DUAS TARJAS FICAM ACIMA DA BARRA DE AÇÃO, e não abaixo da tabela: é
        para onde o olho volta depois do clique, e uma mensagem embaixo de vinte
        linhas de texto de avaliação está fora da tela.
      */}
      {erro && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}
      {aviso && (
        <Tarja tom="sucesso" onFechar={() => setAviso(null)}>
          {aviso}
        </Tarja>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-fuligem-20 px-5 py-3">
        {/*
          R25 POR ESCRITO. A distinção "os 20 desta página" × "os N do filtro"
          não é uma opção de interface aqui, é um fato do contrato: o
          `PATCH /admin/avaliacoes` recebe uma LISTA DE IDS, e a tela só tem os
          da página que carregou. "Aplicar ao filtro inteiro" só existiria
          puxando as N páginas antes — e um botão que dispara 68 leituras
          escondidas é pior que um botão que não existe. Então a tela diz.
        */}
        <p aria-live="polite" className="text-[12px] text-fuligem-55">
          {resumoDaSelecao(marcados.length, linhas.length, totalDoFiltro)}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            AS TRÊS AÇÕES, NA ORDEM DO GESTO: aprovar é o que se faz o dia
            inteiro, ocultar é a exceção, devolver para pendente é o desfazer.

            NENHUMA DELAS É DESTRUTIVA, e por isso nenhuma é vermelha nem pede
            confirmação. Ocultar despublica sem apagar — a avaliação continua
            sendo do cliente, e a 0014 nem deu DELETE a esta tela (é privilégio
            de `service_role`). Pôr aqui o peso de uma exclusão ensinaria a
            hesitar num gesto que se desfaz clicando ao lado, e é assim que se
            deixa de acreditar nas confirmações que importam (R12).
          */}
          {STATUS_DE_AVALIACAO.map((s) => (
            <Botao
              key={s.valor}
              variante={s.valor === "aprovada" ? "primaria" : "secundaria"}
              disabled={moderando || marcados.length === 0}
              onClick={() => moderar(s.valor)}
            >
              {VERBO[s.valor] ?? s.rotulo}
            </Botao>
          ))}
        </div>
      </div>

      <Tabela
        legenda="Avaliações para moderar"
        colunas={montarColunas()}
        linhas={linhas}
        chaveDaLinha={(linha) => linha.id}
        selecao={{
          cabecalho: (
            <label className={ALVO_DA_MARCA}>
              {/* O nome que o leitor de tela ouve NOMEIA O ESCOPO — "desta
                  página" —, porque é exatamente a confusão que o R25 existe
                  para impedir, e ela é pior para quem não vê a contagem ao
                  lado. */}
              <span className="sr-only">
                Marcar as {linhas.length} avaliações desta página
              </span>
              <input
                type="checkbox"
                className={CAIXA_DE_MARCA}
                checked={todosMarcados}
                /* `ref` em vez de prop porque `indeterminate` não existe como
                   atributo de HTML — só como propriedade do elemento. É o
                   traço que distingue "marquei algumas" de "não marquei nada",
                   e sem ele a caixa do cabeçalho mente nas duas direções. */
                ref={(no) => {
                  if (no) no.indeterminate = algunsMarcados;
                }}
                onChange={alternarPagina}
                disabled={moderando || linhas.length === 0}
              />
            </label>
          ),
          celula: (linha) => (
            <label className={ALVO_DA_MARCA}>
              <span className="sr-only">
                Marcar a avaliação de {identificarAutor(linha)}
              </span>
              <input
                type="checkbox"
                className={CAIXA_DE_MARCA}
                checked={marcados.includes(linha.id)}
                onChange={() => alternar(linha.id)}
                disabled={moderando}
              />
            </label>
          ),
        }}
      />

      {/*
        O QUE CADA ESTADO SIGNIFICA NA LOJA — e o que não existe.

        Está aqui, e não num tooltip, porque é a informação que decide o clique
        e porque `oculta` é contraintuitivo: parece "recusada" e não é. A
        ausência de "Recusada" também é dita, porque é o nome que quem já usou
        qualquer outro e-commerce procura primeiro, e não achar um botão é
        indistinguível de a tela estar quebrada.
      */}
      <p className={`px-5 pb-1 text-[10px] ${ETIQUETA} text-fuligem-55`}>
        O que cada estado faz
      </p>
      <ul className="space-y-1 px-5 pb-4 text-[12px] text-fuligem-55">
        <li>
          <strong className="font-medium text-fuligem">Pendente</strong> — não
          aparece na loja e continua na fila.
        </li>
        <li>
          <strong className="font-medium text-fuligem">Aprovada</strong> —
          aparece na página do café e conta na nota média.
        </li>
        <li>
          <strong className="font-medium text-fuligem">Oculta</strong> — sai da
          loja sem ser apagada. Não existe &quot;recusada&quot;: a avaliação
          continua sendo do cliente, e esta tela não apaga nenhuma.
        </li>
      </ul>
    </div>
  );
}
