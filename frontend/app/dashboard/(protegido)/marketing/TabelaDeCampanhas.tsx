"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { Tarja } from "@/components/painel/ui/Tarja";
import { FOCO } from "@/components/painel/ui/estilos";
import { formatarData } from "@/lib/painel/data";
import {
  custoEmTexto,
  situacaoDaCampanha,
  urlDaTela,
  utmEmTexto,
  type Campanha,
  type EstadoDasCampanhas,
} from "@/lib/painel/marketing/campanhas.logica";
import { CANAIS_DE_CAMPANHA, rotuloDe } from "@/lib/painel/marketing/vocabulario";

import { alternarCampanha } from "./acoes";

/**
 * A tabela de campanhas — e ela é um arquivo `"use client"` SEPARADO da
 * `page.tsx` pela razão que `TabelaDeClientes.tsx` documenta por extenso:
 * `<Tabela>` é primitivo de cliente e `Coluna.celula` é uma FUNÇÃO, e função
 * não atravessa a fronteira Server→Client. Declarar as colunas dentro do Server
 * Component faz o React lançar em tempo de EXECUÇÃO — e o `next build` não pega,
 * porque toda rota sob `/dashboard` é dinâmica. A tela ficaria em branco na
 * frente do gestor. `proibicoes.test.ts` tem uma guarda estrutural para isto.
 *
 * Aqui há um segundo motivo, e ele é o interruptor: ligar e desligar uma
 * campanha é interação de verdade, com estado pendente e erro que precisa ficar
 * na tela.
 */

export function TabelaDeCampanhas({
  linhas,
  estado,
}: {
  linhas: Campanha[];
  estado: EstadoDasCampanhas;
}) {
  /*
    O ERRO DO INTERRUPTOR MORA NA TABELA, e é uma TARJA e não um toast — R9. Um
    flash auto-dismissível pode não ser anunciado por leitor de tela, some para
    quem usa ampliação e não pode ser relido; e este erro em particular
    ("Campanha não encontrada") é do tipo que a pessoa precisa ler duas vezes.
  */
  const [erro, setErro] = useState<string | null>(null);

  const COLUNAS: Coluna<Campanha>[] = [
    {
      chave: "nome",
      rotulo: "Campanha",
      /*
        R23: a primeira coluna é o identificador HUMANO — o nome, nunca o UUID.
        Ela é o link para a edição, que é o gesto mais frequente da linha, e
        `<Tabela>` a transforma em `<th scope="row">` sozinha: o leitor de tela
        anuncia "Dia das Mães 2026, Canal, Meta" ao andar pela linha.
      */
      celula: (linha) => (
        <Link
          href={urlDaTela({ ...estado, editar: linha.id })}
          className={`underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}
        >
          {linha.nome}
        </Link>
      ),
    },
    {
      chave: "canal",
      rotulo: "Canal",
      celula: (linha) => rotuloDe(CANAIS_DE_CAMPANHA, linha.canal),
    },
    {
      chave: "utm",
      rotulo: "UTM",
      /*
        `dado` porque a UTM é um CÓDIGO — a monoespaçada com numeral tabular é o
        que deixa comparar `verao-2026` com `verao-2025` de relance. Não é
        número, mas é da mesma família de "coisa que se confere caractere a
        caractere" que a §2.5 manda pôr em `--font-dado`.
      */
      dado: true,
      celula: (linha) =>
        linha.utm_campaign ? (
          utmEmTexto(linha)
        ) : (
          // "Sem UTM" NÃO é um defeito, e o cinza diz isso: o índice de 0033 é
          // parcial de propósito, para o panfleto e o influenciador sem link
          // rastreado conviverem.
          <span className="text-fuligem-55">{utmEmTexto(linha)}</span>
        ),
    },
    {
      chave: "custo",
      rotulo: "Custo de mídia",
      dado: true,
      celula: (linha) => custoEmTexto(linha),
    },
    {
      chave: "janela",
      rotulo: "Janela",
      dado: true,
      celula: (linha) =>
        linha.inicio_em || linha.fim_em ? (
          <>
            {linha.inicio_em ? formatarData(linha.inicio_em) : "sem início"}
            {" – "}
            {linha.fim_em ? formatarData(linha.fim_em) : "sem fim"}
          </>
        ) : (
          /* Data em branco significa "vale sempre" NESTE modelo — o oposto da
             regra do painel antigo, onde promoção sem data nunca valia. Por isso
             a célula diz a palavra em vez de mostrar um travessão. */
          <span className="text-fuligem-55">Sempre</span>
        ),
    },
    {
      chave: "situacao",
      rotulo: "Situação",
      celula: (linha) => {
        const situacao = situacaoDaCampanha(linha);
        return (
          // O `title` carrega a explicação inteira. Cor sozinha não informa, e
          // "Encerrada" sem o "se o anúncio ainda está no ar, corrija a data"
          // é um diagnóstico sem conduta.
          <span title={situacao.explicacao}>
            <Selo tom={situacao.tom}>{situacao.rotulo}</Selo>
          </span>
        );
      },
    },
    {
      chave: "interruptor",
      rotulo: "Ligada",
      celula: (linha) => (
        <Interruptor campanha={linha} aoFalhar={setErro} aoTentar={() => setErro(null)} />
      ),
    },
  ];

  return (
    <>
      {erro && <Tarja tom="erro" onFechar={() => setErro(null)}>{erro}</Tarja>}
      <Tabela
        legenda="Campanhas de marketing"
        colunas={COLUNAS}
        linhas={linhas}
        chaveDaLinha={(linha) => linha.id}
      />
    </>
  );
}

/**
 * O interruptor de uma campanha.
 *
 * NÃO É UI OTIMISTA, e a decisão é a do R14 aplicada com critério. Dinheiro não
 * usa UI otimista, e ligar uma campanha não move dinheiro nenhum aqui dentro —
 * mas move LÁ FORA: é a linha que diz se o anúncio pago conta como vigente, e
 * uma tela que mostra "Ligada" sobre uma escrita que falhou faz o gestor parar
 * de conferir. O botão fica em "..." até o servidor confirmar, e a página
 * revalida.
 *
 * `useTransition` E NÃO UM `useState` DE CARREGANDO: é o que mantém o botão
 * desabilitado durante a re-renderização do Server Component que vem DEPOIS da
 * ação. Com um estado próprio, o botão voltaria a ficar clicável no instante em
 * que a ação retorna e antes de a tabela mostrar o valor novo — a janela exata
 * para o duplo clique que liga e desliga a mesma campanha.
 */
function Interruptor({
  campanha,
  aoFalhar,
  aoTentar,
}: {
  campanha: Campanha;
  aoFalhar: (erro: string) => void;
  aoTentar: () => void;
}) {
  const [pendente, iniciar] = useTransition();

  return (
    <Botao
      variante="secundaria"
      disabled={pendente}
      /* O nome do controle carrega o OBJETO, e não só o verbo: quem navega de
         leitor de tela ouve "Desligar a campanha Dia das Mães 2026" em vez de
         sete botões chamados "Desligar". */
      aria-label={`${campanha.ativa ? "Desligar" : "Ligar"} a campanha ${campanha.nome}`}
      onClick={() =>
        iniciar(async () => {
          aoTentar();
          const resposta = await alternarCampanha(campanha.id, !campanha.ativa);
          if (!resposta.ok) aoFalhar(resposta.erro);
        })
      }
    >
      {pendente ? "…" : campanha.ativa ? "Desligar" : "Ligar"}
    </Botao>
  );
}
