import type { Metadata } from "next";
import Link from "next/link";
import { BotaoLink } from "@/components/ui/Botao";
import { CodigoDeRastreio } from "./CodigoDeRastreio";
import {
  RASTREAMENTO_OFICIAL,
  ehCodigoDosCorreios,
  linkDeRastreamento,
  normalizarCodigo,
} from "@/lib/rastreio";

/**
 * /rastreio — o destino do botão "Rastrear pedido" do WhatsApp.
 *
 * ESTA URL É CONGELADA: o botão do template `pedido_enviado` aponta para
 * `${URL_LOJA}/rastreio?codigo={{1}}` e a Meta a congela na aprovação
 * (`backend/src/utils/whatsappMensagens.js`). Renomear ou mover esta pasta
 * quebra um botão que já está no telefone dos clientes e que só se conserta
 * apagando o template, recriando e esperando nova revisão — com o aviso de
 * envio fora do ar nesse meio-tempo.
 *
 * PÚBLICA DE PROPÓSITO, E POR ISSO MESMO CEGA. O cliente veio de um toque no
 * WhatsApp querendo saber onde está o café; exigir login ali seria fricção no
 * pior lugar possível. O preço disso é a regra que a página não pode violar:
 * ela NÃO CONSULTA O BANCO e não revela NADA sobre o pedido — só ecoa o código
 * que veio na URL. Quem adivinhar o código de um terceiro descobre apenas o
 * código que ele já digitou.
 *
 * E NÃO CONSULTA TRANSPORTADORA NENHUMA: a loja não tem integração de
 * rastreamento (a Melhor Envio aqui só cota frete) e o `codigo_rastreio` é
 * digitado à mão no painel. A página entrega o código e o caminho até ele.
 *
 * NÃO USA `PaginaTexto` (como termos-de-uso e política-de-privacidade), e o
 * motivo é concreto: o contêiner de prosa dele traz `[&_a]:text-vermelho
 * [&_a]:underline`, que tem especificidade maior que as utilidades do
 * `BotaoLink` e repintaria o CTA como link sublinhado. O `atualizacao` também
 * não significa nada aqui. A moldura externa é a mesma — mesma calha, mesma
 * escala de <h1>, mesma medida de leitura.
 */

export const metadata: Metadata = {
  title: "Rastrear pedido — Café Canastra",
  description: "Acompanhe a entrega do seu pedido pelo código de rastreio.",
  // Página de estado pessoal, como /account e /sacola: não é resultado de
  // busca, e indexada só produziria um resultado sem código nenhum.
  // `app/robots.ts` já manda Disallow; isto é a segunda camada, para o crawler
  // que ignora o robots.txt mas respeita a meta tag.
  robots: { index: false, follow: false },
};

export default async function PaginaRastreio({
  searchParams,
}: {
  // `searchParams` é Promise desde o Next 15.
  searchParams: Promise<{ codigo?: string | string[] }>;
}) {
  const codigo = normalizarCodigo((await searchParams).codigo);
  const dosCorreios = codigo !== null && ehCodigoDosCorreios(codigo);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-10 md:py-20">
      <h1 className="font-titulo text-[clamp(2.25rem,5vw,3.75rem)] leading-none">
        Rastrear pedido
      </h1>

      <div className="mt-8 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80">
        {codigo === null ? (
          /* SEM CÓDIGO NÃO É ERRO. Chega aqui quem abriu a página solta, quem
             recortou o link ao encaminhar a mensagem, ou quem salvou o
             endereço sem o parâmetro. Nada quebrou — só falta o código, e o
             texto diz exatamente isso e para onde ir. */
          <>
            <p>
              Esta página abre com o código do seu pedido no link que enviamos
              pelo WhatsApp. Sem o código, não há o que acompanhar aqui.
            </p>
            <p className="mt-4">
              Seus pedidos, com o código de cada um, ficam na sua conta.
            </p>
            <div className="mt-8">
              <BotaoLink href="/account">Ver meus pedidos</BotaoLink>
            </div>
          </>
        ) : (
          <>
            <p>
              Este é o código de rastreio do seu pedido. O objeto costuma levar
              até um dia útil para aparecer no rastreamento depois do envio.
            </p>

            <CodigoDeRastreio codigo={codigo} />

            {dosCorreios ? (
              <div className="mt-8">
                {/* `target="_blank"` porque o cliente veio de um toque no
                    WhatsApp: voltar para cá com o botão "voltar" do navegador
                    é mais barato do que refazer o caminho. `rel` fecha o
                    `window.opener` do site de destino. */}
                <BotaoLink
                  href={linkDeRastreamento(codigo)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Acompanhar a entrega
                </BotaoLink>
              </div>
            ) : (
              /* O painel aceita qualquer texto em `codigo_rastreio`, e a
                 Melhor Envio também despacha por Jadlog e Loggi. Mandar um
                 código desses para os Correios devolveria "objeto não
                 encontrado" — o cliente concluiria que o código está errado,
                 e abriria um chamado. Dizer a verdade custa menos. */
              <p className="mt-6">
                Este código não está no formato dos Correios
                (<span className="font-dado">AA123456789BR</span>), então ele é
                de outra transportadora. Use o código acima no site dela, ou
                fale com a gente pelo WhatsApp.
              </p>
            )}

            <p className="mt-6 text-[15px]">
              Se preferir a fonte oficial, cole o código no{" "}
              <a
                href={RASTREAMENTO_OFICIAL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-vermelho underline underline-offset-4"
              >
                rastreamento dos Correios
              </a>
              . Todos os seus pedidos ficam em{" "}
              <Link
                href="/account"
                className="text-vermelho underline underline-offset-4"
              >
                Minha conta
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
