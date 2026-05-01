import nodemailer from 'nodemailer';
import dns from 'dns';

let transporter: nodemailer.Transporter;

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.EMAIL_PORT) || 465;

  // Resolver manualmente para IPv4 — Railway nao suporta IPv6
  let resolvedHost = host;
  try {
    const addresses = await dns.promises.resolve4(host);
    resolvedHost = addresses[0];
    console.log(`[EMAIL] ${host} resolvido para IPv4: ${resolvedHost}`);
  } catch (err) {
    console.warn(`[EMAIL] Falha ao resolver ${host} para IPv4, usando hostname original`, err);
  }

  transporter = nodemailer.createTransport({
    host: resolvedHost,
    port,
    secure: port === 465,
    connectionTimeout: 10000,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      servername: host,
    },
  });

  console.log(`[EMAIL] Transporter criado: ${resolvedHost}:${port} secure:${port === 465}`);
  return transporter;
}

export async function sendVerificationEmail(
  toEmail: string,
  nome: string,
  verifycode: string
) {
  console.log(`[EMAIL] Enviando verificacao para ${toEmail}...`);
  const mailer = await getTransporter();
  await mailer.sendMail({
    from: `"Ponto Corte" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Verifique sua conta - Dinamic Cut",
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
  console.log(`[EMAIL] Verificacao enviada para ${toEmail}`);
}

export async function sendBarberInviteEmail(
  toEmail: string,
  establishmentName: string,
  signupUrl: string
) {
  console.log(`[EMAIL] Enviando convite para ${toEmail}...`);
  const mailer = await getTransporter();
  await mailer.sendMail({
    from: `"Ponto Corte" <${process.env.EMAIL_USER}>`,
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
  console.log(`[EMAIL] Convite enviado para ${toEmail}`);
}
