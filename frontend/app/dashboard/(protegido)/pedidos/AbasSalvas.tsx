import Link from "next/link";

import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import {
  ABAS_SALVAS,
  abaAtiva,
  urlDaAba,
  type EstadoDosPedidos,
} from "@/lib/painel/pedidos/pedidos.logica";

/**
 * AS ABAS SALVAS — R4, e elas são LINKS, não botões.
 *
 * "abas salvas: A despachar hoje, Pagamento pendente, Aguardando NF-e. São URLs
 * com filtro aplicado." A palavra que importa é URL: cada aba é um endereço de
 * verdade, então dá para favoritar "a fila da expedição", colar no WhatsApp do
 * conferente e voltar nela com o botão Voltar. Fossem botões com estado, cada
 * manhã começaria remontando o mesmo filtro.
 *
 * NÃO É `"use client"`, e é isso que faz este componente custar zero
 * JavaScript: link é a única primitiva de navegação de que ele precisa.
 *
 * NÃO É `role="tablist"` DE PROPÓSITO. O padrão ARIA de abas promete que o
 * conteúdo troca sem sair da página e que as setas do teclado andam entre elas;
 * aqui cada "aba" NAVEGA. Anunciar uma coisa e fazer outra é pior do que não
 * anunciar nada — uma `<nav>` com `aria-current` diz a verdade: são links, e um
 * deles é onde você está.
 */
export function AbasSalvas({ estado }: { estado: EstadoDosPedidos }) {
  const ativa = abaAtiva(estado);
  const aberta = ABAS_SALVAS.find((aba) => aba.chave === ativa);

  return (
    <div>
      <nav aria-label="Recortes salvos" className="flex flex-wrap items-center gap-1">
        {ABAS_SALVAS.map((aba) => {
          const acesa = aba.chave === ativa;
          return (
            <Link
              key={aba.chave}
              href={urlDaAba(aba)}
              // `aria-current="page"` é o que faz o leitor de tela dizer "você
              // está aqui" sem depender do fundo preto, que quem não enxerga
              // não recebe.
              aria-current={acesa ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-bt px-3 text-[11px] ${ETIQUETA} transition-colors ${FOCO} ${
                acesa
                  ? // Ganha por PESO, não por matiz — a mesma decisão da página
                    // atual na <Paginacao> e do botão primário. Cor escassa.
                    "bg-fuligem text-cal"
                  : "border border-fuligem-20 text-fuligem-55 hover:border-fuligem hover:bg-cal hover:text-fuligem"
              }`}
            >
              {aba.rotulo}
            </Link>
          );
        })}
      </nav>

      {/* A FRASE DA ABA ABERTA fica logo abaixo, e não num tooltip: "A
          despachar" e "Pagamento pendente" parecem óbvias e não são — "pendente"
          é o nome de um status E o nome de três deles juntos. Sem a frase, o
          gestor descobre o recorte contando linhas. */}
      {aberta && (
        <p className="mt-2 max-w-[70ch] text-[12px] text-fuligem-55">{aberta.ajuda}</p>
      )}
    </div>
  );
}
