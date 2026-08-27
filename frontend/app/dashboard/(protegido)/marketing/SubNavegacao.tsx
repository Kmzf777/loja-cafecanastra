import Link from "next/link";

import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";

/**
 * A faixa de sub-rotas de Marketing.
 *
 * POR QUE ELA EXISTE: o menu lateral tem UMA entrada, "Marketing", e a área tem
 * quatro telas que só fazem sentido juntas — a campanha é a que gasta, o
 * consentimento é o que autoriza, o envio é o que aconteceu, e o público de
 * WhatsApp é a única das quatro que ESCREVE para fora. Espalhá-las como quatro
 * itens no menu lateral empurraria "Vitrine" e "Relatórios" para baixo da dobra
 * num menu que já tem cinco grupos.
 *
 * É UM SERVER COMPONENT, e o item ativo chega por prop em vez de por
 * `usePathname()`. O caminho já é conhecido de graça em quem renderiza — cada
 * página sabe qual ela é —, e um `usePathname` aqui obrigaria esta faixa a ser
 * uma ilha de cliente presente em todas as quatro telas, carregando JavaScript
 * para desenhar quatro links.
 *
 * O QUE NÃO ESTÁ AQUI, e é decisão: newsletter, carrinho abandonado e automações
 * NÃO viram itens desta faixa, porque não há rota no Express que as sustente. Um
 * link para uma tela que só sabe dizer "isto não existe ainda" ensina que os
 * controles deste painel podem não levar a lugar nenhum. As três aparecem
 * listadas, com o motivo, na ficha "O que ainda não tem tela" da página de
 * Campanhas — visíveis, nomeadas, e sem prometer navegação.
 */

export type AbaDeMarketing = "campanhas" | "consentimentos" | "envios" | "whatsapp";

const ABAS: { chave: AbaDeMarketing; rotulo: string; href: string }[] = [
  { chave: "campanhas", rotulo: "Campanhas", href: "/dashboard/marketing" },
  {
    chave: "consentimentos",
    rotulo: "Consentimentos",
    href: "/dashboard/marketing/consentimentos",
  },
  { chave: "envios", rotulo: "Envios", href: "/dashboard/marketing/envios" },
  { chave: "whatsapp", rotulo: "Público de WhatsApp", href: "/dashboard/marketing/whatsapp" },
];

export function SubNavegacao({ ativa }: { ativa: AbaDeMarketing }) {
  return (
    <nav aria-label="Áreas de marketing" className="border-b border-fuligem-20">
      <ul className="-mb-px flex flex-wrap items-stretch gap-x-1">
        {ABAS.map((aba) => {
          const acesa = aba.chave === ativa;
          return (
            <li key={aba.chave}>
              <Link
                href={aba.href}
                /*
                  `aria-current="page"` é o que diz "você está aqui" a quem não
                  vê o filete embaixo. Sem ele, a distinção entre as quatro abas
                  seria só um pixel de cor — que é exatamente o tipo de
                  informação que se perde num leitor de tela.
                */
                aria-current={acesa ? "page" : undefined}
                /*
                  O FILETE DE 1px ABAIXO É A MARCA DA ABA ATIVA, e não um fundo
                  colorido: a separação deste painel é sempre o filete
                  (estetica.md §4.4). `-mb-px` na lista sobrepõe o filete da aba
                  ao filete do <nav>, de modo que os dois virem UM traço contínuo
                  quebrado só onde a aba está acesa.
                */
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-[11px] ${ETIQUETA} transition-colors ${FOCO} ${
                  acesa
                    ? "border-fuligem text-fuligem"
                    : "border-transparent text-fuligem-55 hover:border-fuligem-20 hover:text-fuligem"
                }`}
              >
                {aba.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
