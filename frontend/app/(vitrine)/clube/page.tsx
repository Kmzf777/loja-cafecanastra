import type { Metadata } from "next";
import { listarLotes } from "@/lib/catalogo/repositorio";
import { DESCONTO_DO_CLUBE, opcoesDoClube } from "@/lib/clube";
import { AssinaturaWizard } from "./AssinaturaWizard";

/**
 * Clube da Canastra — estetica.md §7.4.
 *
 * Superficie Mata. ATENCAO ao contraste: vermelho sobre mata e 2,0:1 (§4.1,
 * proibido). Todo CTA aqui sai em Cal.
 *
 * A pendencia registrada aqui ("o wizard com estado ainda nao existe") FECHOU
 * na Onda 3J: o fluxo de 3 passos com barra de progresso e a etiqueta de
 * resumo agora sao o <AssinaturaWizard>, uma ilha client que termina no POST
 * /clube/assinar e no redirect ao init_point do Mercado Pago. Esta pagina
 * segue server component: monta o editorial e entrega ao wizard so o recorte
 * assinavel do catalogo (opcoesDoClube), com preco/estoque ao vivo quando a
 * API responde.
 *
 * `revalidate` continua: o preco daqui e etiqueta — quem decide os -10% de
 * verdade e o servidor, na hora do assinar (ClubeController).
 */

export const metadata: Metadata = {
  title: "Clube da Canastra — Assinatura",
  description:
    "Café novo em casa a cada 15, 30 ou 45 dias, moído do jeito que você prepara. Cancele quando quiser, sem multa.",
};

export const revalidate = 3600;

export default async function PaginaClube() {
  const lotes = await listarLotes();
  const opcoes = opcoesDoClube(lotes);

  /**
   * O NÚMERO DO HERO É A CONSTANTE, não o `assinatura.desconto` do catálogo.
   * Quem cobra é o ClubeController, sobre `DESCONTO_DO_CLUBE`; lib/clube.ts
   * espelha essa mesma constante para a etiqueta do wizard. Ler um terceiro
   * valor aqui criaria a única fonte capaz de MENTIR: um JSON de catálogo com
   * 0.15 anunciaria "15% de desconto" numa loja que cobra 10%. O campo do
   * catálogo segue existindo como marcação editorial de QUAIS linhas entram no
   * Clube (`opcoesDoClube` filtra por ele) — não de quanto se desconta.
   */
  const desconto = DESCONTO_DO_CLUBE;

  return (
    <>
      <section className="bg-mata py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            Assinatura
          </p>
          <h1 className="mt-6 max-w-[16ch] font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
            Clube da Canastra
          </h1>
          <p className="mt-6 max-w-[56ch] text-[18px] leading-relaxed text-cal/85">
            Café novo em casa a cada 15, 30 ou 45 dias, moído do jeito que você
            prepara. {Math.round(desconto * 100)}% de desconto em todo envio, com
            a entrega incluída. Cancele quando quiser, sem multa.
          </p>

          <AssinaturaWizard opcoes={opcoes} />
        </div>
      </section>

      <section className="bg-cal py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            Perguntas diretas
          </h2>
          <dl className="mt-8 max-w-[70ch]">
            {[
              [
                "Como funciona a cobrança?",
                "Você autoriza uma vez, no Mercado Pago, e o valor do envio é cobrado automaticamente na frequência escolhida. O preço fica travado no valor da adesão.",
              ],
              [
                "E se eu viajar?",
                "Dá para pausar a assinatura no Mercado Pago sem cancelar — e reativar quando voltar.",
              ],
              [
                "Tem fidelidade?",
                "Não. Cancele quando quiser, pela sua conta, sem multa e sem precisar ligar.",
              ],
              [
                "O café vem moído?",
                "Do jeito que você escolher. Moemos na hora do envio, não antes.",
              ],
            ].map(([p, r]) => (
              <div key={p} className="border-b border-fuligem-20 py-5">
                <dt className="text-[17px] font-semibold">{p}</dt>
                <dd className="mt-2 text-[16px] leading-relaxed text-fuligem-80">
                  {r}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
