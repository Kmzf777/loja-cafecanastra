"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Selo } from "@/components/painel/ui/Selo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import {
  CLASSES,
  MECANICAS,
  MECANICAS_INERTES,
  MEIOS_DE_PAGAMENTO,
  METODOS,
  MINIMOS,
  NOME_DO_MEIO,
  ROTA_DE_DESCONTOS,
  TIPOS_DE_ESCOPO,
  TIPOS_DE_FAIXA,
  UFS,
  type Classe,
  type Mecanica,
  type MeioDePagamento,
  type Metodo,
  type MinimoTipo,
  type ProdutoDoSeletor,
  type RegraCompleta,
  type TipoDeEscopo,
  type TipoDeFaixa,
  type Uf,
} from "@/lib/painel/descontos/contrato";
import {
  avisosDoFormulario,
  estaSujo,
  formularioDaRegra,
  montarPayload,
  passosComErro,
  passosDoFormulario,
  rotuloDoValor,
  usaFaixas,
  validar,
  type ChaveDePasso,
  type FormularioDeDesconto,
} from "@/lib/painel/descontos/formulario.logica";
import {
  NOME_DA_CLASSE,
  NOME_DA_MECANICA,
  NOME_DA_SITUACAO,
  NOME_DO_METODO,
  TOM_DA_SITUACAO,
  fraseDeArquivamento,
  situacaoDaRegra,
} from "@/lib/painel/descontos/lista.logica";

import { arquivarDesconto, criarDesconto, desarquivarDesconto, salvarDesconto } from "./acoes";
import { Area, Grupo, LinhaRemovivel, Marcador, Selecao } from "./campos";
import { Simulador } from "./Simulador";

/**
 * O formulário guiado de seis passos, e a barra de salvar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SEIS PASSOS, E NÃO UMA FICHA DE QUARENTA CAMPOS.
 *
 * A ordem é `o que desconta → quanto → para quem → o que inclui e o que exclui
 * → requisitos e limites → janela`, e cada passo responde uma pergunta que o
 * anterior deixou aberta. Não é decoração: uma regra de desconto tem quarenta
 * campos, e quarenta campos numa página só transformam "criar 10% no PIX" numa
 * leitura de formulário de imposto de renda.
 *
 * OS PASSOS SÃO ABAS, E NÃO UM ASSISTENTE COM "PRÓXIMO". Um assistente linear
 * obrigaria a atravessar seis telas para corrigir a data de uma regra que já
 * existe, e o gesto mais frequente desta tela é justamente editar um campo de
 * uma regra pronta. Com abas, o passo é uma âncora, não um portão — e a barra
 * de salvar é única para os seis.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NADA AQUI TEM AUTOSAVE — R6.
 *
 * "Autosave só onde o erro custa zero", e este é o formulário onde ele custa
 * mais: uma vírgula errada no percentual publica 90% no lugar de 9%. Salvar é
 * um gesto explícito, e a barra de salvar só nasce quando há o que salvar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O TOGGLE DE LIGAR NUNCA É DESABILITADO POR CAUSA DA JANELA.
 *
 * É o defeito legado, e ele tinha quatro etapas: o load mutava `active = false`
 * fora da janela, `handleEdit` levava o valor mutado ao formulário, o submit o
 * gravava, e o botão de reativar ficava `disabled` pela mesma regra de janela.
 * A promoção virava inalcançável — no gesto que existia para salvá-la.
 *
 * Aqui a situação é DERIVADA e mostrada como selo, `habilitada` vem do servidor
 * e só dele, e o toggle está sempre vivo: corrigir a data de uma regra expirada
 * é exatamente o que o gestor precisa poder fazer.
 */

const PASSO_INICIAL: ChaveDePasso = "oque";

