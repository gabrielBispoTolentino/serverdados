import type { DatabaseExecutor } from '../config/database';

function getBeneficioDescricao(beneficio: any) {
  let descricao = '';

  switch (beneficio.condicao_tipo) {
    case 'sempre':
      descricao = 'Beneficio permanente';
      break;
    case 'primeira_vez':
      descricao = 'Desconto de primeira vez';
      break;
    case 'apos_x_usos':
      descricao = `Apos ${beneficio.condicao_valor} usos`;
      break;
    case 'dia_semana': {
      const dias = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
      descricao = `Desconto de ${dias[beneficio.condicao_valor]}`;
      break;
    }
    default:
      descricao = 'Beneficio personalizado';
      break;
  }

  if (beneficio.desconto_percentual) {
    descricao += ` - ${beneficio.desconto_percentual}% OFF`;
  } else if (beneficio.desconto_fixo) {
    descricao += ` - R$ ${beneficio.desconto_fixo} OFF`;
  }

  return descricao;
}

export async function calcularBeneficios(
  pool: DatabaseExecutor,
  inscricaoId: number | string,
  servicoId: number | string,
  valorOriginal: number,
) {
  try {
    const [beneficios] = await pool.execute(
      `
      SELECT
        pb.*,
        p.nome AS plano_nome
      FROM plano_beneficios pb
      INNER JOIN inscricoes i ON i.plano_id = pb.plano_id
      INNER JOIN planos p ON p.id = pb.plano_id
      WHERE i.id = ?
        AND pb.ativo = 1
        AND (pb.servico_id IS NULL OR pb.servico_id = ?)
      ORDER BY pb.ordem ASC
    `,
      [inscricaoId, servicoId],
    );

    if (beneficios.length === 0) {
      return {
        valorFinal: valorOriginal,
        descontoTotal: 0,
        beneficiosAplicados: [],
      };
    }

    let valorAtual = valorOriginal;
    let descontoTotal = 0;
    const beneficiosAplicados = [];

    for (const beneficio of beneficios) {
      let aplicar = false;
      let descontoAplicado = 0;

      switch (beneficio.condicao_tipo) {
        case 'sempre':
          aplicar = true;
          break;
        case 'primeira_vez': {
          const [usos] = await pool.execute(
            `
            SELECT COUNT(*)::int AS total
            FROM uso_servicos
            WHERE inscricao_id = ?
          `,
            [inscricaoId],
          );
          aplicar = usos[0].total === 0;
          break;
        }
        case 'apos_x_usos': {
          const [usosServico] = await pool.execute(
            `
            SELECT COUNT(*)::int AS total
            FROM uso_servicos
            WHERE inscricao_id = ?
              AND servico_id = ?
              AND EXTRACT(MONTH FROM data_uso) = EXTRACT(MONTH FROM CURRENT_TIMESTAMP)
              AND EXTRACT(YEAR FROM data_uso) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)
          `,
            [inscricaoId, servicoId],
          );
          aplicar = (usosServico[0].total + 1) % beneficio.condicao_valor === 0;
          break;
        }
        case 'dia_semana':
          aplicar = new Date().getDay() === beneficio.condicao_valor;
          break;
        default:
          aplicar = false;
      }

      if (!aplicar) {
        continue;
      }

      if (beneficio.tipo_beneficio === 'desconto_percentual' && beneficio.desconto_percentual) {
        descontoAplicado = valorAtual * (beneficio.desconto_percentual / 100);
      } else if (beneficio.tipo_beneficio === 'desconto_fixo' && beneficio.desconto_fixo) {
        descontoAplicado = Math.min(Number(beneficio.desconto_fixo), valorAtual);
      }

      if (descontoAplicado <= 0) {
        continue;
      }

      valorAtual -= descontoAplicado;
      descontoTotal += descontoAplicado;
      beneficiosAplicados.push({
        id: beneficio.id,
        tipo: beneficio.tipo_beneficio,
        condicao: beneficio.condicao_tipo,
        desconto: descontoAplicado,
        descricao: getBeneficioDescricao(beneficio),
      });
    }

    return {
      valorFinal: Math.max(0, valorAtual),
      descontoTotal,
      beneficiosAplicados,
    };
  } catch (error) {
    console.error('Erro ao calcular beneficios:', error);
    return {
      valorFinal: valorOriginal,
      descontoTotal: 0,
      beneficiosAplicados: [],
    };
  }
}

export { getBeneficioDescricao };
