"use client";

import { useState, useTransition } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { Tarja } from "@/components/painel/ui/Tarja";
import { formatarData } from "@/lib/painel/data";
import {
  ehVoceMesmo,
  fraseDaRemocao,
  identificarAdmin,
  motivoParaNaoRemover,
  rotuloDoPapel,
  textoOuTraco,
  type AdministradorDaLista,
} from "@/lib/painel/administradores/administradores.logica";

import { removerAdministrador } from "./acoes";

/**
 * A lista de quem administra a loja, e a remoção — R11/R12.
 *
 * ESTE ARQUIVO É `"use client"` PORQUE `<Tabela>` RECEBE FUNÇÃO. `Coluna.celula`
 * é uma função, props de Server Component para Client Component atravessam
 * SERIALIZADAS, e função não serializa. Isso NÃO aparece no `next build` — toda
 * rota sob `/dashboard` é dinâmica, então nenhuma é prerenderizada na
 * compilação —, só em execução, com a tela em branco. `proibicoes.test.ts` tem
 * uma guarda estrutural para isto.
 *
 * A REMOÇÃO É A ÚNICA AÇÃO DESTRUTIVA DESTE BLOCO, e por isso é a única coisa
 * vermelha na tela. R21: no painel o vermelho significa exclusivamente erro e
 * ação destrutiva — se ele virar destaque, ninguém acredita mais nos erros de
 * verdade.
 */

/**
 * As colunas — e a primeira delas é o R23, que aqui vale mais que em qualquer
 * outra tela.
 *
 * `canastra.admins` é uma tabela de `user_id`. Um painel que mostrasse
 * `dddddddd-0000-…` numa lista de "quem pode mexer na loja" obrigaria a cruzar
 * uuid com pessoa na mão — que é exatamente o gesto que ninguém faz antes de
 * clicar em remover. O backend já faz o JOIN com `canastra.clientes` e
 * `auth.users`; a tela só não pode desperdiçá-lo.
 *
 * NENHUMA COLUNA É ORDENÁVEL: `GET /admin/administradores` ordena por
 * `criado_em ASC` (quem entrou primeiro está no topo, que é a ordem em que a
 * loja foi montada) e não aceita parâmetro. Um cabeçalho clicável que não
 * ordena é pior que um cabeçalho quieto.
 */
function montarColunas(
  userIdDaSessao: string | null,
  bloqueio: string | null,
  aoPedirRemocao: (admin: AdministradorDaLista) => void,
  ocupado: boolean,
): Coluna<AdministradorDaLista>[] {
  return [
    {
      chave: "pessoa",
      rotulo: "Pessoa",
      celula: (linha) => (
        <span className="flex flex-wrap items-center gap-2">
          {identificarAdmin(linha)}
          {/* "Você" é a informação que muda o significado do botão ao lado —
              remover a si mesmo é a porta de saída mais rápida do painel. */}
          {ehVoceMesmo(linha.user_id, userIdDaSessao) && <Selo>Você</Selo>}
        </span>
      ),
    },
    {
      chave: "email",
      rotulo: "E-mail",
      celula: (linha) => textoOuTraco(linha.email),
    },
    {
      chave: "papel",
      rotulo: "Papel",
      celula: (linha) => <Selo>{rotuloDoPapel(linha.papel)}</Selo>,
    },
    {
      chave: "criado_em",
      rotulo: "Administra desde",
      dado: true,
      // dd/mm/aaaa em America/Sao_Paulo, sempre (R31).
      celula: (linha) => formatarData(linha.criado_em),
    },
    {
      chave: "acoes",
      rotulo: "",
      celula: (linha) =>
        bloqueio ? (
          /*
            O AVISO NO LUGAR DO BOTÃO — e não um botão desabilitado.
            Desabilitado sem explicação parece defeito e não diz o que fazer; a
            frase diz a regra E o conserto ("promova outro antes"). A regra é do
            trigger `admins_nunca_zero` (0002), e descobri-la pelo erro seria
            descobri-la depois de já ter decidido remover.
          */
          <span className="text-[12px] text-fuligem-55">{bloqueio}</span>
        ) : (
          <Botao
            variante="destrutiva"
            disabled={ocupado}
            onClick={() => aoPedirRemocao(linha)}
          >
            Remover
          </Botao>
        ),
    },
  ];
}

