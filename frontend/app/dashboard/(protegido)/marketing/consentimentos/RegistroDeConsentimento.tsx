"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Selo } from "@/components/painel/ui/Selo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { formatarDataHora } from "@/lib/painel/data";
import {
  formularioDeConsentimentoVazio,
  montarPayloadDeConsentimento,
  validarConsentimento,
  type Consentimento,
  type ErrosDoConsentimento,
  type FormularioDeConsentimento as Dados,
} from "@/lib/painel/marketing/consentimentos.logica";
import {
  CANAIS_DE_CONTATO,
  ESTADOS_DE_CONSENTIMENTO,
  rotuloDe,
  tomDe,
} from "@/lib/painel/marketing/vocabulario";

import { consultarTitular, registrarConsentimento } from "../acoes";

/**
 * Registrar um consentimento à mão, e consultar o histórico de um titular.
 *
 * AS DUAS COISAS MORAM NA MESMA ILHA porque são o mesmo gesto em duas metades:
 * alguém liga pedindo para sair da lista, e quem atende precisa (a) ver o que
 * está registrado sobre aquela pessoa e (b) registrar a revogação. Separadas em
 * dois lugares, o atendimento vira duas telas e uma cópia de e-mail no meio.
 */
export function RegistroDeConsentimento() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Registrar />
      <Consultar />
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Registrar
 * -------------------------------------------------------------------------- */

function Registrar() {
  const router = useRouter();

  const [dados, setDados] = useState<Dados>(formularioDeConsentimentoVazio());
  const [erros, setErros] = useState<ErrosDoConsentimento>({});
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  /** `useRef` e não `useState`: `setState` é assíncrono, e dois cliques no mesmo
   *  tick leem o mesmo estado "livre". Aqui a consequência é uma linha
   *  duplicada no livro-razão — que não tem DELETE para desfazer. */
  const emVoo = useRef(false);

  function mudar<C extends keyof Dados>(campo: C, valor: Dados[C]) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
    setErros((atuais) => ({ ...atuais, [campo]: undefined }));
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emVoo.current) return;

    const encontrados = validarConsentimento(dados);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) return;

    emVoo.current = true;
    setSalvando(true);
    setErroDoServidor(null);
    setSalvo(null);

    try {
      const resposta = await registrarConsentimento(montarPayloadDeConsentimento(dados));
      if (!resposta.ok) {
        setErroDoServidor(resposta.erro);
        return;
      }
      setSalvo(
        `Registrado: ${rotuloDe(ESTADOS_DE_CONSENTIMENTO, dados.estado)} para ${rotuloDe(CANAIS_DE_CONTATO, dados.canal)}.`,
      );
      setDados(formularioDeConsentimentoVazio());
      // A lista acima é um Server Component: sem isto, a linha nova só
      // apareceria no próximo F5 — e a pessoa registraria de novo.
      router.refresh();
    } finally {
      emVoo.current = false;
      setSalvando(false);
    }
  }

  return (
    <Ficha titulo="Registrar consentimento">
      <form onSubmit={enviar} className="space-y-4" noValidate>
        {erroDoServidor && (
          <Tarja tom="erro" onFechar={() => setErroDoServidor(null)}>
            {erroDoServidor}
          </Tarja>
        )}
        {/*
          O SUCESSO É UMA TARJA E NÃO UM TOAST, e não por simetria: R10 libera o
          toast para ação REVERSÍVEL com Desfazer, e esta não é reversível — não
          há DELETE de consentimento. Uma confirmação que some sozinha, de um
          gesto que não se desfaz, é a pior combinação possível.
        */}
        {salvo && (
          <Tarja tom="sucesso" onFechar={() => setSalvo(null)}>
            {salvo}
          </Tarja>
        )}

        <p className="max-w-[60ch] text-[13px] text-fuligem-55">
          Use para registrar o que foi dito fora do site — no balcão, numa feira,
          por telefone. Cada registro é uma linha nova: revogar não apaga o «sim»
          anterior, e é isso que permite responder depois com base em quê a
          mensagem foi enviada.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Seletor
            id="canal-do-consentimento"
            rotulo="Canal"
            valor={dados.canal}
            erro={erros.canal}
            aoMudar={(v) => mudar("canal", v)}
            opcoes={CANAIS_DE_CONTATO}
            vazio="Escolha…"
          />
          <Seletor
            id="estado-do-consentimento"
            rotulo="A pessoa"
            valor={dados.estado}
            erro={erros.estado}
            aoMudar={(v) => mudar("estado", v)}
            opcoes={ESTADOS_DE_CONSENTIMENTO}
          />
        </div>

        <Campo
          rotulo="Origem"
          required
          value={dados.origem}
          erro={erros.origem ?? null}
          onChange={(e) => mudar("origem", e.target.value)}
          placeholder="conversa no balcão em 26/08"
          /* A origem é obrigatória no banco (`consentimentos_origem_preenchida`)
             porque é a PROCEDÊNCIA — a metade do registro que um booleano
             perderia. A ajuda diz o que escrever nela. */
          ajuda="De onde veio esta autorização. Escreva onde e como: é isso que responde «com base em quê?» daqui a um ano."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="E-mail"
            type="email"
            value={dados.email}
            erro={erros.email ?? null}
            onChange={(e) => mudar("email", e.target.value)}
            placeholder="pessoa@exemplo.com"
          />
          <Campo
            rotulo="Telefone"
            type="tel"
            value={dados.telefone}
            onChange={(e) => mudar("telefone", e.target.value)}
            placeholder="(35) 99999-8888"
            /* O telefone é gravado COMO FOI DIGITADO — a tabela é prova, não
               cadastro. Mas sem ele a pessoa não entra num público de WhatsApp,
               e a ajuda precisa dizer as duas coisas. */
            ajuda="Guardado como você digitar. Sem telefone, esta pessoa não entra num público de WhatsApp."
          />
        </div>

        <div className="flex justify-end border-t border-fuligem-20 pt-4">
          <Botao type="submit" disabled={salvando}>
            {salvando ? "Registrando…" : "Registrar"}
          </Botao>
        </div>
      </form>
    </Ficha>
  );
}

