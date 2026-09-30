
export function sanitizeStorefrontConfig(config) {
  const plain = config.toObject ? config.toObject() : { ...config };
  if (plain.payment_settings) {
    const { own_razorpay_key_secret_enc, own_razorpay_webhook_secret_enc, ...restSettings } =
      plain.payment_settings;
    plain.payment_settings = {
      ...restSettings,
      own_razorpay_configured: Boolean(
        restSettings.own_razorpay_key_id && own_razorpay_key_secret_enc
      ),
    };
  }
  return plain;
}
