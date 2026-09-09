// Vercel serverless function: POST /api/initialize-payment
// Starts a Paystack transaction and returns the checkout URL to redirect the user to.
// The Paystack secret key never reaches the browser — it's read from an
// environment variable that only exists on the server.

const PREMIUM_PRICE_NAIRA = 1500; // Keep this in sync with the value in BashExplains.jsx

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: "Payment isn't configured yet (missing PAYSTACK_SECRET_KEY)." });
  }

  try {
    const { email, callback_url } = req.body || {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "A valid email is required." });
    }

    const amountKobo = PREMIUM_PRICE_NAIRA * 100;

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountKobo,
        currency: "NGN",
        callback_url: callback_url || undefined,
      }),
    });

    const data = await paystackRes.json();

    if (!paystackRes.ok || !data.status) {
      return res.status(400).json({ error: data.message || "Could not start payment with Paystack." });
    }

    return res.status(200).json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error starting payment." });
  }
    }