/* -------------------------------------------------------------------------- *
 * Consultar
 * -------------------------------------------------------------------------- */

function Consultar() {
  const [email, setEmail] = useState("");
  const [historico, setHistorico] = useState<Consentimento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [procurado, setProcurado] = useState("");

  async function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setBuscando(true);
    setErro(null);
    try {
      const resposta = await consultarTitular(email);
      if (!resposta.ok) {
        setErro(resposta.erro);
        setHistorico(null);
        return;
      }
      setHistorico(resposta.dados);
      setProcurado(email.trim().toLowerCase());
    } finally {
      setBuscando(false);
    }
  }

  return (
    <Ficha titulo="Consultar um titular">
      <form onSubmit={buscar} className="space-y-4" noValidate>
        <p className="max-w-[60ch] text-[13px] text-fuligem-55">
          O histórico completo de um e-mail, em todos os canais. A linha de cima
          é a que vale hoje.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <Campo
            rotulo="E-mail do titular"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@exemplo.com"
            className="min-w-0 flex-1 basis-64"
          />
          <Botao type="submit" variante="secundaria" disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar"}
          </Botao>
        </div>

        {/*
          A RESSALVA DO R2, DITA EM TEXTO. A busca por e-mail NÃO vai para a URL:
          uma URL de painel vai para o histórico do navegador, para o `Referer` e
          para o print que alguém cola num grupo — e numa tela de conformidade
          isso seria a ferramenta vazando o dado que ela existe para proteger.
          O preço é este resultado não sobreviver ao F5, e o preço é dito em vez
          de a função simplesmente não existir.
        */}
        <p className="max-w-[60ch] text-[12px] text-fuligem-55">
          O e-mail buscado não entra no endereço da página, de propósito — endereço
          vai para o histórico do navegador e para qualquer print. Por isso este
          resultado se perde ao recarregar.
        </p>

        {erro && <Tarja tom="erro">{erro}</Tarja>}

        {historico !== null && historico.length === 0 && (
          <Tarja tom="aviso">
            Nenhum consentimento registrado para <strong>{procurado}</strong>. Sem
            registro, essa pessoa não entra em público de disparo nenhum.
          </Tarja>
        )}

        {historico !== null && historico.length > 0 && (
          <ol className="space-y-3">
            {historico.map((linha) => (
              <li
                key={linha.id}
                className="border-l-2 border-fuligem-20 pl-4 text-[13px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Selo tom={tomDe(ESTADOS_DE_CONSENTIMENTO, linha.estado)}>
                    {rotuloDe(ESTADOS_DE_CONSENTIMENTO, linha.estado)}
                  </Selo>
                  <span className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
                    {rotuloDe(CANAIS_DE_CONTATO, linha.canal)}
                  </span>
                  <span data-dado className="text-fuligem-55">
                    {formatarDataHora(linha.criado_em)}
                  </span>
                </div>
                <p className="mt-1 text-fuligem-55">Origem: {linha.origem}</p>
              </li>
            ))}
          </ol>
        )}
      </form>
    </Ficha>
  );
}

/* -------------------------------------------------------------------------- *
 * O seletor
 * -------------------------------------------------------------------------- */

/**
 * Um `<select>` nativo com rótulo — o mesmo desenho do <Campo>, para os dois
 * ficarem alinhados na mesma grade.
 *
 * NATIVO E NÃO RADIX: são duas e três opções fechadas, sem busca e sem
 * agrupamento. O nativo já traz teclado, leitor de tela e o seletor de rolagem
 * do celular; o Radix daria estilo em troca de manter tudo isso à mão.
 */
function Seletor({
  id,
  rotulo,
  valor,
  erro,
  aoMudar,
  opcoes,
  vazio,
}: {
  id: string;
  rotulo: string;
  valor: string;
  erro?: string;
  aoMudar: (valor: string) => void;
  opcoes: ReadonlyArray<{ valor: string; rotulo: string }>;
  vazio?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
        {rotulo} <span aria-hidden="true">*</span>
      </label>
      <select
        id={id}
        required
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-invalid={erro ? true : undefined}
        className={`min-h-11 rounded-bt border bg-cal-puro px-3 text-fuligem ${FOCO} ${
          erro ? "border-vermelho" : "border-fuligem-20 hover:border-fuligem-55"
        }`}
      >
        {vazio && <option value="">{vazio}</option>}
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </select>
      {erro && <p className="text-[13px] text-vermelho">{erro}</p>}
    </div>
  );
}
