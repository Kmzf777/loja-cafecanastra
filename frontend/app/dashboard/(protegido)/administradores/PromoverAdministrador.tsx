"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO, FOCO_INTERNO } from "@/components/painel/ui/estilos";
import {
  DISTINGUE_POR_PAPEL,
  PAPEIS,
  PAPEL_PADRAO,
  vazioDaBusca,
  type CandidatoAAdmin,
} from "@/lib/painel/administradores/administradores.logica";

import { buscarCandidatos, promoverAdministrador } from "./acoes";

/**
 * Promover alguém — a ação primária desta tela (R18), no canto de sempre.
 *
 * O DIÁLOGO NÃO FECHA NO SUCESSO, e essa é a decisão de desenho deste arquivo.
 * Promover é o gesto que o gestor faz uma vez por ano, e a confirmação dele não
 * pode ser "a lista atrás mudou": ele está olhando para o diálogo. Fechando,
 * restaria um toast — que R9 proíbe — ou nada. Ficando aberto, a confirmação
 * nomeia a pessoa no mesmo lugar onde o gesto aconteceu, e promover a segunda
 * pessoa não custa reabrir. A lista atrás já se atualizou sozinha, por
 * `revalidatePath`.
 *
 * A BUSCA NÃO VAI PARA A URL, ao contrário de toda outra busca deste painel.
 * R2 quer o estado da lista na URL — com uma ressalva explícita: **nunca
 * colocar CPF, e-mail ou endereço na query string**, porque URL vai para o
 * histórico, para o `Referer`, para o log do proxy e para a captura de tela que
 * o gestor manda no grupo. Ali o que entra é o que a pessoa digitou numa lista
 * que ela quer de volta; aqui é um gesto de meio-caminho dentro de um diálogo,
 * e o que se digita é justamente um e-mail ou um CPF. Fica no estado do
 * componente e morre com ele.
 */

/** A caixa do `<select>`, com a mesma pele do `<Campo>`: filete de 1px, 2px de
 *  raio (§4.3 reserva o canto reto ao contêiner) e os 44px do alvo (R22). */
const CAIXA_DO_SELECT =
  `min-h-11 w-full rounded-bt border border-fuligem-20 bg-cal-puro px-3 ` +
  `text-fuligem hover:border-fuligem-55 disabled:cursor-not-allowed ` +
  `disabled:opacity-40 ${FOCO}`;