export function FormularioDeRegra({
  inicial,
  regra,
  produtos,
  categorias,
  agoraEmMs,
}: {
  inicial: FormularioDeDesconto;
  /** `undefined` quando é uma regra nova — é o que decide POST ou PUT, e o que
   *  esconde o bloco de arquivar (não se arquiva o que não existe). */
  regra?: RegraCompleta;
  produtos: ProdutoDoSeletor[];
  categorias: string[];
  agoraEmMs: number;
}) {
  const router = useRouter();

  const [base, setBase] = useState(inicial);
  const [forma, setForma] = useState(inicial);
  const [passo, setPasso] = useState<ChaveDePasso>(PASSO_INICIAL);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [confirmandoArquivo, setConfirmandoArquivo] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(null);

  const idDasAbas = useId();
  const abas = useRef<(HTMLButtonElement | null)[]>([]);

  const passos = passosDoFormulario(forma);
  const sujo = estaSujo(base, forma);

  const errosDeVerdade = useMemo(() => validar(forma), [forma]);
  /* OS ERROS SÓ APARECEM DEPOIS DA PRIMEIRA TENTATIVA DE SALVAR. Marcar de
     vermelho um campo que a pessoa ainda não terminou de digitar é ensinar que
     vermelho não quer dizer nada — e num painel onde o vermelho é reservado a
     erro e destruição, é caro. */
  const erros = tentouSalvar ? errosDeVerdade : {};
  const passosErrados = passosComErro(erros);
  const avisos = avisosDoFormulario(forma);

  /* O passo escolhido pode deixar de existir: trocar a classe de `frete` para
     `produto` com a aba de frete aberta deixaria a tela em branco. */
  const passoAtual = passos.some((p) => p.chave === passo) ? passo : PASSO_INICIAL;

  /**
   * O BLOQUEIO DE SAÍDA — R5. Meia hora montando uma regra de Black Friday não
   * pode ir embora num Ctrl+W distraído. Só cobre a saída do navegador; a
   * navegação interna do Next não tem gancho estável para isto no App Router, e
   * a barra de salvar visível é o que resta para lembrar.
   */
  useEffect(() => {
    if (!sujo) return;
    function avisar(evento: BeforeUnloadEvent) {
      evento.preventDefault();
      evento.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  function mudar(mudanca: Partial<FormularioDeDesconto>) {
    setConfirmandoDescarte(false);
    setForma((atual) => ({ ...atual, ...mudanca }));
  }

  function descartar() {
    setForma(base);
    setTentouSalvar(false);
    setConfirmandoDescarte(false);
    setAviso(null);
  }

  async function salvar() {
    setTentouSalvar(true);
    setConfirmandoDescarte(false);

    const problemas = validar(forma);
    if (Object.keys(problemas).length) {
      /* LEVAR A PESSOA ATÉ O ERRO, e não só dizer que ele existe: o campo pode
         estar num passo fechado, e uma tarja apontando para uma tela onde não
         há nada marcado é o que faz o gestor clicar em Salvar até desistir. */
      const primeiro = passosComErro(problemas)[0];
      if (primeiro) setPasso(primeiro);
      setAviso({ tom: "erro", texto: "Confira os campos marcados — nada foi salvo." });
      return;
    }

    setSalvando(true);
    setAviso(null);
    try {
      const corpo = montarPayload(forma);
      const resultado = regra
        ? await salvarDesconto(regra.id, corpo)
        : await criarDesconto(corpo);

      if (!resultado.ok) {
        // A FRASE DO SERVIDOR É O DIAGNÓSTICO. "Já existe um código CAFE20." diz
        // o que fazer; "Erro ao salvar" vira um chamado.
        setAviso({ tom: "erro", texto: resultado.erro });
        return;
      }

      /* REBASEIA COM O QUE O SERVIDOR GRAVOU, e não com o que se mandou: o
         backend normaliza (código em maiúscula, faixas ordenadas), e rebasear
         com o payload deixaria o formulário "sujo" logo depois de salvar. */
      const gravado = formularioDaRegra(resultado.dados);
      setBase(gravado);
      setForma(gravado);
      setTentouSalvar(false);
      setAviso({ tom: "sucesso", texto: "Regra salva." });

      if (!regra) router.replace(`${ROTA_DE_DESCONTOS}/${resultado.dados.id}`);
    } finally {
      setSalvando(false);
    }
  }

  async function arquivar() {
    if (!regra) return;
    setConfirmandoArquivo(false);
    setSalvando(true);
    try {
      const resultado = regra.arquivada_em
        ? await desarquivarDesconto(regra.id)
        : await arquivarDesconto(regra.id);
      if (!resultado.ok) {
        setAviso({ tom: "erro", texto: resultado.erro });
        return;
      }
      const gravado = formularioDaRegra(resultado.dados);
      setBase(gravado);
      setForma(gravado);
      setAviso({
        tom: "sucesso",
        texto: resultado.dados.arquivada_em
          ? "Regra arquivada. Ela saiu do ar e continua no histórico."
          : "Regra desarquivada.",
      });
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  /** Setas, Home e End nas abas — WAI-ARIA para `tablist`. Sem isto, quem
   *  navega por teclado precisa dar Tab por cada aba para chegar à sexta. */
  function navegarPorTeclado(evento: KeyboardEvent<HTMLDivElement>) {
    const atual = passos.findIndex((p) => p.chave === passoAtual);
    const passoDaSeta =
      evento.key === "ArrowRight" ? 1 : evento.key === "ArrowLeft" ? -1 : 0;

    let destino = -1;
    if (passoDaSeta) destino = (atual + passoDaSeta + passos.length) % passos.length;
    if (evento.key === "Home") destino = 0;
    if (evento.key === "End") destino = passos.length - 1;
    if (destino < 0) return;

    evento.preventDefault();
    setPasso(passos[destino].chave);
    abas.current[destino]?.focus();
  }

  const idDoPainel = `${idDasAbas}-painel`;
  const situacao = regra ? situacaoDaRegra(regra, new Date(agoraEmMs)) : null;
  const avisosDoPasso = avisos.filter((a) => a.passo === passoAtual);

  return (
    <div className="pb-4">
      {aviso && (
        <div className="mb-5">
          <Tarja tom={aviso.tom} onFechar={() => setAviso(null)}>
            {aviso.texto}
          </Tarja>
        </div>
      )}

      {/*
        FORMULÁRIO À ESQUERDA, SIMULADOR À DIREITA, e o simulador gruda no topo.
        É a mesma decisão da tela de Vitrine (R33: nada de "editar às cegas e
        conferir em outra aba") aplicada ao que aqui é ainda mais caro: o
        resultado de uma regra de desconto não é visível em lugar nenhum até a
        primeira venda. Em coluna única, o simulador vem DEPOIS do formulário —
        quem abriu esta página veio cadastrar, e empurrar seis passos para baixo
        de um carrinho de teste é fazer rolar antes de trabalhar.
      */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-5">
          <Ficha
            titulo={regra ? "Editar regra" : "Nova regra"}
            semPreenchimento
            acao={
              situacao && (
                <Selo tom={TOM_DA_SITUACAO[situacao]}>{NOME_DA_SITUACAO[situacao]}</Selo>
              )
            }
          >
            <div
              role="tablist"
              aria-label="Passos do cadastro"
              onKeyDown={navegarPorTeclado}
              className="flex flex-wrap items-center gap-x-1 border-b border-fuligem-20 px-2"
            >
              {passos.map((p, i) => {
                const ativo = p.chave === passoAtual;
                const temErro = passosErrados.includes(p.chave);
                return (
                  <button
                    key={p.chave}
                    ref={(no) => {
                      abas.current[i] = no;
                    }}
                    type="button"
                    role="tab"
                    id={`${idDasAbas}-${p.chave}`}
                    aria-selected={ativo}
                    aria-controls={idDoPainel}
                    tabIndex={ativo ? 0 : -1}
                    onClick={() => setPasso(p.chave)}
                    className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-[11px] ${ETIQUETA} ${FOCO} ${
                      ativo
                        ? "border-fuligem text-fuligem"
                        : "border-transparent text-fuligem-55 hover:text-fuligem"
                    }`}
                  >
                    <span data-dado aria-hidden="true">
                      {i + 1}
                    </span>
                    {p.titulo}
                    {/*
                      O MARCADOR DE ERRO NÃO É SÓ COR — WCAG 1.4.1. O glifo "!"
                      é visível e o `sr-only` ao lado carrega a mesma informação
                      para quem não o enxerga.
                    */}
                    {temErro && (
                      <>
                        <span aria-hidden="true" className="text-vermelho">
                          !
                        </span>
                        <span className="sr-only">(com erro)</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>

            <div
              role="tabpanel"
              id={idDoPainel}
              aria-labelledby={`${idDasAbas}-${passoAtual}`}
              tabIndex={-1}
              className="space-y-4 p-5"
            >
              <p className="max-w-[62ch] text-[13px] text-fuligem-55">
                {passos.find((p) => p.chave === passoAtual)?.pergunta}
              </p>

              {avisosDoPasso.map((a) => (
                <Tarja key={a.chave} tom={a.tom}>
                  {a.texto}
                </Tarja>
              ))}

              {passoAtual === "oque" && (
                <PassoOQue forma={forma} erros={erros} mudar={mudar} />
              )}
              {passoAtual === "quanto" && (
                <PassoQuanto forma={forma} erros={erros} mudar={mudar} />
              )}
              {passoAtual === "quem" && <PassoQuem forma={forma} mudar={mudar} />}
              {passoAtual === "escopo" && (
                <PassoEscopo
                  forma={forma}
                  erros={erros}
                  mudar={mudar}
                  produtos={produtos}
                  categorias={categorias}
                />
              )}
              {passoAtual === "limites" && (
                <PassoLimites forma={forma} erros={erros} mudar={mudar} />
              )}
              {passoAtual === "janela" && (
                <PassoJanela forma={forma} erros={erros} mudar={mudar} />
              )}
              {passoAtual === "frete" && (
                <PassoFrete forma={forma} erros={erros} mudar={mudar} />
              )}
            </div>
          </Ficha>

          {/*
            OS AVISOS DOS OUTROS PASSOS, resumidos, para não ficarem escondidos
            atrás de uma aba fechada. Um alerta que só aparece quando se abre a
            aba certa é um alerta que não existe para quem nunca abre aquela aba
            — e "sem teto de frete" é exatamente o que ninguém vai procurar.
          */}
          {avisos.some((a) => a.passo !== passoAtual && a.tom === "alerta") && (
            <Ficha titulo="Antes de ligar esta regra">
              <ul className="space-y-3">
                {avisos
                  .filter((a) => a.passo !== passoAtual && a.tom === "alerta")
                  .map((a) => (
                    <li key={a.chave} className="text-[13px]">
                      <button
                        type="button"
                        onClick={() => setPasso(a.passo)}
                        className={`text-left underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}
                      >
                        {a.texto}
                      </button>
                    </li>
                  ))}
              </ul>
            </Ficha>
          )}

          {regra && <BlocoDeArquivo regra={regra} aoPedir={() => setConfirmandoArquivo(true)} />}
        </div>

        <div className="min-w-0 xl:sticky xl:top-[132px]">
          {/* `errosDeVerdade` e não `erros`: o simulador precisa saber se a
              regra é válida AGORA, e não se a pessoa já tentou salvar. Passar
              `erros` deixaria o botão simular uma regra inválida enquanto ela
              nunca tivesse sido submetida — que é exatamente o estado de quem
              acabou de montar a regra e quer conferir o número. */}
          <Simulador
            forma={forma}
            produtos={produtos}
            problemasDaRegra={Object.keys(errosDeVerdade).length}
          />
        </div>
      </div>

      {/*
        A BARRA DE SALVAR É CONTEXTUAL — R5. Ela nasce com a primeira alteração
        e morre com o salvamento. Um botão "Salvar" sempre presente e sempre
        clicável ensina a clicar por precaução, e aí ninguém sabe mais se há ou
        não trabalho pendente.

        `sticky bottom-0` e não `fixed`: ela pertence ao formulário, e a largura
        dela tem de ser a do conteúdo — com o menu lateral de `md` para cima,
        uma barra fixa começaria debaixo do menu.
      */}
      {sujo && (
        <div className="sticky bottom-0 z-30 mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-cx border border-fuligem-20 bg-cal-puro px-5 py-3">
          <p className="text-[13px] text-fuligem-55">
            Alterações não salvas
            {passosErrados.length > 0 && <> — há campos a corrigir</>}.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              DESCARTAR É DESTRUTIVO E PEDE DUAS ETAPAS. O próprio botão troca de
              rótulo e de peso: um clique errado num "Descartar" de uma etapa
              apaga meia hora de digitação sem nada para desfazer.
            */}
            {confirmandoDescarte ? (
              <>
                <Botao variante="secundaria" onClick={() => setConfirmandoDescarte(false)}>
                  Continuar editando
                </Botao>
                <Botao variante="destrutiva" onClick={descartar}>
                  Descartar mesmo
                </Botao>
              </>
            ) : (
              <Botao variante="secundaria" onClick={() => setConfirmandoDescarte(true)}>
                Descartar
              </Botao>
            )}

            <Botao onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </Botao>
          </div>
        </div>
      )}

      {regra && (
        <Dialogo
          aberto={confirmandoArquivo}
          aoMudar={setConfirmandoArquivo}
          titulo={regra.arquivada_em ? "Desarquivar a regra" : "Arquivar a regra"}
          descricao={
            regra.arquivada_em
              ? `“${regra.nome}” volta para a lista. Ela só desconta de novo se estiver ligada e dentro da janela.`
              : fraseDeArquivamento(regra)
          }
          acoes={
            <>
              <Botao variante="secundaria" onClick={() => setConfirmandoArquivo(false)}>
                Cancelar
              </Botao>
              <Botao
                variante={regra.arquivada_em ? "primaria" : "destrutiva"}
                onClick={arquivar}
                disabled={salvando}
              >
                {regra.arquivada_em ? "Desarquivar" : "Arquivar"}
              </Botao>
            </>
          }
        />
      )}
    </div>
  );
}

/* ========================================================================== *
 * Os passos
 * ========================================================================== */

type Props = {
  forma: FormularioDeDesconto;
  erros: Record<string, string>;
  mudar: (mudanca: Partial<FormularioDeDesconto>) => void;
};

function PassoOQue({ forma, erros, mudar }: Props) {
  return (
    <div className="space-y-4">
      <Campo
        rotulo="Nome da regra"
        required
        value={forma.nome}
        erro={erros.nome ?? null}
        ajuda="É por ele que a regra vai ser encontrada na lista daqui a três meses."
        placeholder="Dez por cento no PIX"
        onChange={(e) => mudar({ nome: e.target.value })}
      />
      <Area
        rotulo="Descrição interna"
        rows={2}
        value={forma.descricao}
        ajuda="Só o painel vê. Serve para lembrar quem pediu e por quê."
        onChange={(e) => mudar({ descricao: e.target.value })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Selecao
          rotulo="Como o cliente chega nela"
          value={forma.metodo}
          onChange={(e) => mudar({ metodo: e.target.value as Metodo })}
          ajuda="Automático aplica sozinho no carrinho. Com código, o cliente digita."
          opcoes={METODOS.map((m) => ({ valor: m, rotulo: NOME_DO_METODO[m] }))}
        />
        <Selecao
          rotulo="Onde o desconto incide"
          value={forma.classe}
          onChange={(e) => mudar({ classe: e.target.value as Classe })}
          ajuda="A ordem de aplicação é esta: produto, depois pedido, depois frete."
          opcoes={CLASSES.map((c) => ({ valor: c, rotulo: NOME_DA_CLASSE[c] }))}
        />
      </div>

      {forma.metodo === "codigo" && (
        <Grupo
          titulo="Códigos"
          ajuda="Uma regra pode ter muitos códigos — 500 de influenciador, um relatório só. O código é único na loja inteira."
          erro={erros["codigos.0.codigo"] ?? null}
        >
          {forma.codigos.map((codigo, i) => (
            <LinhaRemovivel
              key={i}
              oQue={`o código ${codigo.codigo || i + 1}`}
              aoRemover={() => mudar({ codigos: forma.codigos.filter((_, j) => j !== i) })}
            >
              <Campo
                rotulo="Código"
                className="min-w-[160px] flex-1"
                value={codigo.codigo}
                erro={erros[`codigos.${i}.codigo`] ?? null}
                spellCheck={false}
                autoComplete="off"
                placeholder="CAFE20"
                onChange={(e) =>
                  mudar({
                    /* MAIÚSCULAS ENQUANTO SE DIGITA. O `CHECK` do banco é
                       `^[A-Z0-9]{3,30}$`, e deixar o gestor digitar em
                       minúscula para recusar depois é fazê-lo descobrir a regra
                       pelo erro. */
                    codigos: forma.codigos.map((c, j) =>
                      j === i ? { ...c, codigo: e.target.value.toUpperCase() } : c,
                    ),
                  })
                }
              />
              <Campo
                rotulo="Limite deste código"
                className="w-[150px]"
                inputMode="numeric"
                value={codigo.limite_usos}
                erro={erros[`codigos.${i}.limite_usos`] ?? null}
                ajuda="Em branco = sem limite."
                onChange={(e) =>
                  mudar({
                    codigos: forma.codigos.map((c, j) =>
                      j === i ? { ...c, limite_usos: e.target.value } : c,
                    ),
                  })
                }
              />
              <Marcador
                rotulo="Uso único"
                checked={codigo.uso_unico}
                onChange={(e) =>
                  mudar({
                    codigos: forma.codigos.map((c, j) =>
                      j === i ? { ...c, uso_unico: e.target.checked } : c,
                    ),
                  })
                }
              />
              <Marcador
                rotulo="Ativo"
                checked={codigo.ativo}
                onChange={(e) =>
                  mudar({
                    codigos: forma.codigos.map((c, j) =>
                      j === i ? { ...c, ativo: e.target.checked } : c,
                    ),
                  })
                }
              />
            </LinhaRemovivel>
          ))}
          <Botao
            variante="secundaria"
            className="mt-2"
            onClick={() =>
              mudar({
                codigos: [
                  ...forma.codigos,
                  { codigo: "", uso_unico: false, limite_usos: "", ativo: true },
                ],
              })
            }
          >
            Acrescentar código
          </Botao>
        </Grupo>
      )}
    </div>
  );
}

function PassoQuanto({ forma, erros, mudar }: Props) {
  const uso = rotuloDoValor(forma.mecanica);

  return (
    <div className="space-y-4">
      <Selecao
        rotulo="Mecânica"
        value={forma.mecanica}
        erro={erros.mecanica ?? null}
        onChange={(e) => mudar({ mecanica: e.target.value as Mecanica })}
        /*
          `brinde` FICA NA LISTA, DESABILITADO, e o motivo aparece abaixo.
          Escondê-la faria o gestor procurar "brinde", não achar, e concluir que
          a tela está incompleta — quando o problema é que o motor não a calcula
          e a regra salva ficaria INERTE.
        */
        opcoes={MECANICAS.map((m) => ({
          valor: m,
          rotulo: MECANICAS_INERTES.includes(m)
            ? `${NOME_DA_MECANICA[m]} (indisponível)`
            : NOME_DA_MECANICA[m],
          desabilitada: MECANICAS_INERTES.includes(m) && forma.mecanica !== m,
        }))}
        ajuda="“Brinde” está indisponível: o motor de descontos ainda não calcula ajuste para ela, e a regra ficaria salva sem descontar nada."
      />

      {uso.usa && (
        <Campo
          rotulo={uso.rotulo}
          required
          inputMode="decimal"
          value={forma.valor}
          erro={erros.valor ?? null}
          ajuda={uso.ajuda}
          onChange={(e) => mudar({ valor: e.target.value })}
        />
      )}

      {/*
        O TETO EM DINHEIRO É A OUTRA METADE DA DEFESA, e por isso ele está aqui
        e não escondido em "avançado": "20% de desconto" numa compra de R$ 3.000
        são R$ 600 que ninguém aprovou. O banco não tem padrão nenhum para ele —
        NULL é sem teto —, então é a tela que precisa lembrar.
      */}
      <Campo
        rotulo="Teto do desconto (R$)"
        inputMode="decimal"
        value={forma.teto_desconto_reais}
        erro={erros.teto_desconto_reais ?? null}
        ajuda="O máximo que esta regra pode descontar num pedido. Em branco = sem teto."
        placeholder="30,00"
        onChange={(e) => mudar({ teto_desconto_reais: e.target.value })}
      />

      {usaFaixas(forma.mecanica) && (
        <Grupo
          titulo="Faixas"
          ajuda={
            forma.mecanica === "progressivo"
              ? "A partir de quantos itens vale cada desconto. Cada piso só pode aparecer uma vez."
              : "Quantos itens o cliente paga (Y) quando leva a quantidade da faixa."
          }
          erro={erros["faixas.0.quantidade_min"] ?? null}
        >
          {forma.faixas.map((faixa, i) => (
            <LinhaRemovivel
              key={i}
              oQue={`a faixa a partir de ${faixa.quantidade_min || i + 1} itens`}
              aoRemover={() => mudar({ faixas: forma.faixas.filter((_, j) => j !== i) })}
            >
              <Campo
                rotulo="A partir de (itens)"
                className="w-[150px]"
                inputMode="numeric"
                value={faixa.quantidade_min}
                erro={erros[`faixas.${i}.quantidade_min`] ?? null}
                onChange={(e) =>
                  mudar({
                    faixas: forma.faixas.map((f, j) =>
                      j === i ? { ...f, quantidade_min: e.target.value } : f,
                    ),
                  })
                }
              />
              <Selecao
                rotulo="Tipo"
                className="w-[160px]"
                value={faixa.desconto_tipo}
                onChange={(e) =>
                  mudar({
                    faixas: forma.faixas.map((f, j) =>
                      j === i ? { ...f, desconto_tipo: e.target.value as TipoDeFaixa } : f,
                    ),
                  })
                }
                opcoes={TIPOS_DE_FAIXA.map((t) => ({
                  valor: t,
                  rotulo:
                    t === "pague_y"
                      ? "Paga só (itens)"
                      : t === "percentual"
                        ? "Percentual (%)"
                        : t === "valor_fixo"
                          ? "Valor fixo (R$)"
                          : "Preço fixo (R$)",
                }))}
              />
              <Campo
                rotulo="Valor"
                className="w-[130px]"
                inputMode="decimal"
                value={faixa.desconto_valor}
                erro={erros[`faixas.${i}.desconto_valor`] ?? null}
                onChange={(e) =>
                  mudar({
                    faixas: forma.faixas.map((f, j) =>
                      j === i ? { ...f, desconto_valor: e.target.value } : f,
                    ),
                  })
                }
              />
            </LinhaRemovivel>
          ))}
          <Botao
            variante="secundaria"
            className="mt-2"
            onClick={() =>
              mudar({
                faixas: [
                  ...forma.faixas,
                  {
                    quantidade_min: "",
                    desconto_tipo: forma.mecanica === "leve_x_pague_y" ? "pague_y" : "percentual",
                    desconto_valor: "",
                  },
                ],
              })
            }
          >
            Acrescentar faixa
          </Botao>
        </Grupo>
      )}
    </div>
  );
}

function PassoQuem({
  forma,
  mudar,
}: {
  forma: FormularioDeDesconto;
  mudar: Props["mudar"];
}) {
  const assinante = forma.escopo.find((e) => e.tipo === "assinante");

  return (
    <div className="space-y-5">
      <Grupo
        titulo="Meios de pagamento"
        ajuda="Nenhum marcado = qualquer meio. Marcados = só esses. É o desconto no PIX, e ele nasce podendo ter escopo por categoria."
      >
        <div className="grid gap-x-6 sm:grid-cols-2">
          {MEIOS_DE_PAGAMENTO.map((meio) => (
            <Marcador
              key={meio}
              rotulo={NOME_DO_MEIO[meio]}
              checked={forma.meios_pagamento.includes(meio)}
              onChange={(e) =>
                mudar({
                  meios_pagamento: e.target.checked
                    ? [...forma.meios_pagamento, meio]
                    : forma.meios_pagamento.filter((m) => m !== meio),
                })
              }
            />
          ))}
        </div>
      </Grupo>

      <Grupo
        titulo="Assinantes do Clube"
        ajuda="Uma regra pode valer só para assinantes, ou só para quem NÃO é — é um porteiro sobre o carrinho, não um alvo."
      >
        <Selecao
          rotulo="Quem pode usar"
          value={assinante ? (assinante.incluir ? "so_assinante" : "so_nao_assinante") : "qualquer"}
          onChange={(e) => {
            const sem = forma.escopo.filter((linha) => linha.tipo !== "assinante");
            if (e.target.value === "qualquer") return mudar({ escopo: sem });
            mudar({
              escopo: [
                ...sem,
                {
                  tipo: "assinante" as TipoDeEscopo,
                  alvo: "",
                  incluir: e.target.value === "so_assinante",
                },
              ],
            });
          }}
          opcoes={[
            { valor: "qualquer", rotulo: "Qualquer cliente" },
            { valor: "so_assinante", rotulo: "Só assinantes do Clube" },
            { valor: "so_nao_assinante", rotulo: "Só quem NÃO é assinante" },
          ]}
        />
      </Grupo>
    </div>
  );
}

function PassoEscopo({
  forma,
  erros,
  mudar,
  produtos,
  categorias,
}: Props & { produtos: ProdutoDoSeletor[]; categorias: string[] }) {
  /* A linha de `assinante` é editada no passo "Para quem" e some daqui: o mesmo
     campo em dois lugares vira dois campos que discordam. */
  const visiveis = forma.escopo
    .map((linha, indice) => ({ linha, indice }))
    .filter(({ linha }) => linha.tipo !== "assinante");

  function trocar(indice: number, mudanca: Partial<(typeof forma.escopo)[number]>) {
    mudar({ escopo: forma.escopo.map((l, j) => (j === indice ? { ...l, ...mudanca } : l)) });
  }

  return (
    <div className="space-y-4">
      {/*
        A EXCEÇÃO É O QUE FAZ ESTA TABELA VALER A PENA. `promocao_escopo` tem uma
        coluna `incluir` justamente para permitir "10% na loja toda, MENOS o
        micro-lote" — sem ela, excluir um produto exigiria listar todos os
        outros à mão, e um café novo entraria na promoção sem ninguém pedir.
      */}
      <p className="max-w-[62ch] text-[13px] text-fuligem-55">
        Cada linha inclui ou EXCLUI. “Todos os produtos” mais uma exclusão do
        micro-lote é como se faz “10% na loja toda, menos o micro-lote”.
      </p>

      <div className="border-t border-fuligem-20">
        {visiveis.map(({ linha, indice }) => (
          <LinhaRemovivel
            key={indice}
            oQue={`a linha de escopo ${linha.alvo || linha.tipo}`}
            aoRemover={() => mudar({ escopo: forma.escopo.filter((_, j) => j !== indice) })}
          >
            <Selecao
              rotulo="Incluir ou excluir"
              className="w-[140px]"
              value={linha.incluir ? "incluir" : "excluir"}
              onChange={(e) => trocar(indice, { incluir: e.target.value === "incluir" })}
              opcoes={[
                { valor: "incluir", rotulo: "Inclui" },
                { valor: "excluir", rotulo: "EXCLUI" },
              ]}
            />
            <Selecao
              rotulo="Tipo"
              className="w-[150px]"
              value={linha.tipo}
              onChange={(e) =>
                trocar(indice, { tipo: e.target.value as TipoDeEscopo, alvo: "" })
              }
              opcoes={TIPOS_DE_ESCOPO.filter((t) => t !== "assinante").map((t) => ({
                valor: t,
                rotulo:
                  t === "todos"
                    ? "Todos os produtos"
                    : t === "produto"
                      ? "Produto"
                      : t === "categoria"
                        ? "Categoria"
                        : "SKU",
              }))}
            />
            {linha.tipo === "produto" && (
              <Selecao
                rotulo="Produto"
                className="min-w-[200px] flex-1"
                value={linha.alvo}
                erro={erros[`escopo.${indice}.alvo`] ?? null}
                onChange={(e) => trocar(indice, { alvo: e.target.value })}
                opcoes={[
                  { valor: "", rotulo: "Escolha um produto" },
                  ...produtos.map((p) => ({
                    valor: p.product_id,
                    rotulo: `${p.name ?? "Sem nome"}${p.sku ? ` · ${p.sku}` : ""}`,
                  })),
                ]}
              />
            )}
            {linha.tipo === "categoria" && (
              <Selecao
                rotulo="Categoria"
                className="min-w-[200px] flex-1"
                value={linha.alvo}
                erro={erros[`escopo.${indice}.alvo`] ?? null}
                onChange={(e) => trocar(indice, { alvo: e.target.value })}
                opcoes={[
                  { valor: "", rotulo: "Escolha uma categoria" },
                  ...categorias.map((c) => ({ valor: c, rotulo: c })),
                ]}
              />
            )}
            {linha.tipo === "sku" && (
              <Campo
                rotulo="SKU"
                className="min-w-[180px] flex-1"
                value={linha.alvo}
                erro={erros[`escopo.${indice}.alvo`] ?? null}
                spellCheck={false}
                onChange={(e) => trocar(indice, { alvo: e.target.value })}
              />
            )}
          </LinhaRemovivel>
        ))}
      </div>

      <Botao
        variante="secundaria"
        onClick={() =>
          mudar({
            escopo: [...forma.escopo, { tipo: "todos" as TipoDeEscopo, alvo: "", incluir: true }],
          })
        }
      >
        Acrescentar linha
      </Botao>
    </div>
  );
}

function PassoLimites({ forma, erros, mudar }: Props) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Selecao
          rotulo="Mínimo do carrinho"
          value={forma.minimo_tipo}
          onChange={(e) => mudar({ minimo_tipo: e.target.value as MinimoTipo })}
          opcoes={MINIMOS.map((m) => ({
            valor: m,
            rotulo:
              m === "nenhum" ? "Sem mínimo" : m === "subtotal" ? "Valor (R$)" : "Quantidade de itens",
          }))}
        />
        {forma.minimo_tipo !== "nenhum" && (
          <Campo
            rotulo={forma.minimo_tipo === "subtotal" ? "Mínimo (R$)" : "Mínimo (itens)"}
            inputMode={forma.minimo_tipo === "subtotal" ? "decimal" : "numeric"}
            value={forma.minimo_valor}
            erro={erros.minimo_valor ?? null}
            onChange={(e) => mudar({ minimo_valor: e.target.value })}
          />
        )}
      </div>

      <Grupo
        titulo="Limites de uso"
        ajuda="Em branco significa SEM limite — nunca zero. São eles que impedem um código vazado de comer a margem do mês."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo
            rotulo="Usos no total"
            inputMode="numeric"
            value={forma.limite_usos}
            erro={erros.limite_usos ?? null}
            onChange={(e) => mudar({ limite_usos: e.target.value })}
          />
          {/*
            POR CPF, E NÃO POR E-MAIL — e a ajuda diz por quê. E-mail é infinito
            e gratuito: cupom de primeira compra controlado por e-mail é cupom
            permanente. O que o banco guarda no resgate é o SHA-256 do CPF,
            nunca o número.
          */}
          <Campo
            rotulo="Usos por CPF"
            inputMode="numeric"
            value={forma.limite_por_cliente}
            erro={erros.limite_por_cliente ?? null}
            ajuda="Por CPF porque e-mail é infinito e gratuito."
            onChange={(e) => mudar({ limite_por_cliente: e.target.value })}
          />
          <Campo
            rotulo="Orçamento (R$)"
            inputMode="decimal"
            value={forma.orcamento_reais}
            erro={erros.orcamento_reais ?? null}
            ajuda="Quando a soma descontada chegar aqui, a regra para."
            onChange={(e) => mudar({ orcamento_reais: e.target.value })}
          />
        </div>
      </Grupo>

      <Grupo
        titulo="Ordem e exclusividade"
        ajuda="Duas regras da mesma classe se somam por padrão. A exclusividade é o que impede isso — e ela vale por classe: uma regra exclusiva de produto não cala o frete grátis."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Prioridade"
            inputMode="numeric"
            value={forma.prioridade}
            erro={erros.prioridade ?? null}
            ajuda="Maior aplica primeiro. Empate desempata pela data de criação."
            onChange={(e) => mudar({ prioridade: e.target.value })}
          />
          <Campo
            rotulo="Grupo de exclusividade"
            value={forma.grupo_exclusividade}
            erro={erros.grupo_exclusividade ?? null}
            ajuda="Regras do mesmo grupo se excluem entre si. Em branco e exclusiva = corta a classe inteira."
            onChange={(e) => mudar({ grupo_exclusividade: e.target.value })}
          />
        </div>
        <Marcador
          className="mt-2"
          rotulo="Exclusiva — nenhuma outra regra desta classe se soma a ela"
          checked={forma.exclusiva}
          onChange={(e) => mudar({ exclusiva: e.target.checked })}
        />
      </Grupo>
    </div>
  );
}

function PassoJanela({ forma, erros, mudar }: Props) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {/*
          `datetime-local` E NÃO `date`: "vale a partir de 24/11" sem hora é
          ambíguo entre meia-noite e o momento em que se salvou, e uma Black
          Friday que começa doze horas antes do previsto é dinheiro. A hora é
          gravada em `America/Sao_Paulo`, com o fuso explícito no payload.
        */}
        <Campo
          rotulo="Começa em"
          type="datetime-local"
          value={forma.inicio_em}
          erro={erros.inicio_em ?? null}
          ajuda="Horário de Brasília. Em branco: vale desde já."
          onChange={(e) => mudar({ inicio_em: e.target.value })}
        />
        <Campo
          rotulo="Termina em"
          type="datetime-local"
          value={forma.fim_em}
          erro={erros.fim_em ?? null}
          ajuda="Horário de Brasília. Em branco: vale para sempre."
          onChange={(e) => mudar({ fim_em: e.target.value })}
        />
      </div>

      {/*
        O TOGGLE NUNCA É DESABILITADO PELA JANELA. No painel legado ele ficava
        `disabled` quando a data estava fora do intervalo — e como o mesmo load
        já tinha gravado `ativa = false`, a promoção ficava inalcançável pela
        tela. Corrigir a data de uma regra vencida é justamente o gesto que essa
        trava impedia.
      */}
      <Grupo
        titulo="Estado"
        ajuda="Ligar é uma decisão sua e independe da janela. Uma regra vencida continua podendo ser ligada — é assim que se corrige a data e se aproveita a regra em vez de recriá-la."
      >
        <Marcador
          rotulo="Ligada"
          checked={forma.habilitada}
          onChange={(e) => mudar({ habilitada: e.target.checked })}
        />
      </Grupo>
    </div>
  );
}

