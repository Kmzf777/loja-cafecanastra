import type { Metadata } from "next";
import { PaginaTexto, AvisoJuridico } from "@/components/layout/PaginaTexto";

export const metadata: Metadata = {
  title: "Termos de uso — Café Canastra",
  description: "Condições de compra, entrega, trocas e devoluções.",
};

export default function TermosDeUso() {
  return (
    <PaginaTexto titulo="Termos de uso" atualizacao="agosto de 2026">
      <AvisoJuridico />

      <h2>Quem somos</h2>
      <p>
        O Café Canastra é uma marca de café especial da Serra da Canastra, em
        Minas Gerais, em atividade desde 1985. Estes termos regem a compra pelo
        site.
      </p>

      <h2>Pedidos e pagamento</h2>
      {/* A lista de meios é CONDICIONADA à mesma env que liga o cartão no
          checkout (NEXT_PUBLIC_MP_PUBLIC_KEY). Funciona porque os dois são
          resolvidos em tempo de BUILD: a página é estática e a env é assada
          no bundle — o build que mostra o rádio "Cartão" é o mesmo que
          promete cartão aqui, e o build sem a chave promete só Pix. Escolhido
          em vez de "cartão quando disponível" porque termos de uso com
          condicional vago não dizem nada. */}
      <p>
        O pedido é confirmado apenas após a aprovação do pagamento. Trabalhamos
        com {process.env.NEXT_PUBLIC_MP_PUBLIC_KEY?.trim()
          ? "Pix e cartão de crédito"
          : "Pix"}
        . Preços podem mudar sem aviso, mas nunca depois de um pedido
        confirmado.
      </p>

      <h2>Torra e envio</h2>
      <p>
        Torramos sob demanda, em lotes pequenos: torramos na terça e enviamos na
        quarta. Pedidos feitos depois da terça entram na semana seguinte. O prazo
        de entrega mostrado no checkout começa a contar do envio, não do pedido.
      </p>

      <h2>Trocas e devoluções</h2>
      <ul>
        <li>
          Você pode desistir da compra em até 7 dias corridos após o recebimento,
          conforme o Código de Defesa do Consumidor.
        </li>
        <li>
          Pacotes abertos não são aceitos em devolução por arrependimento, por
          se tratar de alimento.
        </li>
        <li>
          Se o produto chegar avariado ou diferente do pedido, trocamos sem custo
          — basta avisar em até 7 dias com uma foto.
        </li>
      </ul>

      {/* O Clube abriu na Onda 3J e esta seção descreve as regras REAIS.
          Texto pleno, sem condicional de env (diferente do cartão logo
          acima): o wizard de /clube e o backend existem em todo build — o que
          depende de credencial é o Mercado Pago aceitar a criação da
          assinatura, e nesse caso a própria tela recusa com erro claro na
          hora, antes de qualquer promessa virar cobrança. Termos condicionais
          a segredo de servidor não seriam verificáveis por quem os lê. */}
      <h2>Assinatura — Clube da Canastra</h2>
      <p>
        O Clube da Canastra é uma assinatura com <strong>cobrança
        recorrente</strong> processada pelo Mercado Pago: você autoriza uma
        única vez, na página do próprio Mercado Pago, e o valor de cada envio é
        debitado automaticamente na frequência escolhida (a cada 15, 30 ou 45
        dias).
      </p>
      <ul>
        <li>
          O preço de cada envio é o do café no momento da adesão, com 10% de
          desconto e a entrega incluída — e fica <strong>travado</strong>:
          reajustes futuros de catálogo não alteram assinaturas já ativas.
        </li>
        <li>
          Você pode <strong>cancelar a qualquer momento</strong>, sem multa e
          sem carência, na sua conta (Minha conta → Minha assinatura). O
          cancelamento interrompe as próximas cobranças na hora; envios já
          cobrados são entregues normalmente.
        </li>
        <li>
          Cada cobrança confirmada gera um pedido com os mesmos prazos de
          torra e envio das compras avulsas: torramos na terça, enviamos na
          quarta.
        </li>
      </ul>

      <h2>Contato</h2>
      <p>
        Dúvidas sobre um pedido: fale com a gente pelo WhatsApp informado no
        rodapé do site.
      </p>
    </PaginaTexto>
  );
}
