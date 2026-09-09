// Vercel serverless function: GET /api/verify-payment?reference=xxxxx
// Confirms with Paystack (server-to-server) that a payment actually succeeded
// before the frontend is allowed to unlock Premium. Never trust a
// "payment succeeded" claim that only comes from the browser.

export default async function handler(req, res) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: "Payment isn't configured yet (missing PAYSTACK_SECRET_KEY)." });
  }

  const { reference } = req.query;
  if (!reference || typeof reference !== "string") {
    return res.status(400).json({ error: "A transaction reference is required." });
  }

  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      }
    );

    const data = await paystackRes.json();

    const success = Boolean(data.status && data.data && data.data.status === "success");

    return res.status(200).json({
      verified: success,
      amount: success ? data.data.amount : null,
      email: success ? data.data.customer?.email : null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error verifying payment." });
  }
}
