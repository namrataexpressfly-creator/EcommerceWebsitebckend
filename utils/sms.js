import twilio from "twilio";

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;

const isConfigured = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);

const client = isConfigured ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

export async function sendOtpSms(phone, otp) {
  const body = `Your Expressfly verification code is ${otp}. It expires in 5 minutes. Do not share this code.`;

  if (!isConfigured) {
    console.log(`📲 [DEV — Twilio not configured, see .env] OTP for ${phone}: ${otp}`);
    return { delivered: false, dev: true };
  }

  try {
    const message = await client.messages.create({ body, from: TWILIO_FROM_NUMBER, to: phone });
    return { delivered: true, sid: message.sid };
  } catch (err) {
  
    console.error("Twilio SMS send failed:", err.message);
    throw new Error("Could not send OTP SMS. Check the phone number and Twilio configuration.");
  }
}

export const smsProviderConfigured = isConfigured;