export function PromoverAdministrador({
  jaSaoAdmin,
}: {
  /** Os `user_id` que já administram — para o resultado da busca não oferecer
   *  quem só produziria um 409. */
  jaSaoAdmin: string[];
}) {
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState("");
  /** O texto da ÚLTIMA busca executada, e não o do campo: a frase do vazio tem
   *  de citar o que foi procurado, não o que está sendo digitado agora. */
  const [buscado, setBuscado] = useState("");
  const [candidatos, setCandidatos] = useState<CandidatoAAdmin[] | null>(null);
  const [todosJaSaoAdmin, setTodosJaSaoAdmin] = useState(false);
  const [escolhido, setEscolhido] = useState<CandidatoAAdmin | null>(null);
  const [papel, setPapel] = useState<string>(PAPEL_PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function limpar() {
    setDigitado("");
    setBuscado("");
    setCandidatos(null);
    setTodosJaSaoAdmin(false);
    setEscolhido(null);
    setPapel(PAPEL_PADRAO);
    setErro(null);
    setAviso(null);
  }

  function procurar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);
    setEscolhido(null);
    const texto = digitado.trim();

    iniciar(async () => {
      const r = await buscarCandidatos(texto, jaSaoAdmin);
      setBuscado(texto);
      if (r.ok) {
        setCandidatos(r.candidatos);
        setTodosJaSaoAdmin(r.todosJaSaoAdmin);
      } else {
        setCandidatos(null);
        setErro(r.erro);
      }
    });
  }

  function promover() {
    if (!escolhido) return;
    setErro(null);
    setAviso(null);
    const nome = escolhido.name?.trim() || escolhido.email?.trim() || "A pessoa";

    iniciar(async () => {
      const r = await promoverAdministrador(escolhido.user_id, papel);
      if (r.ok) {
        /*
          A CONFIRMAÇÃO NOMEIA A PESSOA E O PAPEL. "Administrador promovido."
          não distingue entre as três pessoas que estavam na lista de busca, e
          num gesto que dá acesso a tudo essa distinção é a informação.
        */
        setAviso(
          `${nome} agora administra a loja como ${
            PAPEIS.find((p) => p.valor === papel)?.rotulo.toLowerCase() ?? papel
          }.`,
        );
        // A lista de escolha some: ela agora está desatualizada (a pessoa
        // escolhida virou admin), e deixá-la na tela convidaria a promover a
        // mesma de novo, para ouvir um 409.
        setCandidatos(null);
        setEscolhido(null);
        setDigitado("");
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Botao onClick={() => setAberto(true)}>Promover administrador</Botao>

      <Dialogo
        aberto={aberto}
        aoMudar={(estaAberto) => {
          if (ocupado) return;
          setAberto(estaAberto);
          if (!estaAberto) limpar();
        }}
        titulo="Promover administrador"
        descricao="Só quem já tem conta na loja pode administrar. Procure pelo nome, e-mail ou CPF."
        acoes={
          <>
            <Botao
              variante="secundaria"
              disabled={ocupado}
              onClick={() => {
                setAberto(false);
                limpar();
              }}
            >
              Fechar
            </Botao>
            <Botao disabled={ocupado || !escolhido} onClick={promover}>
              {/* R14 pelo mesmo princípio do dinheiro: nada de UI otimista.
                  Enquanto o servidor não confirma, o botão diz "Promovendo…" e
                  a lista atrás continua sendo a que o servidor conhece. */}
              {ocupado ? "Promovendo…" : "Promover"}
            </Botao>
          </>
        }
      >
        <div className="space-y-4">
          {/*
            R9 — banner persistente, nunca toast, e DENTRO do diálogo porque é
            aqui que o olho está. As frases do servidor chegam inteiras: "Esta
            pessoa já é administradora da loja.", "Cliente não encontrado nesta
            loja." — elas SÃO o diagnóstico.
          */}
          {erro && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}
          {aviso && (
            <Tarja tom="sucesso" onFechar={() => setAviso(null)}>
              {aviso}
            </Tarja>
          )}

          {/* Um `<form>` de verdade: o Enter dentro do campo submete de graça,
              por comportamento do HTML e não por código nosso. */}
          <form role="search" onSubmit={procurar} className="flex flex-wrap items-start gap-3">
            <Campo
              rotulo="Procurar cliente"
              type="search"
              name="q"
              value={digitado}
              onChange={(evento) => setDigitado(evento.target.value)}
              placeholder="Nome, e-mail, telefone ou CPF"
              className="min-w-0 flex-1 basis-56"
              disabled={ocupado}
            />
            {/* O espaçador espelha a estrutura do <Campo> — é o que faz o botão
                nascer alinhado com o INPUT, e não com o rótulo. */}
            <div className="flex flex-col gap-1.5">
              <span aria-hidden="true" className={`text-[11px] ${ETIQUETA} invisible`}>
                Buscar
              </span>
              <Botao type="submit" variante="secundaria" disabled={ocupado}>
                Buscar
              </Botao>
            </div>
          </form>

          {candidatos !== null && candidatos.length > 0 && (
            <fieldset className="space-y-1">
              <legend className={`mb-1 text-[11px] ${ETIQUETA} text-fuligem-55`}>
                Quem promover
              </legend>
              {/*
                RÁDIO, e não uma lista de botões "Promover" por linha: promover é
                escolher UM, e o papel se decide depois. Com um botão por linha,
                o papel selecionado acima ficaria pairando sobre todas elas sem
                que a tela dissesse a qual se aplica.
              */}
              {candidatos.map((candidato) => (
                <label
                  key={candidato.user_id}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-bt border border-fuligem-20 px-3 transition-colors hover:border-fuligem hover:bg-cal has-[:checked]:border-fuligem ${FOCO_INTERNO}`}
                >
                  <input
                    type="radio"
                    name="candidato"
                    className="size-4 shrink-0 accent-fuligem"
                    checked={escolhido?.user_id === candidato.user_id}
                    onChange={() => setEscolhido(candidato)}
                    disabled={ocupado}
                  />
                  <span className="min-w-0">
                    {/* R23 outra vez: o identificador é o NOME, e o e-mail vem
                        embaixo porque é ele que desempata dois homônimos — que
                        numa loja de bairro acontece. O uuid não aparece. */}
                    <span className="block truncate">
                      {candidato.name?.trim() || "Sem nome no cadastro"}
                    </span>
                    <span className="block truncate text-[12px] text-fuligem-55">
                      {candidato.email?.trim() || "sem e-mail"}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {/*
            OS TRÊS VAZIOS DO R16, e o do meio é o que carrega a regra: promover
            exige conta na loja, e o gestor descobre isso AQUI e não no 404 do
            servidor ("Cliente não encontrado nesta loja."), que ele leria como
            "a busca está quebrada".
          */}
          {candidatos !== null && candidatos.length === 0 && (
            <p className="text-[13px] text-fuligem-55">
              {vazioDaBusca(buscado, todosJaSaoAdmin)}
            </p>
          )}
          {candidatos === null && !erro && (
            <p className="text-[13px] text-fuligem-55">{vazioDaBusca("", false)}</p>
          )}

          <label className="flex flex-col gap-1.5">
            <span className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>Papel</span>
            <select
              value={papel}
              disabled={ocupado}
              onChange={(evento) => setPapel(evento.target.value)}
              className={CAIXA_DO_SELECT}
            >
              {/* Os valores vêm do módulo puro, que os compara com o CHECK
                  `admins_papel_valido` (0035) lendo o backend do disco. Copiar a
                  lista para cá é como ela virou três cópias no painel legado. */}
              {PAPEIS.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo} — {p.descricao}
                </option>
              ))}
            </select>
          </label>

          {/*
            A FRASE MAIS IMPORTANTE DESTE DIÁLOGO, e ela é uma ressalva contra a
            própria tela: `isAdmin` pergunta uma coisa só — `req.user.ehAdmin`,
            um EXISTS em `canastra.admins`. Nenhuma rota olha a coluna `papel`.
            Um seletor de papel sem esta frase é a pior espécie de mentira de
            interface: a que o gestor só descobre quando o "operador" muda um
            preço. Quando a distinção existir, `DISTINGUE_POR_PAPEL` vira `true`
            — e o teste que confere a afirmação contra o middleware avisa.
          */}
          {!DISTINGUE_POR_PAPEL && (
            <Tarja tom="alerta">
              Hoje o papel é só registro: quem administra a loja vê e faz tudo,
              qualquer que seja o papel escolhido — inclusive ver custo e remover
              outros administradores.
            </Tarja>
          )}
        </div>
      </Dialogo>
    </>
  );
}
