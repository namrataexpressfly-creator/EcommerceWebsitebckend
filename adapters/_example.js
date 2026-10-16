export async function get_rating({ context }) {
  const rate = { id: "std", name: "Standard", charge: 60 + context.package.chargeable_weight_kg * 20, eta: "3-5 days" };
  return { raw: { demo: true }, mapped: { rates: [rate] } };
}

export async function order_create({ context }) {
  const awb = "DEMO" + Date.now();
  return { raw: { demo: true }, mapped: { awb, courier_name: "Demo Courier", tracking_url: `https://example.com/track/${awb}` } };
}

export async function tracking({ context }) {
  return { raw: {}, mapped: { status: "In transit", events: [] } };
}