function PassoFrete({ forma, erros, mudar }: Props) {
  const f = forma.frete;
  const trocar = (mudanca: Partial<typeof f>) => mudar({ frete: { ...f, ...mudanca } });

  return (
    <div className="space-y-5">
      {/*
        O TETO DO FRETE É O CAMPO QUE SANGRA MARGEM TODA SEMANA QUANDO FALTA.
        Hoje a loja tem um número global — `config_loja.frete_gratis_minimo_centavos`
        — e nada mais: "café tem frete comparável ao produto; sem o teto, 'frete
        grátis acima de R$ 149' significa bancar um SEDEX de R$ 90 para o Acre".
      */}
      <Campo
        rotulo="Teto do valor do frete (R$)"
        inputMode="decimal"
        value={f.teto_frete_reais}
        erro={erros["frete.teto_frete_reais"] ?? null}
        ajuda="Acima deste valor de frete, a regra não vale. Em branco, a loja banca qualquer frete."
        placeholder="35,00"
        onChange={(e) => trocar({ teto_frete_reais: e.target.value })}
      />

      <Marcador
        rotulo="Só na modalidade mais barata"
        ajuda="Sem isto, o cliente escolhe o SEDEX de graça quando a loja queria bancar o PAC."
        checked={f.apenas_modalidade_mais_barata}
        onChange={(e) => trocar({ apenas_modalidade_mais_barata: e.target.checked })}
      />

      <Grupo
        titulo="Onde vale"
        ajuda="UFs, faixa de CEP, as duas ou nenhuma. Sem nada marcado, vale para o Brasil inteiro."
        erro={erros["frete.ufs"] ?? null}
      >
        <div className="grid grid-cols-3 gap-x-4 sm:grid-cols-5 lg:grid-cols-7">
          {UFS.map((uf) => (
            <Marcador
              key={uf}
              rotulo={uf}
              checked={f.ufs.includes(uf)}
              onChange={(e) =>
                trocar({
                  ufs: e.target.checked
                    ? [...f.ufs, uf as Uf]
                    : f.ufs.filter((u) => u !== uf),
                })
              }
            />
          ))}
        </div>
      </Grupo>

      <Grupo
        titulo="Faixa de CEP"
        ajuda="Os dois extremos, ou nenhum. O hífen pode ir: ele é removido antes de qualquer comparação — comparar '01310-100' com '01310100' é um bug que só aparece em produção."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="CEP inicial"
            inputMode="numeric"
            value={f.cep_inicio}
            erro={erros["frete.cep_inicio"] ?? null}
            placeholder="01310-100"
            onChange={(e) => trocar({ cep_inicio: e.target.value })}
          />
          <Campo
            rotulo="CEP final"
            inputMode="numeric"
            value={f.cep_fim}
            erro={erros["frete.cep_fim"] ?? null}
            placeholder="01310-999"
            onChange={(e) => trocar({ cep_fim: e.target.value })}
          />
        </div>
      </Grupo>
    </div>
  );
}

