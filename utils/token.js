import jwt from "jsonwebtoken";

export function signSellerToken(seller) {
  return jwt.sign(
    { id: seller._id.toString(), email: seller.email, store_slug: seller.store_slug },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function signCustomerToken(customer) {
  return jwt.sign(
    { type: "customer", id: customer._id.toString(), seller_id: customer.seller_id.toString(), phone: customer.phone },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

export function signAdminToken(admin) {
  return jwt.sign(
    { type: "admin", id: admin._id.toString(), username: admin.username },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

export function signDeveloperToken(developer) {
  return jwt.sign(
    { type: "developer", id: developer._id.toString(), username: developer.username },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}
