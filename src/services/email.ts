import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
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