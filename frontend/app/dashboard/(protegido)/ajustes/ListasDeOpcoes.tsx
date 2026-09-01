"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Selo } from "@/components/painel/ui/Selo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA } from "@/components/painel/ui/estilos";
import {
  TIPOS_DE_OPCAO,
  motivoParaNaoExcluir,
  opcoesDoTipo,
  validarNovaOpcao,
  type OpcaoDaLista,
} from "@/lib/painel/ajustes/ajustes.logica";

import { adicionarOpcao, excluirOpcao } from "./acoes";

/**
 * As duas listas de valores de filtro — Categorias e Embalagens.
 *
 * DUAS LISTAS INDEPENDENTES, e o descompasso vem do checklist de paridade: **o
 * rótulo é "Embalagens" e o `type` é `size`**. São três vocabulários no mesmo
 * caminho — a tabela grava `categoria`/`tamanho`, o contrato HTTP fala
 * `category`/`size`, e o gestor lê "Categorias"/"Embalagens". O mapa mora no
 * módulo puro; nenhum pedaço dele é copiado para cá.
 *
 * A MARCA DE "EM USO" APARECE ANTES DA TENTATIVA. O backend recusa com 409 a
 * exclusão de opção usada por algum produto, e a frase chega — mas descobrir
 * pelo erro custa um clique e deixa a pergunta seguinte sem resposta ("em uso
 * por qual produto?"). Marcado antes, o gestor nem tenta. Quando a leitura do
 * catálogo não alcançou o catálogo inteiro, a tela NÃO marca e diz por quê:
 * marca errada numa tela de exclusão é pior que marca nenhuma, porque convida
 * ao clique.
 */
