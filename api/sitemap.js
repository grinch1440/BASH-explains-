// Vercel serverless function: GET /sitemap.xml (via rewrite in vercel.json)
// Builds the sitemap live from data.json, so it always includes every
// explainer currently on the site, including ones added from the admin dashboard.

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default async function handler(req, res) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const base = process.env.SITE_URL || `https://${host}`;

  try {
    const dataRes = await fetch(`${base}/data.json`);
    if (!dataRes.ok) throw new Error("Could not load data.json");
    const data = await dataRes.json();

    const today = new Date().toISOString().slice(0, 10);
    const policyDate = (data.privacyPolicyUpdated || today).slice(0, 10);

    const urls = [
      { loc: `${base}/`, lastmod: today, changefreq: "weekly", priority: "1.0" },
      { loc: `${base}/privacy-policy.html`, lastmod: policyDate, changefreq: "yearly", priority: "0.3" },
      ...(data.explainers || []).map((e) => ({
        loc: `${base}/?e=${encodeURIComponent(e.id)}`,
        changefreq: "monthly",
        priority: "0.8",
      })),
    ];

    const body = urls
      .map(
        (u) =>
          `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n` +
          (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : "") +
          `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(xml);
  } catch (err) {
    return res.status(500).send("Could not generate sitemap.");
  }
}
