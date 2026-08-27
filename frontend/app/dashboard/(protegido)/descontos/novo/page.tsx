import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { ROTA_DE_DESCONTOS } from "@/lib/painel/descontos/contrato";
import { FORMULARIO_VAZIO } from "@/lib/painel/descontos/formulario.logica";

import { lerCatalogo } from "../catalogo";
import { FormularioDeRegra } from "../FormularioDeRegra";

/**
 * `/dashboard/descontos/novo` — a regra que ainda não existe.
 *
 * ELA NASCE DESLIGADA. O padrão da coluna `habilitada` no banco é `true`, e
 * `FORMULARIO_VAZIO` o inverte de propósito: um padrão que põe desconto no ar
 * no instante do primeiro Salvar transforma um rascunho em prejuízo. O gestor
 * liga depois de o simulador confirmar o número — que é a ordem que esta tela
 * inteira existe para impor.
 */
export const metadata: Metadata = {
  title: "Nova regra de desconto",
  robots: { index: false, follow: false },
};

export default async function PaginaDeNovoDesconto() {
  const [acesso, catalogo] = await Promise.all([lerAcessoDoPainel(), lerCatalogo()]);

  return (
    <>
      <Cabecalho
        titulo="Nova regra de desconto"
        descricao="Seis passos, e um simulador ao lado para ver o resultado antes de ligar."
        email={acesso.email}
        acao={
          <Link
            href={ROTA_DE_DESCONTOS}
            className={`inline-flex min-h-11 items-center justify-center rounded-bt border border-fuligem-20 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] leading-none text-fuligem transition-colors hover:border-fuligem hover:bg-cal ${FOCO}`}
          >
            Voltar à lista
          </Link>
        }
      />

      <div className="mx-auto max-w-[1400px] px-5 py-6">
        <FormularioDeRegra
          inicial={FORMULARIO_VAZIO}
          produtos={catalogo.produtos}
          categorias={catalogo.categorias}
          /* Medido no servidor e descido como número: um `new Date()` dentro do
             render do cliente daria um instante diferente do que o servidor
             usou, e a mesma regra apareceria "vigente" no HTML e "expirada"
             depois da hidratação. */
          agoraEmMs={Date.now()}
        />
      </div>
    </>
  );
}