export function ListasDeOpcoes({
  opcoes,
  emUso,
  podeMarcarUso,
}: {
  opcoes: OpcaoDaLista[];
  /** Os VALORES usados por algum produto — a comparação é por valor porque é
   *  assim que o backend a faz (`produtos.categoria` guarda o texto). */
  emUso: string[];
  /** Dá para confiar na marca? Só quando a leitura cobriu o catálogo inteiro. */
  podeMarcarUso: boolean;
}) {
  const usados = new Set(emUso);

  const [novos, setNovos] = useState<Record<string, string>>({});
  const [alvo, setAlvo] = useState<OpcaoDaLista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function acrescentar(tipo: string, evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);

    const valor = novos[tipo] ?? "";
    const invalido = validarNovaOpcao(valor);
    if (invalido) {
      setErro(invalido);
      return;
    }

    iniciar(async () => {
      const r = await adicionarOpcao(tipo, valor);
      if (r.ok) {
        setAviso(`"${valor.trim()}" foi acrescentado.`);
        setNovos((atuais) => ({ ...atuais, [tipo]: "" }));
      } else {
        /*
          A FRASE DO SERVIDOR CHEGA INTEIRA — e este é o ponto em que o painel
          legado a jogava fora: `ManageCategories` mostrava "Erro ao adicionar."
          no lugar de "Esta opção já existe.", que manda o gestor tentar de novo
          exatamente a mesma coisa.
        */
        setErro(r.erro);
      }
    });
  }

  function excluir() {
    if (!alvo) return;
    setErro(null);
    setAviso(null);
    const valor = alvo.value;
    const id = alvo.id;

    iniciar(async () => {
      const r = await excluirOpcao(id);
      if (r.ok) {
        setAlvo(null);
        setAviso(`"${valor}" foi excluído.`);
      } else {
        // O diálogo fica ABERTO no erro: é ali que o gestor está, e a frase que
        // ele precisa ler é a do 409 de opção em uso.
        setErro(r.erro);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* R9 — banner persistente, nunca toast. Fora das fichas, porque as duas
          listas compartilham o resultado e duplicá-lo faria o gestor procurar
          em qual das duas a mensagem apareceu. */}
      {erro && !alvo && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}
      {aviso && (
        <Tarja tom="sucesso" onFechar={() => setAviso(null)}>
          {aviso}
        </Tarja>
      )}

      {!podeMarcarUso && (
        <Tarja tom="aviso">
          O catálogo é maior do que esta tela consegue ler de uma vez, então ela
          não marca quais opções estão em uso. Excluir uma opção usada por algum
          produto continua sendo recusado pelo servidor.
        </Tarja>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {TIPOS_DE_OPCAO.map((tipo) => {
          const lista = opcoesDoTipo(opcoes, tipo.tipo);
          return (
            <Ficha key={tipo.tipo} titulo={tipo.rotulo} nivel={3}>
              <div className="space-y-4">
                <p className="text-[12px] text-fuligem-55">{tipo.ajuda}</p>

                {lista.length === 0 ? (
                  /* R16 — o vazio de primeira vez, com o que ele significa: sem
                     categoria nenhuma, o filtro da loja não tem por onde
                     separar os cafés. */
                  <p className="text-[13px] text-fuligem-55">
                    Nenhuma {tipo.singular} cadastrada. Sem elas, a loja não tem
                    como agrupar os cafés.
                  </p>
                ) : (
                  <ul className="divide-y divide-fuligem-20 border-y border-fuligem-20">
                    {lista.map((opcao) => {
                      const bloqueio = podeMarcarUso
                        ? motivoParaNaoExcluir(usados.has(opcao.value))
                        : null;
                      return (
                        <li
                          key={opcao.id}
                          className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            {opcao.value}
                            {bloqueio && <Selo>Em uso</Selo>}
                          </span>
                          {bloqueio ? (
                            /* O AVISO NO LUGAR DO BOTÃO — e não um botão
                               desabilitado. Desabilitado sem explicação parece
                               defeito e não diz o que fazer; a frase diz a
                               regra E o conserto. */
                            <span className="text-[12px] text-fuligem-55">
                              {bloqueio}
                            </span>
                          ) : (
                            <Botao
                              variante="destrutiva"
                              disabled={ocupado}
                              onClick={() => {
                                setErro(null);
                                setAviso(null);
                                setAlvo(opcao);
                              }}
                            >
                              Excluir
                            </Botao>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <form
                  onSubmit={(evento) => acrescentar(tipo.tipo, evento)}
                  className="flex flex-wrap items-start gap-3"
                >
                  <Campo
                    rotulo={`Nova ${tipo.singular}`}
                    value={novos[tipo.tipo] ?? ""}
                    onChange={(evento) =>
                      setNovos((atuais) => ({
                        ...atuais,
                        [tipo.tipo]: evento.target.value,
                      }))
                    }
                    disabled={ocupado}
                    className="min-w-0 flex-1 basis-40"
                  />
                  {/* O espaçador espelha a estrutura do <Campo> — é o que faz o
                      botão nascer alinhado com o INPUT, e não com o rótulo. */}
                  <div className="flex flex-col gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`text-[11px] ${ETIQUETA} invisible`}
                    >
                      Adicionar
                    </span>
                    {/* `type="submit"` explícito porque o <Botao> desta casa tem
                        `type="button"` por padrão, de propósito. */}
                    <Botao type="submit" variante="secundaria" disabled={ocupado}>
                      Adicionar
                    </Botao>
                  </div>
                </form>
              </div>
            </Ficha>
          );
        })}
      </div>

      <Dialogo
        aberto={alvo !== null}
        aoMudar={(aberto) => {
          if (!aberto && !ocupado) {
            setAlvo(null);
            setErro(null);
          }
        }}
        titulo="Excluir opção"
        /*
          R11/R12 — o texto nomeia o OBJETO e a CONSEQUÊNCIA. "Tem certeza?" não
          carrega informação. A consequência real é a loja perder um valor de
          filtro: os produtos não somem, mas deixam de ter por onde ser
          agrupados, e recadastrar a opção não os religa (a coluna guarda o
          TEXTO — recriar com a mesma grafia religa; com grafia diferente, não).
        */
        descricao={
          alvo
            ? `A opção "${alvo.value}" sai da loja e deixa de aparecer nos filtros. ` +
              "Nenhum produto é apagado. Recriar com a MESMA grafia devolve o " +
              "agrupamento; com outra grafia, os produtos ficam sem esta opção."
            : undefined
        }
        acoes={
          <>
            {/* R11 — destrutivo longe da confirmação: o "Cancelar" fica ENTRE o
                resto da tela e o botão vermelho, de modo que o clique por
                inércia caia no que não estraga nada. */}
            <Botao
              variante="secundaria"
              disabled={ocupado}
              onClick={() => {
                setAlvo(null);
                setErro(null);
              }}
            >
              Cancelar
            </Botao>
            <Botao variante="destrutiva" disabled={ocupado} onClick={excluir}>
              {ocupado ? "Excluindo…" : "Excluir a opção"}
            </Botao>
          </>
        }
      >
        {erro && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}
      </Dialogo>
    </div>
  );
}
