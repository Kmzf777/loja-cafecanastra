"use strict";

/**
 * O CSV de pedidos que o painel exporta — feito para abrir DIRETO no Excel
 * de um gestor brasileiro, porque é isso que ele vai fazer com o arquivo.
 *
 * As três decisões que parecem detalhe e não são:
 *
 *  1. SEPARADOR `;`. O Excel pt-BR usa vírgula como decimal, então o
 *     delimitador de lista do Windows em pt-BR é ponto-e-vírgula — um CSV
 *     de vírgulas abre como UMA coluna borrada. `;` + decimal com vírgula
 *     ("54,90") é o par que o Excel BR entende sem assistente de importação.
 *
 *  2. BOM UTF-8 (﻿) NA FRENTE. Sem ele o Excel assume Windows-1252 e
 *     "Clássico" vira "ClÃ¡ssico". O BOM é o único sinal de codificação que
 *     o Excel respeita num .csv.
 *
 *  3. GUARDA CONTRA INJEÇÃO DE FÓRMULA. Célula começando com `=`, `+`, `-`,
 *     `@`, TAB ou CR é EXECUTADA pelo Excel como fórmula — e nome de
 *     cliente, código de cupom e código de rastreio são texto que veio de
 *     fora. `=HYPERLINK(...)` num nome de cliente rodaria na máquina do
 *     gestor. O prefixo `'` faz o Excel tratar a célula como texto literal.
 *     A guarda vem ANTES do aspamento: aspas protegem o CSV, não o Excel.
 */

const SEPARADOR = ";";
// Construído em código, e não como o caractere literal: um editor que
// "limpa" BOMs invisíveis do fonte apagaria a constante sem ninguém perceber.
const BOM = String.fromCharCode(0xfeff);

const CABECALHO = [
  "pedido",
  "data",
  "cliente",
  "email",
  "cpf",
  "status",
  "itens",
  "subtotal",
  "cupom",
  "desconto",
  "frete",
  "total",
  "metodo_pagamento",
  "rastreio",
];

/** Vírgula decimal, sem separador de milhar: o que o Excel BR lê como número. */
function dinheiro(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "0,00";
  return n.toFixed(2).replace(".", ",");
}

/** dd/mm/aaaa hh:mm no fuso de São Paulo — a data que o gestor reconhece. */
function dataBr(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `itens` pode chegar como jsonb já parseado ou como string — os dois valem. */
function parsearItens(items) {
  if (Array.isArray(items)) return items;
  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** "2x Clássico 250g moído; 1x Kit Degustação" — uma célula, legível. */
function resumoDeItens(items) {
  return parsearItens(items)
    .map((item) => {
      const qtd = Number(item.quantity) || 0;
      const nome = String(item.name || "").trim() || "item sem nome";
      const embalagem = item.size ? ` ${String(item.size).trim()}` : "";
      return `${qtd}x ${nome}${embalagem}`;
    })
    .join("; ");
}

/** Soma preço × quantidade dos itens: o valor da mercadoria antes de frete/desconto. */
function subtotalDosItens(items) {
  return parsearItens(items).reduce((soma, item) => {
    const preco = Number(item.price);
    const qtd = Number(item.quantity);
    if (!Number.isFinite(preco) || !Number.isFinite(qtd)) return soma;
    return soma + preco * qtd;
  }, 0);
}

/**
 * Uma célula segura: guarda de fórmula primeiro, aspas depois.
 * Exportada para o teste poder afirmar cada regra isoladamente.
 */
function celula(valor) {
  let texto = valor === null || valor === undefined ? "" : String(valor);

  if (/^[=+\-@\t\r]/.test(texto)) {
    texto = `'${texto}`;
  }

  if (
    texto.includes(SEPARADOR) ||
    texto.includes('"') ||
    texto.includes("\n") ||
    texto.includes("\r")
  ) {
    texto = `"${texto.replace(/"/g, '""')}"`;
  }

  return texto;
}

/**
 * Monta o arquivo inteiro a partir das linhas de
 * `ordersRepository.getOrdersForExport`. Função pura: entra lista, sai
 * string — o controller só cuida de cabeçalhos HTTP.
 */
function gerarCsvDePedidos(pedidos) {
  const linhas = [CABECALHO.join(SEPARADOR)];

  for (const p of pedidos || []) {
    linhas.push(
      [
        celula(p.order_id),
        celula(dataBr(p.created_at)),
        celula(p.user_name),
        celula(p.user_email),
        celula(p.user_cpf),
        celula(p.status),
        celula(resumoDeItens(p.items)),
        celula(dinheiro(subtotalDosItens(p.items))),
        // Código de cupom é texto digitado por gente — passa pela mesma
        // guarda de fórmula das demais células.
        celula(p.coupon_code),
        celula(dinheiro(p.discount || 0)),
        celula(dinheiro(p.shipping_cost || 0)),
        celula(dinheiro(p.total_amount)),
        celula(p.payment_method),
        celula(p.tracking_code),
      ].join(SEPARADOR),
    );
  }

  // CRLF: é o fim de linha que o RFC 4180 fixa e que o Excel espera.
  return BOM + linhas.join("\r\n") + "\r\n";
}

module.exports = { gerarCsvDePedidos, celula, BOM, SEPARADOR };
