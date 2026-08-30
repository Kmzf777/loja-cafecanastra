"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";

/**
 * Os três campos que `components/painel/ui/` ainda não tem — e ficam AQUI, na
 * pasta desta tela, de propósito.
 *
 * `<Campo>` embrulha um `<input>` e só. Este formulário precisa também de
 * `<select>`, `<textarea>` e `<input type="checkbox">`, e os três com o MESMO
 * rótulo em voz de etiqueta, a MESMA ajuda descrita por `aria-describedby` e o
 * MESMO anel de foco — senão o formulário mais denso do painel vira três
 * dialetos visuais na mesma ficha.
 *
 * A REGRA DE ISOLAMENTO DESTA ONDA é que primitivo novo nasce na pasta da
 * própria tela e a consolidação vem depois, quando se souber se ele serve a
 * duas telas ou a uma. Estes três quase certamente servem a Produtos e a
 * Ajustes também, e o relatório desta tarefa os aponta para a consolidação.
 *
 * OS TRÊS SÃO NATIVOS, E ISSO É DECISÃO DA SPEC (§2.7): `<select>` simples,
 * `<input type="checkbox">` e `<input type="radio">` não vão para o Radix. O
 * Radix entra onde há posicionamento flutuante e gestão de foco cara —
 * dropdown, popover, diálogo —, não onde o HTML já entrega teclado e leitor de
 * tela de graça.
 */

/** A moldura comum. Um anel de foco divergente entre dois campos da mesma ficha
 *  é o tipo de defeito que ninguém compara e todo mundo sente. */
const MOLDURA =
  `min-h-11 rounded-bt border bg-cal-puro px-3 text-fuligem placeholder:text-fuligem-55 ${FOCO} ` +
  "disabled:cursor-not-allowed disabled:opacity-40";

function filete(erro?: string | null): string {
  return erro ? "border-vermelho" : "border-fuligem-20 hover:border-fuligem-55";
}

function Descritores({
  ajuda,
  erro,
  idDaAjuda,
  idDoErro,
}: {
  ajuda?: ReactNode;
  erro?: string | null;
  idDaAjuda: string;
  idDoErro: string;
}) {
  return (
    <>
      {erro && (
        <p id={idDoErro} className="text-[13px] text-vermelho">
          {erro}
        </p>
      )}
      {ajuda && (
        <p id={idDaAjuda} className="text-[13px] text-fuligem-55">
          {ajuda}
        </p>
      )}
    </>
  );
}

/** A ordem importa: o leitor de tela lê os descritores nesta ordem, e ouvir o
 *  erro antes da ajuda é ouvir o problema antes do remédio. */
function descritoresDe(
  erro: string | null | undefined,
  ajuda: ReactNode | undefined,
  idDoErro: string,
  idDaAjuda: string,
): string | undefined {
  return [erro ? idDoErro : null, ajuda ? idDaAjuda : null].filter(Boolean).join(" ") || undefined;
}

/* -------------------------------------------------------------------------- *
 * Seleção
 * -------------------------------------------------------------------------- */

export function Selecao({
  rotulo,
  ajuda,
  erro,
  opcoes,
  className = "",
  ...props
}: {
  rotulo: string;
  ajuda?: ReactNode;
  erro?: string | null;
  /** `desabilitada` existe para o `brinde`: a opção continua VISÍVEL, com o
   *  motivo ao lado, em vez de sumir. Uma opção que some é uma pergunta sem
   *  resposta — o gestor procura "brinde" e conclui que a tela está incompleta. */
  opcoes: { valor: string; rotulo: string; desabilitada?: boolean }[];
  className?: string;
} & Omit<ComponentProps<"select">, "id">) {
  const id = useId();
  const idDaAjuda = `${id}-ajuda`;
  const idDoErro = `${id}-erro`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
        {rotulo}
        {props.required && <span aria-hidden="true"> *</span>}
      </label>
      <select
        {...props}
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritoresDe(erro, ajuda, idDoErro, idDaAjuda)}
        className={`${MOLDURA} ${filete(erro)}`}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor} disabled={o.desabilitada}>
            {o.rotulo}
          </option>
        ))}
      </select>
      <Descritores ajuda={ajuda} erro={erro} idDaAjuda={idDaAjuda} idDoErro={idDoErro} />
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Área de texto
 * -------------------------------------------------------------------------- */