/* ========================================================================== *
 * Arquivar — R11/R12/R13
 * ========================================================================== */

/**
 * O BLOCO DESTRUTIVO FICA LONGE DA CONFIRMAÇÃO — R11. Ele mora no fim da
 * coluna, separado por um filete e por um título próprio, e a confirmação é um
 * diálogo que NOMEIA a regra e diz a consequência. "Tem certeza?" não carrega
 * informação nenhuma e treina a clicar em OK.
 *
 * E O VERBO É ARQUIVAR, NUNCA EXCLUIR — R13. Aqui não é só doutrina:
 * `promocao_resgates` referencia a promoção com `ON DELETE RESTRICT`, então o
 * banco recusa apagar uma regra já usada. Um botão "Excluir" que funciona só na
 * regra nunca usada falha de forma imprevisível — e apagar a nunca usada também
 * levaria o registro de que a campanha existiu.
 */
function BlocoDeArquivo({
  regra,
  aoPedir,
}: {
  regra: RegraCompleta;
  aoPedir: () => void;
}) {
  return (
    <Ficha titulo={regra.arquivada_em ? "Regra arquivada" : "Tirar do ar"}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[52ch] text-[13px] text-fuligem-55">
          {regra.arquivada_em
            ? "Esta regra está arquivada: ela não aparece na lista padrão e não desconta nada. O histórico dela continua nos relatórios."
            : "Arquivar tira a regra do ar e a esconde da lista. Nada é apagado — os resgates já feitos continuam no histórico, e é por isso que não existe “excluir” aqui."}
        </p>
        <Botao variante={regra.arquivada_em ? "secundaria" : "destrutiva"} onClick={aoPedir}>
          {regra.arquivada_em ? "Desarquivar" : "Arquivar"}
        </Botao>
      </div>
    </Ficha>
  );
}
