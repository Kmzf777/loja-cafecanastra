"use client";

import { useId, useState, type ChangeEvent, type ComponentProps, type FocusEvent } from "react";
import { ETIQUETA, FOCO } from "./estilos";

/**
 * Um campo de formulário do painel — rótulo, controle, ajuda e erro, com a
 * fiação de ARIA feita e o ERRO NA HORA CERTA.
 *
 * O componente existe pelo momento, não pelo desenho. R8: validar a cada tecla
 * é hostil — "e-mail inválido" na terceira letra acusa alguém de errar uma
 * coisa que essa pessoa ainda está no meio de fazer, e treina o gestor a ver
 * vermelho como ruído de fundo. Então a regra é:
 *
 *   1. enquanto se digita pela primeira vez, o campo cala;
 *   2. no BLUR, quando a pessoa terminou, ele cobra;
 *   3. depois de ter cobrado uma vez, ele perdoa AO VIVO — a mensagem some
 *      durante a correção, sem esperar um segundo blur. Cobrar no blur e só
 *      perdoar no blur seguinte deixa o vermelho na tela durante toda a
 *      digitação da correção, e é o que faz a pessoa achar que continua errado.
 *
 * A MENSAGEM FICA AO LADO DO CAMPO, ligada por `aria-describedby`, com
 * `aria-invalid` no controle — e não numa lista de erros no topo do formulário.
 * A lista do topo é para o resultado da SUBMISSÃO (e ali ela é uma
 * <Tarja tom="erro">, que interrompe de propósito); aqui o erro pertence ao
 * campo e viaja com ele.
 *
 * E ela NÃO é `role="alert"`. Quem valida no blur quase sempre saiu do campo
 * com Tab; um alert dispararia por cima do anúncio do rótulo do campo SEGUINTE,
 * e o leitor de tela perderia exatamente a informação de onde a pessoa está
 * agora. Descrita por `aria-describedby`, a mensagem é anunciada quando se
 * volta ao campo — que é quando ela serve para alguma coisa.
 *
 * SÓ `<input>`, de propósito: `<select>` e `<textarea>` têm outras regras de
 * validação e de altura, e um componente que aceita os três vira três
 * componentes disfarçados de um.
 */
export function Campo({
  rotulo,
  ajuda,
  erro,
  validar,
  className = "",
  onBlur,
  onChange,
  ...props
}: {
  rotulo: string;
  ajuda?: string;
  /** Erro vindo de fora — do servidor, ou da validação do formulário inteiro no
   *  submit. Vence sempre o erro local: se o servidor disse "já existe uma
   *  conta com este e-mail", nenhuma regra de formato local desmente isso. */
  erro?: string | null;
  /** A regra local, rodada no blur. Devolve a mensagem, ou `null` se passou. */
  validar?: (valor: string) => string | null;
  className?: string;
} & Omit<ComponentProps<"input">, "id">) {
  const id = useId();
  const idDaAjuda = `${id}-ajuda`;
  const idDoErro = `${id}-erro`;

  const [erroLocal, setErroLocal] = useState<string | null>(null);
  /** Já saiu do campo uma vez? É o interruptor entre "cala" e "perdoa ao vivo". */
  const [jaSaiu, setJaSaiu] = useState(false);

  const erroExibido = erro ?? erroLocal;

  function aoSair(evento: FocusEvent<HTMLInputElement>) {
    setJaSaiu(true);
    if (validar) setErroLocal(validar(evento.target.value));
    onBlur?.(evento);
  }

  function aoMudar(evento: ChangeEvent<HTMLInputElement>) {
    if (jaSaiu && validar) setErroLocal(validar(evento.target.value));
    onChange?.(evento);
  }

  /* A ordem importa: o leitor de tela lê os descritores nesta ordem, e ouvir
     "CEP não encontrado" antes de "oito dígitos, sem hífen" é ouvir o problema
     antes do remédio. */
  const descritores = [erroExibido ? idDoErro : null, ajuda ? idDaAjuda : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
        {rotulo}
        {/* `aria-hidden` porque o `required` do input já diz isto ao leitor de
            tela, e ouvir "asterisco" no meio do rótulo não acrescenta nada. */}
        {props.required && <span aria-hidden="true"> *</span>}
      </label>

      <input
        {...props}
        id={id}
        onBlur={aoSair}
        onChange={aoMudar}
        aria-invalid={erroExibido ? true : undefined}
        aria-describedby={descritores || undefined}
        /* `min-h-11` são os 44px do R22 — a densidade do painel sai da célula
           da tabela, nunca do alvo que o dedo tem de acertar.
           `rounded-bt` (2px) porque o §4.3 reserva o canto reto ao contêiner e
           dá 2px a botão e campo "para não cair no jornal". */
        className={`min-h-11 rounded-bt border bg-cal-puro px-3 text-fuligem placeholder:text-fuligem-55 ${FOCO} disabled:cursor-not-allowed disabled:opacity-40 ${
          erroExibido ? "border-vermelho" : "border-fuligem-20 hover:border-fuligem-55"
        }`}
      />

      {erroExibido && (
        <p id={idDoErro} className="text-[13px] text-vermelho">
          {erroExibido}
        </p>
      )}
      {ajuda && (
        <p id={idDaAjuda} className="text-[13px] text-fuligem-55">
          {ajuda}
        </p>
      )}
    </div>
  );
}
