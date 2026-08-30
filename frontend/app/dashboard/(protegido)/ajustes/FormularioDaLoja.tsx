"use client";

import { useEffect, useState, useTransition } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Tarja } from "@/components/painel/ui/Tarja";
import {
  ONDE_A_LOJA_LE,
  analisarFreteGratis,
  avisoDoFreteGratis,
  estadoInicialDaLoja,
  houveMudanca,
  type EstadoDaLoja,
  type RespostaDaConfig,
} from "@/lib/painel/ajustes/ajustes.logica";

import { salvarLoja } from "./acoes";

/**
 * A configuração da loja — três campos, e um deles já desligou o frete grátis
 * inteiro sem ninguém pedir.
 *
 * R6 — NADA DE AUTOSAVE, e aqui a razão tem número: o piso do frete grátis
 * salvo por engano em zero libera frete grátis para toda a loja. "Autosave só
 * onde o erro custa zero" é literal, e este é o extremo oposto.
 *
 * R5 — SAVE BAR CONTEXTUAL: ela aparece quando há alteração pendente, traz
 * Salvar e Descartar, e o navegador avisa antes de sair. O gestor nunca procura
 * onde salvar, e nunca perde o que digitou.
 *
 * R9 — o resultado é BANNER PERSISTENTE, nunca toast: um flash pode não ser
 * anunciado pelo leitor de tela, some na ampliação e não pode ser relido. Numa
 * tela que se abre uma vez por mês, "não vi a mensagem" é "não sei se salvei".
 */
