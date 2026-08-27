"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import {
  formularioDe,
  formularioVazio,
  montarPayload,
  urlDaTela,
  validarCampanha,
  type Campanha,
  type ErrosDaCampanha,
  type EstadoDasCampanhas,
  type FormularioDeCampanha as Dados,
} from "@/lib/painel/marketing/campanhas.logica";
import { CANAIS_DE_CAMPANHA } from "@/lib/painel/marketing/vocabulario";

import { salvarCampanha } from "./acoes";

/**
 * O formulário de campanha — criação e edição na mesma ficha.
 *
 * NÃO É UM DIÁLOGO. Um modal cobriria a tabela, que é justamente onde está a
 * informação de referência: "esta UTM já existe?", "quanto gastei na campanha
 * parecida do mês passado?". R26 diz isso do detalhe e a razão é a mesma aqui —
 * o modal esconde o que a pessoa precisa consultar enquanto preenche.
 */
export function FormularioDeCampanha({
  campanha,
  estado,
}: {
  /** `null` = criação. */
  campanha: Campanha | null;
  estado: EstadoDasCampanhas;
}) {
  const router = useRouter();

  const [dados, setDados] = useState<Dados>(
    campanha ? formularioDe(campanha) : formularioVazio(),
  );
  const [erros, setErros] = useState<ErrosDaCampanha>({});
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  /**
   * A TRAVA DE DUPLO CLIQUE É UM `useRef`, E NÃO UM `useState` — e isto é a
   * lição do `useBlingAcoes` desta casa, escrita para não se perder de novo.
   *
   * `setState` é ASSÍNCRONO: dois cliques no mesmo tick leem o mesmo estado
   * "livre" e disparam duas vezes. O `disabled={salvando}` abaixo cobre o caso
   * lento e não cobre esse — e aqui a consequência é específica e cara: o POST
   * é um UPSERT por UTM, então duas idas simultâneas com a mesma UTM disputam a
   * mesma linha. Com o ref, a segunda entrada sai antes de tocar na rede.
   */
  const emVoo = useRef(false);

  const editando = campanha !== null;

  function mudar<C extends keyof Dados>(campo: C, valor: Dados[C]) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
    // O erro do campo some quando a pessoa mexe nele: manter a frase vermelha
    // sob um campo que ela acabou de corrigir é discutir com quem já obedeceu.
    setErros((atuais) => ({ ...atuais, [campo]: undefined }));
  }

  function fechar() {
    router.push(urlDaTela({ ...estado, editar: "" }));
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emVoo.current) return;

    const encontrados = validarCampanha(dados);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      setErroDoServidor(null);
      return;
    }

    emVoo.current = true;
    setSalvando(true);
    setErroDoServidor(null);

    try {
      const resposta = await salvarCampanha(montarPayload(dados));
      if (!resposta.ok) {
        /*
          A FRASE DO SERVIDOR, INTEIRA. O Express responde com o diagnóstico
          ("A UTM da campanha não pode conter espaço — use hífen"), e trocá-lo
          por "Erro ao salvar" transforma um problema de dois minutos num
          chamado. É TARJA e não toast (R9): erro se lê no ritmo de quem lê.
        */
        setErroDoServidor(resposta.erro);
        return;
      }
      fechar();
    } finally {
      emVoo.current = false;
      setSalvando(false);
    }
  }

  return (
    <Ficha titulo={editando ? `Editar «${campanha.nome}»` : "Nova campanha"}>
      <form onSubmit={enviar} className="space-y-5" noValidate>
        {erroDoServidor && (
          <Tarja tom="erro" onFechar={() => setErroDoServidor(null)}>
            {erroDoServidor}
          </Tarja>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Nome da campanha"
            required
            value={dados.nome}
            erro={erros.nome ?? null}
            onChange={(e) => mudar("nome", e.target.value)}
            placeholder="Dia das Mães 2026"
            ajuda="É o nome que aparece no relatório. Escreva como você o chama."
          />

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="canal-da-campanha"
              className={`text-[11px] ${ETIQUETA} text-fuligem-55`}
            >
              Canal <span aria-hidden="true">*</span>
            </label>
            {/*
              UM `<select>` NATIVO, e não um combobox do Radix: são oito opções
              fechadas, sem busca e sem agrupamento. O nativo já traz teclado,
              leitor de tela e o seletor de rolagem do celular — e o Radix
              ganharia estilo em troca de código que teria de manter tudo isso.
            */}
            <select
              id="canal-da-campanha"
              required
              value={dados.canal}
              onChange={(e) => mudar("canal", e.target.value)}
              aria-invalid={erros.canal ? true : undefined}
              className={`min-h-11 rounded-bt border bg-cal-puro px-3 text-fuligem ${FOCO} ${
                erros.canal ? "border-vermelho" : "border-fuligem-20 hover:border-fuligem-55"
              }`}
            >
              <option value="">Escolha…</option>
              {CANAIS_DE_CAMPANHA.map((canal) => (
                <option key={canal.valor} value={canal.valor}>
                  {canal.rotulo}
                </option>
              ))}
            </select>
            {erros.canal && <p className="text-[13px] text-vermelho">{erros.canal}</p>}
          </div>

          <Campo
            rotulo="UTM da campanha"
            value={dados.utm_campaign}
            erro={erros.utm_campaign ?? null}
            onChange={(e) => mudar("utm_campaign", e.target.value)}
            placeholder="dia-das-maes-2026"
            /*
              A AJUDA DIZ AS TRÊS COISAS QUE A PESSOA NÃO TEM COMO ADIVINHAR: que
              a UTM é a chave que liga a venda à campanha, que maiúscula é
              normalizada sozinha, e que campanha sem link rastreado pode ficar
              sem UTM. Sem a terceira, quem cadastra o panfleto inventa uma UTM
              que não existe em anúncio nenhum.
            */
            ajuda="É a chave que liga a venda a esta campanha — tem de ser IGUAL à do link do anúncio. Maiúscula vira minúscula sozinha; espaço não é aceito. Campanha sem link rastreado (panfleto, indicação) pode ficar em branco."
          />

          <Campo
            rotulo="Custo de mídia (R$)"
            inputMode="decimal"
            value={dados.custoEmReais}
            erro={erros.custoEmReais ?? null}
            onChange={(e) => mudar("custoEmReais", e.target.value)}
            placeholder="1500,00"
            /* Sem o custo o relatório soma receita e chama de resultado — que é
               vaidade, não gestão. A ajuda diz por que o campo existe. */
            ajuda="Quanto foi pago ao veículo. Sem ele o relatório mostra quanto a campanha vendeu e não se ela deu lucro. Em branco vale zero."
          />

          <Campo
            rotulo="Início"
            type="datetime-local"
            value={dados.inicio_em}
            onChange={(e) => mudar("inicio_em", e.target.value)}
          />

          <Campo
            rotulo="Fim"
            type="datetime-local"
            value={dados.fim_em}
            erro={erros.fim_em ?? null}
            onChange={(e) => mudar("fim_em", e.target.value)}
          />
        </div>

        {/*
          O AVISO DA DATA EM BRANCO, e ele existe porque a regra INVERTEU.

          No painel antigo, promoção `ativa` sem datas nunca valia — era a
          armadilha silenciosa daquela tela. Neste modelo, data em branco quer
          dizer "vale sempre". Quem administrou o painel antigo aprendeu a regra
          contrária, e sem esta frase deixaria as datas em branco achando que
          está desativando a campanha.
        */}
        {!dados.inicio_em && !dados.fim_em && (
          <Tarja tom="aviso">
            Sem datas, esta campanha vale <strong>sempre</strong>, até ser desligada.
            (No painel antigo era o contrário: promoção sem data nunca valia.)
          </Tarja>
        )}

        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={dados.ativa}
            onChange={(e) => mudar("ativa", e.target.checked)}
            /* O alvo de toque não se comprime (R22): a densidade sai do padding
               da célula da tabela, nunca da caixa que o dedo precisa acertar. */
            className={`size-5 accent-fuligem ${FOCO}`}
          />
          <span>
            Campanha ligada
            <span className="ml-2 text-[13px] text-fuligem-55">
              Desligada, ela não conta como vigente em nenhuma data.
            </span>
          </span>
        </label>

        {/*
          A BARRA DE SALVAR — R5, e a ordem é a do <Dialogo>: a ação primária por
          último, encostada na borda, que é onde o polegar chega primeiro no
          celular e onde a leitura em português termina.
        */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-fuligem-20 pt-4">
          <Botao variante="secundaria" onClick={fechar} disabled={salvando}>
            Descartar
          </Botao>
          <Botao type="submit" disabled={salvando}>
            {/* R14: dinheiro não usa UI otimista, e custo de mídia é dinheiro. O
                botão diz "salvando" até o servidor confirmar. */}
            {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar campanha"}
          </Botao>
        </div>
      </form>
    </Ficha>
  );
}
