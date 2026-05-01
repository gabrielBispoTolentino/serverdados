import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import type { Readable } from 'stream';

const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

console.log('[EMAIL] Verificando variaveis de ambiente GMAIL:');
console.log('CLIENT_ID existe?', !!process.env.GMAIL_CLIENT_ID);
console.log('CLIENT_SECRET existe?', !!process.env.GMAIL_CLIENT_SECRET);
console.log('REFRESH_TOKEN existe?', !!process.env.GMAIL_REFRESH_TOKEN);

// Transportador usado apenas para compilar o HTML/texto em uma string raw RFC 2822
const streamTransporter = nodemailer.createTransport({
  streamTransport: true,
  newline: 'unix',
});

async function sendRawEmail(to: string, subject: string, html: string) {
  if (!process.env.EMAIL_USER) {
    throw new Error('EMAIL_USER nao configurado no .env');
  }

  // 1. Usa o nodemailer para construir a mensagem MIME
  const info = await streamTransporter.sendMail({
    from: `"Ponto Corte" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });

  // 2. Lê a stream para pegar o buffer completo da mensagem
  const stream = info.message as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const messageBuffer = Buffer.concat(chunks);

  // 3. A API do Gmail requer Base64 URL-safe
  const rawMessage = messageBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // 4. Envia via API HTTP (passa reto pelos bloqueios de SMTP do Railway!)
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: rawMessage,
    },
  });

  return res.data;
}

export async function sendVerificationEmail(
  toEmail: string,
  nome: string,
  verifycode: string
) {
  console.log(`[EMAIL] Enviando verificacao para ${toEmail} via Gmail API...`);
  try {
    await sendRawEmail(
      toEmail,
      "Verifique sua conta - Dinamic Cut",
      `
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
      `
    );
    console.log(`[EMAIL] Verificacao enviada com sucesso para ${toEmail}`);
  } catch (error: any) {
    console.error('[EMAIL] Erro ao enviar verificacao:', error.message || error);
    throw new Error('Falha ao enviar email de verificacao');
  }
}

export async function sendBarberInviteEmail(
  toEmail: string,
  establishmentName: string,
  signupUrl: string
) {
  console.log(`[EMAIL] Enviando convite para ${toEmail} via Gmail API...`);
  try {
    await sendRawEmail(
      toEmail,
      `Convite para ${establishmentName} - Dinamic Cut`,
      `
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
      `
    );
    console.log(`[EMAIL] Convite enviado com sucesso para ${toEmail}`);
  } catch (error: any) {
    console.error('[EMAIL] Erro ao enviar convite:', error.message || error);
    throw new Error('Falha ao enviar email de convite');
  }
}