export function Area({
  rotulo,
  ajuda,
  erro,
  className = "",
  ...props
}: {
  rotulo: string;
  ajuda?: ReactNode;
  erro?: string | null;
  className?: string;
} & Omit<ComponentProps<"textarea">, "id">) {
  const id = useId();
  const idDaAjuda = `${id}-ajuda`;
  const idDoErro = `${id}-erro`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
        {rotulo}
      </label>
      <textarea
        {...props}
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritoresDe(erro, ajuda, idDoErro, idDaAjuda)}
        className={`${MOLDURA} resize-y py-2 ${filete(erro)}`}
      />
      <Descritores ajuda={ajuda} erro={erro} idDaAjuda={idDaAjuda} idDoErro={idDoErro} />
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Marcador (checkbox)
 * -------------------------------------------------------------------------- */

/**
 * O ALVO DE TOQUE É O RÓTULO INTEIRO, e não o quadradinho de 16px.
 *
 * R22 pede 44px, e uma caixa de seleção nativa tem 13. A saída não é esticar a
 * caixa (que ficaria desproporcional ao lado dos outros campos): é fazer o
 * `<label>` inteiro ser o alvo, o que o HTML já entrega — clicar no texto marca
 * a caixa. O `min-h-11` é o que garante os 44px de altura clicável.
 */
export function Marcador({
  rotulo,
  ajuda,
  className = "",
  ...props
}: {
  rotulo: ReactNode;
  ajuda?: ReactNode;
  className?: string;
} & Omit<ComponentProps<"input">, "id" | "type">) {
  const id = useId();
  const idDaAjuda = `${id}-ajuda`;

  return (
    <div className={`flex flex-col ${className}`}>
      <label
        htmlFor={id}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] leading-snug"
      >
        <input
          {...props}
          id={id}
          type="checkbox"
          aria-describedby={ajuda ? idDaAjuda : undefined}
          className={`h-4 w-4 shrink-0 accent-fuligem ${FOCO}`}
        />
        <span>{rotulo}</span>
      </label>
      {ajuda && (
        <p id={idDaAjuda} className="pl-[26px] text-[13px] text-fuligem-55">
          {ajuda}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Grupo de campos
 * -------------------------------------------------------------------------- */

/**
 * Um `<fieldset>` de verdade com `<legend>` — e não um `<div>` com um `<p>` em
 * negrito.
 *
 * Quatro caixas de seleção soltas numa ficha são, para quem usa leitor de tela,
 * quatro controles sem relação nenhuma entre si: "PIX, marcada. Crédito, não
 * marcada." sem nunca dizer do que se está falando. Com `<fieldset>`, o nome do
 * grupo é anunciado ao entrar nele.
 */
export function Grupo({
  titulo,
  ajuda,
  erro,
  children,
  className = "",
}: {
  titulo: string;
  ajuda?: ReactNode;
  erro?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <fieldset
      className={`flex flex-col gap-1.5 ${className}`}
      aria-describedby={erro ? `${id}-erro` : undefined}
    >
      <legend className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>{titulo}</legend>
      {ajuda && <p className="text-[13px] text-fuligem-55">{ajuda}</p>}
      <div className="mt-1">{children}</div>
      {erro && (
        <p id={`${id}-erro`} className="text-[13px] text-vermelho">
          {erro}
        </p>
      )}
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- *
 * Linha de lista removível
 * -------------------------------------------------------------------------- */

/**
 * A moldura das listas editáveis (códigos, faixas, escopo).
 *
 * O BOTÃO DE REMOVER NOMEIA O QUE REMOVE. "Remover" sozinho, repetido cinco
 * vezes numa lista, obriga quem não vê a tela a contar posições para saber qual
 * é qual — é a mesma lição de R11/R12 aplicada a um gesto pequeno.
 */
export function LinhaRemovivel({
  oQue,
  aoRemover,
  children,
}: {
  oQue: string;
  aoRemover: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-fuligem-20 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3">{children}</div>
      <button
        type="button"
        onClick={aoRemover}
        aria-label={`Remover ${oQue}`}
        className={`inline-flex min-h-11 items-center rounded-bt border border-fuligem-20 px-3 text-[11px] ${ETIQUETA} text-fuligem-55 transition-colors hover:border-vermelho hover:text-vermelho ${FOCO}`}
      >
        Remover
      </button>
    </div>
  );
}
