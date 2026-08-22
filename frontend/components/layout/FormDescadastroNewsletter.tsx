"use client";

import { useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { API_BASE } from "@/lib/api-base";
import type { Dicionario } from "@/lib/i18n/dicionario";

/**
 * "Retirar o consentimento de e-mail" — a saída da lista de novidades.
 *
 * POR QUE ELE EXISTE: a Política de privacidade promete, em texto visível ao
 * cliente, que "você pode retirar o consentimento de e-mail a qualquer
 * momento". Havia o formulário de ENTRAR (o do rodapé, FormNewsletter) e nada
 * para sair — a promessa não tinha superfície nenhuma. Este componente vive ao
 * lado da frase que a faz, pelo mesmo desenho do BotaoReverCookies: a página
 * que promete a escolha é a página onde ela se exerce.
 *
 * Client component minúsculo de propósito — é a única parte da Política com
 * estado, e extraí-la mantém a página como Server Component.
 *
 * O POST vai para `/newsletter/descadastrar`, que responde `{ ok: true }` para
 * TODO e-mail válido, inscrito ou não (anti-enumeração é do servidor, como no
 * cadastro). Por isso a confirmação daqui NÃO diz "apagamos sua inscrição" —
 * nem esta tela nem a rota sabem se havia uma. Ela diz o que é verdade nos dois
 * casos: o e-mail não está na lista.
 *
 * `aria-live="polite"` no estado: quem usa leitor de tela ouve o "pronto" ou o
 * erro sem precisar caçar o texto que trocou.
 */

type Estado =
  | { fase: "parado" }
  | { fase: "enviando" }
  | { fase: "pronto" }
  | { fase: "erro"; mensagem: string };

export function FormDescadastroNewsletter({ t }: { t: Dicionario["newsletter"] }) {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });

  async function descadastrar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (estado.fase === "enviando") return;
    setEstado({ fase: "enviando" });

    try {
      const resposta = await fetch(`${API_BASE}/newsletter/descadastrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (resposta.ok) {
        setEstado({ fase: "pronto" });
        setEmail("");
        return;
      }
      setEstado({
        fase: "erro",
        mensagem:
          resposta.status === 400
            ? t.emailInvalido
            : t.falhou,
      });
    } catch {
      setEstado({
        fase: "erro",
        mensagem: t.falhou,
      });
    }
  }

  return (
    <div className="mt-6 max-w-[52ch] border border-fuligem-20 bg-cal-puro p-5">
      <div className="text-[14px] leading-relaxed text-fuligem-80">
        {t.sairTexto}
      </div>

      {estado.fase === "pronto" ? (
        <div aria-live="polite" className="mt-4 text-[15px] text-fuligem">
          {t.sairPronto}
        </div>
      ) : (
        <form onSubmit={descadastrar} className="mt-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="descadastro-email" className="sr-only">
              {t.email}
            </label>
            <input
              id="descadastro-email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder={t.exemploDeEmail}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full border border-fuligem/25 bg-transparent px-3 text-[15px] text-fuligem placeholder:text-fuligem-55 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
            />
            <Botao
              type="submit"
              variante="secundario"
              disabled={estado.fase === "enviando"}
              className="shrink-0 disabled:opacity-60"
            >
              {estado.fase === "enviando"
                ? t.enviando
                : t.sairBotao}
            </Botao>
          </div>
          <div
            aria-live="polite"
            className="mt-2 min-h-5 text-[13px] text-fuligem-55"
          >
            {estado.fase === "erro" ? estado.mensagem : ""}
          </div>
        </form>
      )}
    </div>
  );
}
