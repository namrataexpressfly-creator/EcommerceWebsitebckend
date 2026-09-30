import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL } = process.env;

const isConfigured = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USERNAME && SMTP_PASSWORD);

const transporter = isConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
    })
  : null;

export async function sendPasswordResetEmail(email, resetUrl) {
  const subject = "Reset your Expressfly seller password";
  const text = `We received a request to reset your Expressfly seller password.\n\nReset it here: ${resetUrl}\n\nThis link expires in 30 minutes. If you didn't request this, you can safely ignore this email.`;
  const html = `
    <p>We received a request to reset your Expressfly seller password.</p>
    <p><a href="${resetUrl}">Click here to reset your password</a> (expires in 30 minutes).</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `;

  if (!isConfigured) {
    console.log(`📧 [DEV — SMTP not configured, see .env] Password reset link for ${email}: ${resetUrl}`);
    return { delivered: false, dev: true };
  }

  try {
    await transporter.sendMail({
      from: SMTP_FROM_EMAIL || SMTP_USERNAME,
      to: email,
      subject,
      text,
      html,
    });
    return { delivered: true };
  } catch (err) {
    console.error("Password reset email send failed:", err.message);
    throw new Error("Could not send the reset email. Please try again shortly.");
  }
}

export const mailerConfigured = isConfigured;