export function FormularioDaLoja({ config }: { config: RespostaDaConfig | null }) {
  /**
   * O ESTADO DO SERVIDOR VIRA O ESTADO INICIAL — e ele se rende quando o
   * servidor muda, pelo mesmo padrão sem `useEffect` de `BuscaDaLista`.
   *
   * Depois de salvar, `revalidatePath` traz a config nova e este componente
   * re-renderiza. Sem esta reconciliação, `inicial` continuaria sendo o valor
   * VELHO: a barra de salvar ficaria acesa para sempre depois do primeiro
   * salvamento, prometendo repetir uma gravação que já aconteceu.
   */
  const [inicial, setInicial] = useState(() => estadoInicialDaLoja(config));
  const [estado, setEstado] = useState<EstadoDaLoja>(inicial);
  const [doServidor, setDoServidor] = useState(inicial);

  const vindoDoServidor = estadoInicialDaLoja(config);
  if (
    vindoDoServidor.titulo !== doServidor.titulo ||
    vindoDoServidor.whatsapp !== doServidor.whatsapp ||
    vindoDoServidor.freteGratisReais !== doServidor.freteGratisReais
  ) {
    setDoServidor(vindoDoServidor);
    setInicial(vindoDoServidor);
    setEstado(vindoDoServidor);
  }

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const sujo = houveMudanca(inicial, estado);
  const frete = analisarFreteGratis(estado.freteGratisReais);
  const avisoDoZero = avisoDoFreteGratis(frete);

  /**
   * R5 — O BLOQUEIO DE SAÍDA COM ALTERAÇÃO PENDENTE.
   *
   * `beforeunload` é o único gancho que alcança fechar a aba e recarregar; a
   * navegação interna do Next não passa por ele, e não há API pública estável
   * para interceptá-la no App Router — está anotado, e é o pedaço do R5 que
   * esta tela não entrega. O que ela entrega cobre o caso mais comum e o mais
   * caro: o F5 e o fechar sem querer.
   *
   * O ouvinte só existe ENQUANTO há o que perder. Registrado sempre, alguns
   * navegadores tratam a página como "não elegível para cache de retorno" e a
   * volta pelo botão Voltar deixa de ser instantânea — um custo permanente por
   * um aviso que quase nunca é necessário.
   */
  useEffect(() => {
    if (!sujo) return;
    function avisar(evento: BeforeUnloadEvent) {
      evento.preventDefault();
      // Os navegadores modernos ignoram o texto e mostram o deles; a atribuição
      // continua sendo o que aciona o diálogo nos mais antigos.
      evento.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  function mudar(campo: keyof EstadoDaLoja, valor: string) {
    setErro(null);
    setAviso(null);
    setEstado((atual) => ({ ...atual, [campo]: valor }));
  }

  function salvar() {
    setErro(null);
    setAviso(null);

    /*
      O SUBMIT É ATÔMICO: frete inválido aborta TUDO, e nem o título sobe. Um
      salvamento parcial deixaria o gestor com metade do formulário gravado e
      nenhuma pista de qual metade — ele releria a tela, veria o título novo, e
      concluiria que o frete também foi.
    */
    if (frete.tipo === "invalido") {
      setErro(frete.erro);
      return;
    }

    iniciar(async () => {
      const r = await salvarLoja(estado);
      if (r.ok) {
        setAviso(r.frase);
        // A barra some porque o que estava pendente foi gravado. O
        // `revalidatePath` da ação traz a config nova logo em seguida e a
        // reconciliação acima confirma o mesmo valor.
        setInicial(estado);
      } else {
        setErro(r.erro);
      }
    });
  }

  function descartar() {
    setErro(null);
    setAviso(null);
    setEstado(inicial);
  }

  return (
    <div className="space-y-4">
      {erro && <Tarja onFechar={() => setErro(null)}>{erro}</Tarja>}
      {aviso && (
        <Tarja tom="sucesso" onFechar={() => setAviso(null)}>
          {aviso}
        </Tarja>
      )}

      <Campo
        rotulo="Piso do frete grátis"
        // `inputMode="decimal"` e não `type="number"`: o campo numérico do HTML
        // usa o separador da LOCALIDADE do navegador, e num Chrome em inglês
        // ele recusa a vírgula que todo brasileiro digita — sem dizer por quê.
        inputMode="decimal"
        value={estado.freteGratisReais}
        onChange={(evento) => mudar("freteGratisReais", evento.target.value)}
        placeholder="149,00"
        disabled={salvando}
        ajuda="Em reais, com vírgula. Acima deste valor o frete sai de graça."
        /*
          `validar` E NÃO `erro`, e a diferença é quando a reclamação aparece.

          Passado por `erro`, o alerta é imediato: quem digita "149," vê "Use
          reais…" no meio da própria digitação, porque "149," ainda não é
          dinheiro. O <Campo> desta casa já resolve isso — cala até o primeiro
          blur e só então perdoa ao vivo —, e é esse contrato que `validar`
          aciona. O caminho do submit continua coberto: frete inválido aborta
          tudo e escreve a mesma frase na tarja acima, então quem nunca saiu do
          campo também a lê.

          Campo em branco NÃO é inválido: "não mexer neste campo" é uma escolha,
          e a mais segura de todas.
        */
        validar={(valor) => {
          const r = analisarFreteGratis(valor);
          return r.tipo === "invalido" ? r.erro : null;
        }}
        className="max-w-[18rem]"
      />

      {/*
        A FRASE QUE IMPEDE O ZERO ACIDENTAL, e ela aparece ANTES de salvar.
        Zero é legítimo — é como se desliga o frete grátis de propósito —, e por
        isso é alerta e não erro: o que não pode é acontecer por descuido, que é
        exatamente como acontecia (campo em branco virava `Number('') === 0`).
      */}
      {avisoDoZero && <Tarja tom="alerta">{avisoDoZero}</Tarja>}

      <p className="max-w-[70ch] text-[12px] text-fuligem-55">
        {ONDE_A_LOJA_LE.frete_gratis_minimo_centavos} Deixar o campo em branco
        NÃO zera: em branco quer dizer &quot;não mexer&quot;, e o valor de hoje
        continua valendo.
      </p>

      <Campo
        rotulo="Título do site"
        value={estado.titulo}
        onChange={(evento) => mudar("titulo", evento.target.value)}
        disabled={salvando}
        ajuda={ONDE_A_LOJA_LE.site_title}
      />

      <Campo
        rotulo="WhatsApp da loja"
        inputMode="tel"
        value={estado.whatsapp}
        onChange={(evento) => mudar("whatsapp", evento.target.value)}
        placeholder="5537999990000"
        disabled={salvando}
        // A pontuação é aceita e removida NA SAÍDA, não enquanto se digita:
        // apagar a pontuação debaixo do cursor é o jeito mais rápido de tornar
        // um campo impossível de corrigir.
        ajuda={`Pode digitar com pontuação — só os números são gravados. ${ONDE_A_LOJA_LE.whatsapp_number}`}
        className="max-w-[22rem]"
      />

      {/*
        R5 — A SAVE BAR CONTEXTUAL. Ela aparece SÓ com alteração pendente, e
        some ao salvar ou descartar: uma barra permanente vira parte do cenário e
        deixa de dizer "há trabalho não salvo aqui".

        "Descartar" antes de "Salvar", e com peso menor: a ordem de leitura do
        português é a da varredura visual, e o último elemento é onde o polegar
        chega primeiro no celular.
      */}
      {sujo && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-fuligem-20 pt-4"
        >
          <p className="text-[12px] text-fuligem-55">
            Há alterações não salvas.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Botao variante="secundaria" disabled={salvando} onClick={descartar}>
              Descartar
            </Botao>
            <Botao disabled={salvando} onClick={salvar}>
              {/* R14 pelo mesmo princípio do dinheiro: nada de UI otimista.
                  Enquanto o servidor não confirma, o botão diz "Salvando…" e os
                  campos ficam travados — o pior estado não é lento, é "não sei
                  se aconteceu". */}
              {salvando ? "Salvando…" : "Salvar"}
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}
