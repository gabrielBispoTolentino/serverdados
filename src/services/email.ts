import nodemailer from 'nodemailer';
import dns from 'dns';

// Forçar IPv4 — Railway nao suporta IPv6 outbound
const ipv4Lookup = (hostname: string, _options: object, callback: (err: Error | null, address: string, family: number) => void) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return callback(err, '', 4);
    callback(null, addresses[0], 4);
  });
};

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  connectionTimeout: 10000,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  dnsLookup: ipv4Lookup,
} as Parameters<typeof nodemailer.createTransport>[0]);

export async function sendVerificationEmail(
  toEmail: string,
  nome: string,
  verifycode: string
) {
  await transporter.sendMail({
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
}

export async function sendBarberInviteEmail(
  toEmail: string,
  establishmentName: string,
  signupUrl: string
) {
  await transporter.sendMail({
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
}
