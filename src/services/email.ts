import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM || 'Ponto Corte <onboarding@resend.dev>';

console.log('[EMAIL] Resend configurado');

export async function sendVerificationEmail(
  toEmail: string,
  nome: string,
  verifycode: string
) {
  console.log(`[EMAIL] Enviando verificacao para ${toEmail}...`);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject: 'Verifique sua conta - Dinamic Cut',
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2>Olá, ${nome}!</h2>
        <p>Seu código de verificação é:</p>
        <div style="
          font-size: 2rem;
          font-weight: bold;
          letter-spacing: 0.3em;
          padding: 1rem;
          background: #f0f2f5;
          border-radius: 8px;
          text-align: center;
          color: #14181c;
        ">
          ${verifycode}
        </div>
        <p style="color: #667788; font-size: 0.9rem;">
          Este código expira em 24 horas.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('[EMAIL] Erro ao enviar verificacao:', error);
    throw new Error(error.message);
  }
  console.log(`[EMAIL] Verificacao enviada para ${toEmail}`);
}

export async function sendBarberInviteEmail(
  toEmail: string,
  establishmentName: string,
  signupUrl: string
) {
  console.log(`[EMAIL] Enviando convite para ${toEmail}...`);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject: `Convite para ${establishmentName} - Dinamic Cut`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2>Você foi convidado!</h2>
        <p>A barbearia <strong>${establishmentName}</strong> convidou você para fazer parte da equipe.</p>
        <p>Para criar sua conta e acessar seu painel, clique no botão abaixo:</p>
        <a href="${signupUrl}" style="
          display: inline-block;
          padding: 0.8rem 2rem;
          background: #00e054;
          color: #fff;
          text-decoration: none;
          border-radius: 4px;
          font-weight: 700;
          font-size: 1rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 1.5rem 0;
        ">
          Criar minha conta
        </a>
        <p style="color: #667788; font-size: 0.9rem;">
          Caso o botão não funcione, acesse diretamente: <br/>
          <a href="${signupUrl}" style="word-break: break-all;">${signupUrl}</a>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('[EMAIL] Erro ao enviar convite:', error);
    throw new Error(error.message);
  }
  console.log(`[EMAIL] Convite enviado para ${toEmail}`);
}