export function TabelaDeAdministradores({
  linhas,
  userIdDaSessao,
}: {
  linhas: AdministradorDaLista[];
  /** Quem está olhando. `null` quando a sessão não disse — e aí ninguém é
   *  marcado como "Você", que é o lado certo do erro: melhor não avisar do que
   *  avisar a pessoa errada de que ela está se removendo. */
  userIdDaSessao: string | null;
}) {
  const [alvo, setAlvo] = useState<AdministradorDaLista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [removendo, iniciar] = useTransition();

  const bloqueio = motivoParaNaoRemover(linhas);

  function remover() {
    if (!alvo) return;
    setErro(null);
    setAviso(null);
    const nome = identificarAdmin(alvo);
    const id = alvo.user_id;

    iniciar(async () => {
      const r = await removerAdministrador(id);
      if (r.ok) {
        setAlvo(null);
        // A frase NOMEIA quem saiu: a do servidor é "Administrador removido.",
        // que não distingue entre as três linhas que estavam na tela.
        setAviso(`${nome} não administra mais a loja.`);
      } else {
        /*
          O DIÁLOGO FICA ABERTO NO ERRO, e o erro aparece DENTRO dele. Fechar
          jogaria a mensagem para trás de um gesto que não aconteceu, e o gestor
          leria "não removi" sem a frase que diz por quê — que é justamente a do
          último administrador, quando outro gestor removeu um terceiro entre o
          carregamento desta lista e este clique.
        */
        setErro(r.erro);
      }
    });
  }

  const frases = alvo
    ? fraseDaRemocao(identificarAdmin(alvo), ehVoceMesmo(alvo.user_id, userIdDaSessao))
    : null;

  return (
    <div className="space-y-4">
      {/*
        R9 — O RESULTADO É BANNER PERSISTENTE, NUNCA TOAST. Um flash pode não ser
        anunciado pelo leitor de tela, some na ampliação e não pode ser relido.
        Numa tela em que o gesto tira o acesso de alguém, "não vi a mensagem" é
        "não sei se aconteceu".
      */}
      {aviso && (
        <Tarja tom="sucesso" onFechar={() => setAviso(null)}>
          {aviso}
        </Tarja>
      )}
      {/* O erro fora do diálogo só existe depois que ele fechou — hoje nenhum
          caminho faz isso, mas a tarja fica para o dia em que fizer. */}
      {erro && !alvo && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}

      <Tabela
        legenda="Quem administra a loja"
        colunas={montarColunas(
          userIdDaSessao,
          bloqueio,
          (linha) => {
            setErro(null);
            setAviso(null);
            setAlvo(linha);
          },
          removendo,
        )}
        linhas={linhas}
        chaveDaLinha={(linha) => linha.user_id}
      />

      <Dialogo
        aberto={alvo !== null}
        aoMudar={(aberto) => {
          if (!aberto && !removendo) {
            setAlvo(null);
            setErro(null);
          }
        }}
        titulo={frases?.titulo ?? "Remover administrador"}
        /*
          R11/R12 — O TEXTO NOMEIA A PESSOA E A CONSEQUÊNCIA. "Tem certeza?" não
          carrega informação e treina a clicar em OK. As duas consequências
          (tirar de outro, tirar de si) são diferentes o bastante para terem
          textos diferentes, e quem as escreve é `fraseDaRemocao`.
        */
        descricao={frases?.texto}
        acoes={
          <>
            {/*
              R11 — DESTRUTIVO LONGE DA CONFIRMAÇÃO, e aqui "longe" é literal: o
              "Cancelar" fica ENTRE o resto da tela e o botão vermelho, de modo
              que o clique por inércia caia no que não estraga nada. E os dois
              têm peso e cor diferentes: secundário de filete contra o vermelho
              da destruição.
            */}
            <Botao
              variante="secundaria"
              disabled={removendo}
              onClick={() => {
                setAlvo(null);
                setErro(null);
              }}
            >
              Cancelar
            </Botao>
            <Botao variante="destrutiva" disabled={removendo} onClick={remover}>
              {/*
                R14 pelo mesmo princípio do dinheiro: nada de UI otimista. Até o
                servidor confirmar, o botão diz "Removendo…" e a linha continua
                na tabela com o acesso que ela ainda tem. O pior estado de uma
                operação assim não é lento, é "não sei se aconteceu".
              */}
              {removendo ? "Removendo…" : (frases?.confirmar ?? "Remover")}
            </Botao>
          </>
        }
      >
        {erro && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}
      </Dialogo>
    </div>
  );
}
